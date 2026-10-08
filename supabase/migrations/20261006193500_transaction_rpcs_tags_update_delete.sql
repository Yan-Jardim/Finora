-- PENDENTE DE APROVAÇÃO NA FERRAMENTA — NÃO aplicada. Depois de autorizada, vira a migration 18 em supabase/migrations/.
--
-- CONTEÚDO (13 comandos de nível superior: 5 CREATE OR REPLACE FUNCTION + 8 REVOKE/GRANT):
--   * private.apply_tags ........... SUBSTITUI as tags de movimentações (apaga as ligações antigas e recria)
--   * public.set_transaction_tags .. tags de UMA movimentação (usa apply_tags)
--   * public.update_transaction .... edita movimentação comum + SUBSTITUI tags numa única transação
--   * public.update_installments ... versão COMPLETA (com "tags"), substituindo a da migration 16
--   * public.delete_installments ... exclui parcelas por escopo (this | future | all) e o agrupador órfão
--
-- SEGURANÇA (revisado): nenhum DROP/TRUNCATE/RESET; nenhum DELETE/UPDATE/INSERT fora de corpos de função.
-- Os DELETE existentes ficam SOMENTE dentro de apply_tags e delete_installments e só rodam quando a função é
-- CHAMADA. Aplicar o arquivo não apaga nada. É idempotente (CREATE OR REPLACE): pode ser reexecutado.
-- Todas SECURITY INVOKER: RLS e FKs compostas valem; permissão = can_write do household derivado da movimentação.
-- Se a ferramenta continuar bloqueando, o arquivo pode ser executado no SQL Editor do Supabase.

