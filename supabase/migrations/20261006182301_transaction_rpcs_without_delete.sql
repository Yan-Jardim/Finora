-- Bloco 3 / migration 16: RPCs atômicas que NÃO usam DELETE (create_installment_purchase, pay_invoice, update_installments).
-- (delete_installments e a substituição de tags dependem de DELETE e ficam em supabase/pending até autorização.)
-- Todas SECURITY INVOKER: RLS e FKs compostas valem normalmente; permissão = can_write do household.
-- O household nunca é informado pelo cliente: é derivado do cartão/movimentação (que o RLS só deixa ver se for membro).

-- "Hoje" no fuso do household (decide pendente x prevista).
create or replace function private.household_today(p_household_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone coalesce((select h.timezone from public.households h where h.id = p_household_id), 'UTC'))::date;
$$;
revoke all on function private.household_today(uuid) from public, anon;
grant execute on function private.household_today(uuid) to authenticated;

-- ADICIONA tags a movimentações novas (cria as que faltam; ignora maiúsculas). Não remove nada.
create or replace function private.add_tags(p_tx_ids uuid[], p_household_id uuid, p_tags text[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tags text[] := private.normalize_tags(p_tags);
begin
  if cardinality(v_tags) = 0 then
    return;
  end if;
  insert into public.tags (household_id, name)
  select p_household_id, t from unnest(v_tags) as t
  on conflict do nothing;

  insert into public.transaction_tags (household_id, transaction_id, tag_id)
  select p_household_id, x.tx, g.id
  from unnest(p_tx_ids) as x(tx)
  join public.tags g
    on g.household_id = p_household_id
   and lower(g.name) = any (select lower(n) from unnest(v_tags) as n)
  on conflict do nothing;
end;
$$;
revoke all on function private.add_tags(uuid[], uuid, text[]) from public, anon;
grant execute on function private.add_tags(uuid[], uuid, text[]) to authenticated;

-- ============ create_installment_purchase ============
-- Cria o agrupador + TODAS as parcelas numa transação. Valores: split_cents (soma exata).
-- Parcela n cai n-1 meses depois da compra (mesmo dia, limitado ao fim do mês); a fatura de cada uma é
-- decidida pelo banco. Parcela com data futura nasce "planned"; as demais "pending".
create or replace function public.create_installment_purchase(
  p_card_id uuid,
  p_profile_id uuid,
  p_category_id uuid,
  p_description text,
  p_total_cents bigint,
  p_installments integer,
  p_purchase_date date,
  p_notes text default null,
  p_tags text[] default '{}'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
  v_today date;
  v_purchase uuid;
  v_amounts bigint[];
  v_ids uuid[];
begin
  select c.household_id into v_household from public.credit_cards c where c.id = p_card_id;
  if v_household is null then
    raise exception 'card_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_household)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_installments is null or p_installments not between 2 and 48 then
    raise exception 'invalid_installments' using errcode = '22023';
  end if;
  if p_total_cents is null or p_total_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_purchase_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  v_today := private.household_today(v_household);
  v_amounts := public.split_cents(p_total_cents, p_installments);

  insert into public.installment_purchases
    (household_id, card_id, profile_id, category_id, description, total_cents, installments_count, purchase_date, notes)
  values
    (v_household, p_card_id, p_profile_id, p_category_id, btrim(p_description), p_total_cents, p_installments,
     p_purchase_date, nullif(btrim(p_notes), ''))
  returning id into v_purchase;

  with ins as (
    insert into public.transactions
      (household_id, kind, status, description, amount_cents, date, profile_id, card_id, category_id,
       installment_purchase_id, installment_number, notes)
    select
      v_household,
      'credit_card_purchase',
      (case when s.d <= v_today then 'pending' else 'planned' end)::public.transaction_status,
      btrim(p_description),
      v_amounts[s.n],
      s.d,
      p_profile_id,
      p_card_id,
      p_category_id,
      v_purchase,
      s.n,
      nullif(btrim(p_notes), '')
    from (
      select g.n, (p_purchase_date + make_interval(months => g.n - 1))::date as d
      from generate_series(1, p_installments) as g(n)
    ) s
    returning id, installment_number
  )
  select array_agg(ins.id order by ins.installment_number) into v_ids from ins;

  if cardinality(coalesce(p_tags, '{}')) > 0 then
    perform private.add_tags(v_ids, v_household, p_tags);
  end if;

  return jsonb_build_object('purchase_id', v_purchase, 'transaction_ids', to_jsonb(v_ids));
end;
$$;

-- ============ pay_invoice ============
-- Registra um card_payment: sai da conta, reduz o valor em aberto da fatura, NÃO é despesa.
-- Pagamento parcial é permitido; acima do em aberto é recusado pelo banco (payment_exceeds_open).
-- A conta que paga (p_account_id) é a que vale; payment_account_id do cartão é só uma sugestão.
create or replace function public.pay_invoice(
  p_card_id uuid,
  p_due_month date,
  p_account_id uuid,
  p_amount_cents bigint,
  p_date date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_card record;
  v_month date := date_trunc('month', p_due_month::timestamp)::date;
  v_invoice uuid;
  v_id uuid;
  v_names text[] := array['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
begin
  select c.id, c.household_id, c.name, c.owner_profile_id into v_card
    from public.credit_cards c where c.id = p_card_id;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_card.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  select i.id into v_invoice from public.card_invoices i where i.card_id = p_card_id and i.due_month = v_month;
  if v_invoice is null then
    raise exception 'invoice_not_found' using errcode = 'P0002';
  end if;

  insert into public.transactions
    (household_id, kind, status, description, amount_cents, date, paid_at, profile_id, account_id, card_id, invoice_id)
  values
    (v_card.household_id, 'card_payment', 'paid',
     left('Fatura ' || v_card.name || ' — ' || v_names[extract(month from v_month)::int] || ' ' || extract(year from v_month)::int, 80),
     p_amount_cents, p_date, p_date, v_card.owner_profile_id, p_account_id, p_card_id, v_invoice)
  returning id into v_id;

  return v_id;
end;
$$;

-- ============ update_installments ============
-- p_scope: 'this' (só esta parcela: descrição, categoria, notas, perfil, valor, data)
--          'future' (esta e as próximas: SOMENTE campos descritivos; valor/data nunca propagam).
-- Parcelas de fatura já paga NÃO são alteradas em 'future' (contadas em kept_paid); em 'this' o banco recusa.
-- p_patch (jsonb): description, category_id, notes, profile_id, amount_cents, date.
-- (Tags: a versão com substituição de tags depende de DELETE e está em supabase/pending.)
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
    then array['description','category_id','notes','profile_id','amount_cents','date']
    else array['description','category_id','notes','profile_id'] end;
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
    -- parcela com nova data: pendente se já chegou, prevista se futura (cancelada continua cancelada)
    status      = case when p_scope = 'this' and p_patch ? 'date' and t.status <> 'canceled'
                       then (case when (p_patch ->> 'date')::date <= v_today then 'pending' else 'planned' end)::public.transaction_status
                       else t.status end
  where t.id = any (v_targets);
  get diagnostics v_updated = row_count;

  return jsonb_build_object('updated', v_updated, 'kept_paid', v_kept);
end;
$$;

revoke all on function public.create_installment_purchase(uuid, uuid, uuid, text, bigint, integer, date, text, text[]) from public, anon;
revoke all on function public.pay_invoice(uuid, date, uuid, bigint, date) from public, anon;
revoke all on function public.update_installments(uuid, text, jsonb) from public, anon;
grant execute on function public.create_installment_purchase(uuid, uuid, uuid, text, bigint, integer, date, text, text[]) to authenticated;
grant execute on function public.pay_invoice(uuid, date, uuid, bigint, date) to authenticated;
grant execute on function public.update_installments(uuid, text, jsonb) to authenticated;
