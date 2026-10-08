-- Cofrinhos e Objetivos / migration 3: RPCs públicas.
-- Somente ADITIVA: 9 funções novas em public. Não altera tabela, trigger, função nem dado existente.
--
-- Dependências EXATAS da migration 2 (e anteriores):
--   private.pocket_write(...)            única porta de escrita em pocket_movements (DEFINER; autoriza, trava, valida)
--   private.pocket_transfer_write(...)   transferência entre cofrinhos da mesma conta
--   private.household_today(uuid)        "hoje" no fuso do household (EXECUTE para authenticated)
--   private.can_write(uuid)              autorização de escrita (membro owner/member)
--   triggers de lastro/imutabilidade/uso (a0_lock_reserve_accounts, z_reserve_backing, d_guard_pocket_use, ...)
--   public.create_transaction(...)       despesa comum + tags (já existente)
--
-- Princípios (todas as funções):
--   * SECURITY INVOKER + search_path = '' : o RLS de quem chama vale; não há SECURITY DEFINER novo em schema exposto.
--   * NENHUMA recebe household_id: ele é DERIVADO do perfil/cofrinho/transação/objetivo (que o RLS só deixa ver a membros).
--   * "não existe" e "não é seu" dão o MESMO erro (P0002), sem vazar existência entre households.
--   * Toda escrita em pocket_movements passa por private.pocket_write (nenhuma RPC faz INSERT direto lá).
--   * EXECUTE só para authenticated; anon e PUBLIC revogados.
--
-- Ordem de locks (a mesma da migration 2): linha da transação -> contas (por id) -> cofrinhos (por id).
--   spend_from_pocket: create_transaction trava a conta (trigger a0) e depois pocket_write trava conta+cofrinho.
--   reverse_pocket_use: trava a LINHA DA TRANSAÇÃO primeiro (FOR UPDATE) e só depois chama pocket_write.

-- ============================================================================================================
-- create_pocket: cria o cofrinho (+ reserva inicial opcional). Idempotente por p_legacy_ref (importação dos antigos).
-- ============================================================================================================
create or replace function public.create_pocket(
  p_profile_id uuid,
  p_account_id uuid,
  p_name text,
  p_description text default null,
  p_icon text default 'piggy-bank',
  p_color text default '#4f46e5',
  p_initial_cents bigint default 0,
  p_date date default null,
  p_legacy_ref text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
  v_id uuid;
  v_date date;
begin
  select fp.household_id into v_household from public.financial_profiles fp where fp.id = p_profile_id;
  if v_household is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_household)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_initial_cents is null or p_initial_cents < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  v_date := coalesce(p_date, private.household_today(v_household));

  if p_legacy_ref is not null then
    insert into public.pockets (household_id, profile_id, account_id, name, description, icon, color, legacy_ref)
    values (v_household, p_profile_id, p_account_id, btrim(p_name), nullif(btrim(p_description), ''),
            coalesce(p_icon, 'piggy-bank'), coalesce(p_color, '#4f46e5'), p_legacy_ref)
    on conflict (household_id, legacy_ref) where legacy_ref is not null do nothing
    returning id into v_id;
    if v_id is null then
      -- já importado: devolve o existente e NÃO repete a reserva inicial (sem duplicar)
      select p.id into v_id from public.pockets p where p.household_id = v_household and p.legacy_ref = p_legacy_ref;
      return v_id;
    end if;
  else
    insert into public.pockets (household_id, profile_id, account_id, name, description, icon, color)
    values (v_household, p_profile_id, p_account_id, btrim(p_name), nullif(btrim(p_description), ''),
            coalesce(p_icon, 'piggy-bank'), coalesce(p_color, '#4f46e5'))
    returning id into v_id;
  end if;

  if p_initial_cents > 0 then
    perform private.pocket_write(v_id, 'reserve', p_initial_cents, v_date, 'Saldo inicial');
  end if;
  return v_id;
end;
$$;

-- ============================================================================================================
-- update_pocket: nome, descrição, ícone, cor e responsável. A conta é IMUTÁVEL; o status tem RPC própria.
-- ============================================================================================================
create or replace function public.update_pocket(p_id uuid, p_patch jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_p public.pockets;
  v_allowed text[] := array['name', 'description', 'icon', 'color', 'profile_id'];
begin
  select * into v_p from public.pockets where id = p_id;
  if not found or not (select private.can_write(v_p.household_id)) then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k where k <> all (v_allowed)) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  update public.pockets p set
    name        = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else p.name end,
    description = case when p_patch ? 'description' then nullif(btrim(p_patch ->> 'description'), '') else p.description end,
    icon        = case when p_patch ? 'icon' then p_patch ->> 'icon' else p.icon end,
    color       = case when p_patch ? 'color' then p_patch ->> 'color' else p.color end,
    profile_id  = case when p_patch ? 'profile_id' then (p_patch ->> 'profile_id')::uuid else p.profile_id end
  where p.id = p_id;