-- Substitui as tags de várias movimentações (cria as tags que faltam; ignora maiúsculas).
create or replace function private.apply_tags(p_tx_ids uuid[], p_household_id uuid, p_tags text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tags text[] := private.normalize_tags(p_tags);
begin
  if cardinality(v_tags) > 0 then
    insert into public.tags (household_id, name)
    select p_household_id, t from unnest(v_tags) as t
    on conflict do nothing;
  end if;

  delete from public.transaction_tags tt
   where tt.household_id = p_household_id and tt.transaction_id = any (p_tx_ids);

  if cardinality(v_tags) > 0 then
    insert into public.transaction_tags (household_id, transaction_id, tag_id)
    select p_household_id, x.tx, g.id
    from unnest(p_tx_ids) as x(tx)
    join public.tags g
      on g.household_id = p_household_id
     and lower(g.name) = any (select lower(n) from unnest(v_tags) as n);
  end if;
end;
$$;
revoke all on function private.apply_tags(uuid[], uuid, text[]) from public, anon;
grant execute on function private.apply_tags(uuid[], uuid, text[]) to authenticated;

-- ============ set_transaction_tags ============
create or replace function public.set_transaction_tags(p_transaction_id uuid, p_tags text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select t.household_id into v_household from public.transactions t where t.id = p_transaction_id;
  if v_household is null then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_household)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform private.apply_tags(array[p_transaction_id], v_household, p_tags);
end;
$$;

-- ============ update_transaction ============
-- Edita uma movimentação COMUM (income, expense, credit_card_purchase à vista, transfer, debt_payment, investment,
-- redemption) e, opcionalmente, SUBSTITUI as tags — tudo numa única transação.
--   * p_patch (jsonb) aceita: description, amount_cents, date, due_date, status, paid_at, category_id, profile_id,
--     account_id, to_account_id, card_id, notes. (O tipo nunca muda.)
--   * p_tags: NULL = não mexe nas tags; array (inclusive vazio) = substitui todas.
--   * paid_at: com status "paid" = paid_at informado, ou o já existente, ou hoje; sem "paid" = nulo.
--   * compra no cartão com nova data (sem status explícito): pending se já chegou, planned se futura.
--   * pagamento de fatura e parcelas têm fluxo próprio (pay_invoice / update_installments).
--   * compra de fatura totalmente paga continua travada pelo banco (invoice_paid_locked).
create or replace function public.update_transaction(p_transaction_id uuid, p_patch jsonb, p_tags text[] default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tx record;
  v_today date;
  v_status public.transaction_status;
  v_paid_at date;
  v_allowed text[] := array['description','amount_cents','date','due_date','status','paid_at','category_id',
                            'profile_id','account_id','to_account_id','card_id','notes'];
begin
  select t.* into v_tx from public.transactions t where t.id = p_transaction_id;
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_tx.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_tx.kind = 'card_payment' then
    raise exception 'use_pay_invoice_flow' using errcode = '22023';
  end if;
  if v_tx.installment_purchase_id is not null then
    raise exception 'use_update_installments' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k where k <> all (v_allowed)) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;

  v_today := private.household_today(v_tx.household_id);
  v_status := case
    when p_patch ? 'status' then (p_patch ->> 'status')::public.transaction_status
    when v_tx.kind = 'credit_card_purchase' and p_patch ? 'date' and v_tx.status <> 'canceled'
      then (case when (p_patch ->> 'date')::date <= v_today then 'pending' else 'planned' end)::public.transaction_status
    else v_tx.status
  end;
  if v_status = 'paid' then
    v_paid_at := coalesce(nullif(p_patch ->> 'paid_at', '')::date, v_tx.paid_at, v_today);
  elsif nullif(p_patch ->> 'paid_at', '') is not null then
    raise exception 'invalid_paid_at' using errcode = '22023';
  end if;

  update public.transactions t set
    description   = case when p_patch ? 'description' then btrim(p_patch ->> 'description') else t.description end,
    amount_cents  = case when p_patch ? 'amount_cents' then (p_patch ->> 'amount_cents')::bigint else t.amount_cents end,
    date          = case when p_patch ? 'date' then (p_patch ->> 'date')::date else t.date end,
    due_date      = case when p_patch ? 'due_date' then nullif(p_patch ->> 'due_date', '')::date else t.due_date end,
    status        = v_status,
    paid_at       = v_paid_at,
    category_id   = case when p_patch ? 'category_id' then nullif(p_patch ->> 'category_id', '')::uuid else t.category_id end,
    profile_id    = case when p_patch ? 'profile_id' then (p_patch ->> 'profile_id')::uuid else t.profile_id end,
    account_id    = case when p_patch ? 'account_id' then nullif(p_patch ->> 'account_id', '')::uuid else t.account_id end,
    to_account_id = case when p_patch ? 'to_account_id' then nullif(p_patch ->> 'to_account_id', '')::uuid else t.to_account_id end,
    card_id       = case when p_patch ? 'card_id' then nullif(p_patch ->> 'card_id', '')::uuid else t.card_id end,
    notes         = case when p_patch ? 'notes' then nullif(btrim(p_patch ->> 'notes'), '') else t.notes end
  where t.id = p_transaction_id;

  if p_tags is not null then
    perform private.apply_tags(array[p_transaction_id], v_tx.household_id, p_tags);
  end if;
end;
$$;

-- ============ update_installments (versão completa, com tags) ============
create or replace function public.update_installments(p_transaction_id uuid, p_scope text, p_patch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tx record;
  v_today date;
  v_targets uuid[];
  v_kept integer := 0;
  v_updated integer;
  v_allowed text[];
begin
  if p_scope is null or p_scope not in ('this', 'future') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;

  select t.id, t.household_id, t.installment_purchase_id, t.installment_number into v_tx
    from public.transactions t where t.id = p_transaction_id;
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  if v_tx.installment_purchase_id is null then
    raise exception 'not_an_installment' using errcode = '22023';
  end if;
  if not (select private.can_write(v_tx.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_allowed := case when p_scope = 'this'
    then array['description','category_id','notes','profile_id','tags','amount_cents','date']
    else array['description','category_id','notes','profile_id','tags'] end;
  if exists (select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k where k <> all (v_allowed)) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;

  v_today := private.household_today(v_tx.household_id);

  if p_scope = 'this' then
    v_targets := array[v_tx.id];
  else
    select
      coalesce(array_agg(t.id) filter (where not (t.status <> 'canceled' and private.invoice_is_paid(t.invoice_id))), '{}'),
      count(*) filter (where t.status <> 'canceled' and private.invoice_is_paid(t.invoice_id))
    into v_targets, v_kept
    from public.transactions t
    where t.installment_purchase_id = v_tx.installment_purchase_id
      and t.installment_number >= v_tx.installment_number;
  end if;

  update public.transactions t set
    description = case when p_patch ? 'description' then btrim(p_patch ->> 'description') else t.description end,
    category_id = case when p_patch ? 'category_id' then nullif(p_patch ->> 'category_id', '')::uuid else t.category_id end,
    notes       = case when p_patch ? 'notes' then nullif(btrim(p_patch ->> 'notes'), '') else t.notes end,
    profile_id  = case when p_patch ? 'profile_id' then (p_patch ->> 'profile_id')::uuid else t.profile_id end,
    amount_cents = case when p_scope = 'this' and p_patch ? 'amount_cents' then (p_patch ->> 'amount_cents')::bigint else t.amount_cents end,
    date        = case when p_scope = 'this' and p_patch ? 'date' then (p_patch ->> 'date')::date else t.date end,
    status      = case when p_scope = 'this' and p_patch ? 'date' and t.status <> 'canceled'
                       then (case when (p_patch ->> 'date')::date <= v_today then 'pending' else 'planned' end)::public.transaction_status
                       else t.status end
  where t.id = any (v_targets);
  get diagnostics v_updated = row_count;

  if p_patch ? 'tags' then
    perform private.apply_tags(
      v_targets, v_tx.household_id,
      array(select jsonb_array_elements_text(p_patch -> 'tags'))
    );
  end if;

  return jsonb_build_object('updated', v_updated, 'kept_paid', v_kept);
end;
$$;

-- ============ delete_installments ============
-- p_scope: 'this' | 'future' (esta e as próximas) | 'all' (compra inteira).
-- Nada é excluído "em silêncio": parcelas de fatura já paga são MANTIDAS em 'future'/'all' (kept_paid)
-- e, em 'this', o banco recusa (invoice_paid_locked). O agrupador some quando não restam parcelas.
create or replace function public.delete_installments(p_transaction_id uuid, p_scope text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tx record;
  v_targets uuid[];
  v_kept integer := 0;
  v_deleted integer;
begin
  if p_scope is null or p_scope not in ('this', 'future', 'all') then
    raise exception 'invalid_scope' using errcode = '22023';
  end if;

  select t.id, t.household_id, t.installment_purchase_id, t.installment_number into v_tx
    from public.transactions t where t.id = p_transaction_id;
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  if v_tx.installment_purchase_id is null then
    raise exception 'not_an_installment' using errcode = '22023';
  end if;
  if not (select private.can_write(v_tx.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_scope = 'this' then
    v_targets := array[v_tx.id];
  else
    select
      coalesce(array_agg(t.id) filter (where not (t.status <> 'canceled' and private.invoice_is_paid(t.invoice_id))), '{}'),
      count(*) filter (where t.status <> 'canceled' and private.invoice_is_paid(t.invoice_id))
    into v_targets, v_kept
    from public.transactions t
    where t.installment_purchase_id = v_tx.installment_purchase_id
      and (p_scope = 'all' or t.installment_number >= v_tx.installment_number);
  end if;

  delete from public.transactions t where t.id = any (v_targets);
  get diagnostics v_deleted = row_count;

  if not exists (select 1 from public.transactions t where t.installment_purchase_id = v_tx.installment_purchase_id) then
    delete from public.installment_purchases p where p.id = v_tx.installment_purchase_id;
  end if;

  return jsonb_build_object('deleted', v_deleted, 'kept_paid', v_kept);
end;
$$;

revoke all on function public.set_transaction_tags(uuid, text[]) from public, anon;
revoke all on function public.update_transaction(uuid, jsonb, text[]) from public, anon;
revoke all on function public.delete_installments(uuid, text) from public, anon;
grant execute on function public.set_transaction_tags(uuid, text[]) to authenticated;
grant execute on function public.update_transaction(uuid, jsonb, text[]) to authenticated;
grant execute on function public.delete_installments(uuid, text) to authenticated;