end;
$$;

-- ============================================================================================================
-- set_pocket_archived: arquiva (exige saldo 0: guarda da migration 2) ou reativa (exige conta ativa).
-- ============================================================================================================
create or replace function public.set_pocket_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_p public.pockets;
begin
  select * into v_p from public.pockets where id = p_id;
  if not found or not (select private.can_write(v_p.household_id)) then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  update public.pockets set status = case when p_archived then 'archived'::public.pocket_status else 'active'::public.pocket_status end
   where id = p_id;
end;
$$;

-- ============================================================================================================
-- pocket_reserve / pocket_withdraw: alocação virtual (NÃO cria despesa, receita nem transferência bancária).
-- ============================================================================================================
create or replace function public.pocket_reserve(p_pocket_id uuid, p_amount_cents bigint, p_date date default null, p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select p.household_id into v_household from public.pockets p where p.id = p_pocket_id;
  if v_household is null then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  return private.pocket_write(p_pocket_id, 'reserve', p_amount_cents, coalesce(p_date, private.household_today(v_household)), p_note);
end;
$$;

create or replace function public.pocket_withdraw(p_pocket_id uuid, p_amount_cents bigint, p_date date default null, p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select p.household_id into v_household from public.pockets p where p.id = p_pocket_id;
  if v_household is null then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  return private.pocket_write(p_pocket_id, 'withdraw', p_amount_cents, coalesce(p_date, private.household_today(v_household)), p_note);
end;
$$;

-- ============================================================================================================
-- pocket_transfer: entre cofrinhos da MESMA conta (devolve o transfer_group_id). Para outra conta: transferência real antes.
-- ============================================================================================================
create or replace function public.pocket_transfer(p_from_pocket_id uuid, p_to_pocket_id uuid, p_amount_cents bigint, p_date date default null, p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select p.household_id into v_household from public.pockets p where p.id = p_from_pocket_id;
  if v_household is null then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  return private.pocket_transfer_write(p_from_pocket_id, p_to_pocket_id, p_amount_cents, coalesce(p_date, private.household_today(v_household)), p_note);
end;
$$;

-- ============================================================================================================
-- spend_from_pocket: despesa PAGA na conta do cofrinho + uso da reserva (total ou PARCIAL), numa única transação.
--   p_amount_cents       = valor da despesa (sai inteiro do saldo bancário)
--   p_amount_from_pocket = quanto da reserva cobre (padrão = tudo; 0 < x <= p_amount_cents)
-- Se qualquer etapa falhar (categoria, saldo do cofrinho, lastro...), NADA persiste (nem a despesa).
-- ============================================================================================================
create or replace function public.spend_from_pocket(
  p_pocket_id uuid,
  p_description text,
  p_amount_cents bigint,
  p_amount_from_pocket bigint default null,
  p_date date default null,
  p_category_id uuid default null,
  p_profile_id uuid default null,
  p_notes text default null,
  p_tags text[] default '{}'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p public.pockets;
  v_today date;
  v_date date;
  v_from bigint;
  v_tx uuid;
  v_mv uuid;
begin
  select * into v_p from public.pockets where id = p_pocket_id;
  if not found or not (select private.can_write(v_p.household_id)) then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  v_from := coalesce(p_amount_from_pocket, p_amount_cents);
  if v_from <= 0 or v_from > p_amount_cents then
    raise exception 'amount_from_pocket_invalid' using errcode = '22023';
  end if;
  if p_category_id is null then
    raise exception 'category_required' using errcode = '22023';
  end if;
  v_today := private.household_today(v_p.household_id);
  v_date := coalesce(p_date, v_today);
  if v_date > v_today then
    raise exception 'future_date' using errcode = '22023';
  end if;

  -- a despesa PAGA (o trigger a0 trava a conta; o lastro é conferido no COMMIT, já com o uso da reserva abatido)
  v_tx := public.create_transaction('expense', p_description, p_amount_cents, v_date,
                                    coalesce(p_profile_id, v_p.profile_id), 'paid', v_p.account_id, null, null,
                                    p_category_id, null, v_date, p_notes, coalesce(p_tags, '{}'));
  v_mv := private.pocket_write(p_pocket_id, 'use', v_from, v_date, left(p_description, 300), v_tx);
  return jsonb_build_object('transaction_id', v_tx, 'movement_id', v_mv, 'from_pocket_cents', v_from, 'from_account_cents', p_amount_cents - v_from);
end;
$$;

-- ============================================================================================================
-- reverse_pocket_use: estorno INTEGRAL do valor efetivamente usado da reserva + cancelamento da despesa (histórico preservado).
--   * devolve ao cofrinho exatamente o que o 'use' tirou (uso parcial => estorno só dessa parte);
--   * o cancelamento devolve a despesa INTEIRA ao saldo bancário;
--   * os movimentos 'use' e 'use_reversal' e a despesa (cancelada) permanecem.
-- Trava a LINHA DA TRANSAÇÃO primeiro (ordem global de locks).
-- ============================================================================================================
create or replace function public.reverse_pocket_use(p_transaction_id uuid, p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tx public.transactions;
  v_use public.pocket_movements;
  v_rev uuid;
begin
  select * into v_tx from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_tx.household_id)) then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  select * into v_use from public.pocket_movements where transaction_id = p_transaction_id and kind = 'use';
  if not found then
    raise exception 'no_pocket_use' using errcode = '22023';
  end if;
  if exists (select 1 from public.pocket_movements r where r.reverses_id = v_use.id) then
    raise exception 'already_reversed' using errcode = '22023';
  end if;

  v_rev := private.pocket_write(v_use.pocket_id, 'use_reversal', v_use.amount_cents, private.household_today(v_tx.household_id),
                                p_note, p_transaction_id, null, v_use.id);
  update public.transactions set status = 'canceled', paid_at = null where id = p_transaction_id;
  return v_rev;
end;
$$;

-- ============================================================================================================
-- link_goal_pocket: liga/desliga um objetivo a um cofrinho. Ligar ZERA o valor informado à mão (CHECK goals_manual_xor_pocket);
-- um cofrinho serve a um único objetivo. Cofrinho de outro household => pocket_not_found.
-- ============================================================================================================
create or replace function public.link_goal_pocket(p_goal_id uuid, p_pocket_id uuid default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_goal public.goals;
begin
  select * into v_goal from public.goals where id = p_goal_id;
  if not found or not (select private.can_write(v_goal.household_id)) then
    raise exception 'goal_not_found' using errcode = 'P0002';
  end if;
  if p_pocket_id is null then
    update public.goals set pocket_id = null where id = p_goal_id;
  else
    update public.goals set pocket_id = p_pocket_id, manual_amount_cents = 0 where id = p_goal_id;
  end if;
exception
  when unique_violation then
    raise exception 'pocket_already_linked' using errcode = 'P0001';
  when foreign_key_violation then
    raise exception 'pocket_not_found' using errcode = 'P0002';
end;
$$;

-- ============================================================================================================
-- Privilégios: só authenticated. anon e PUBLIC revogados (o default do Supabase concederia EXECUTE ao anon).
-- ============================================================================================================
revoke all on function public.create_pocket(uuid, uuid, text, text, text, text, bigint, date, text) from public, anon;
revoke all on function public.update_pocket(uuid, jsonb) from public, anon;
revoke all on function public.set_pocket_archived(uuid, boolean) from public, anon;
revoke all on function public.pocket_reserve(uuid, bigint, date, text) from public, anon;
revoke all on function public.pocket_withdraw(uuid, bigint, date, text) from public, anon;
revoke all on function public.pocket_transfer(uuid, uuid, bigint, date, text) from public, anon;
revoke all on function public.spend_from_pocket(uuid, text, bigint, bigint, date, uuid, uuid, text, text[]) from public, anon;
revoke all on function public.reverse_pocket_use(uuid, text) from public, anon;
revoke all on function public.link_goal_pocket(uuid, uuid) from public, anon;

grant execute on function public.create_pocket(uuid, uuid, text, text, text, text, bigint, date, text) to authenticated;
grant execute on function public.update_pocket(uuid, jsonb) to authenticated;
grant execute on function public.set_pocket_archived(uuid, boolean) to authenticated;
grant execute on function public.pocket_reserve(uuid, bigint, date, text) to authenticated;
grant execute on function public.pocket_withdraw(uuid, bigint, date, text) to authenticated;
grant execute on function public.pocket_transfer(uuid, uuid, bigint, date, text) to authenticated;
grant execute on function public.spend_from_pocket(uuid, text, bigint, bigint, date, uuid, uuid, text, text[]) to authenticated;
grant execute on function public.reverse_pocket_use(uuid, text) to authenticated;
grant execute on function public.link_goal_pocket(uuid, uuid) to authenticated;
