-- Dívidas / migration 2: views derivadas + RPCs atômicas. Tudo SECURITY INVOKER (RLS e FKs compostas valem; o household
-- é derivado da dívida/perfil, nunca informado pelo cliente). Nenhuma RPC apaga linhas.

-- ============ v_debt_installments: cronograma DERIVADO + alocação dos pagamentos ============
-- Parcela n = split_cents(total, N)[n] (soma exata) vencendo (1º vencimento + n-1 meses, dia limitado ao mês).
-- Os pagamentos cobrem as parcelas EM ORDEM (cascata): pagar 500 de uma parcela de 800 deixa 300 em aberto; pagar
-- adiantado cobre as seguintes. Dívida quitada (acordo) ou cancelada não tem mais nada em aberto.
create view public.v_debt_installments with (security_invoker = true) as
with paid as (
  select t.debt_id, sum(t.amount_cents)::bigint as cents
    from public.transactions t
   where t.debt_id is not null and t.kind = 'debt_payment' and t.status = 'paid'
   group by t.debt_id
), sched as (
  select d.id as debt_id, d.household_id, g.n as number,
         (public.split_cents(d.total_cents, d.installments_count::integer))[g.n] as amount_cents,
         (d.first_due_date + ((g.n - 1) * interval '1 month'))::date as due_date,
         d.status as debt_status, (d.settled_at is not null) as settled, h.timezone,
         coalesce(p.cents, 0) as paid_total
    from public.debts d
    join public.households h on h.id = d.household_id
    left join paid p on p.debt_id = d.id
   cross join lateral generate_series(1, d.installments_count::integer) as g(n)
   where d.installments_count is not null
), alloc as (
  select s.*,
         sum(s.amount_cents) over (partition by s.debt_id order by s.number)::bigint as cum_due
    from sched s
), calc as (
  select a.*,
         least(a.amount_cents, greatest(0, a.paid_total - (a.cum_due - a.amount_cents)))::bigint as covered
    from alloc a
)
select c.debt_id, c.household_id, c.number::integer as number, c.due_date, c.amount_cents::bigint as amount_cents,
       c.covered as paid_cents,
       (case when c.settled or c.debt_status = 'canceled' then 0 else c.amount_cents - c.covered end)::bigint as open_cents,
       (case
          when c.settled or c.debt_status = 'canceled' or c.amount_cents - c.covered = 0 then 'paid'
          when c.covered > 0 then 'partial'
          else 'open'
        end) as status,
       (not (c.settled or c.debt_status = 'canceled') and c.amount_cents - c.covered > 0
        and c.debt_status = 'active' and c.due_date < (now() at time zone c.timezone)::date) as is_overdue
  from calc c;
comment on view public.v_debt_installments is 'Cronograma derivado. Paridade com domain/debts.ts (debtInstallments).';

-- ============ v_debt_summary: pago, restante, progresso, situação — nada disso é gravado ============
create view public.v_debt_summary with (security_invoker = true) as
with paid as (
  select t.debt_id, sum(t.amount_cents)::bigint as cents, count(*)::integer as n
    from public.transactions t
   where t.debt_id is not null and t.kind = 'debt_payment' and t.status = 'paid'
   group by t.debt_id
), inst as (
  select i.debt_id,
         count(*) filter (where i.paid_cents >= i.amount_cents)::integer as paid_count,
         count(*) filter (where i.open_cents > 0)::integer as open_count,
         (array_agg(i.due_date order by i.number) filter (where i.open_cents > 0))[1] as next_due_date,
         (array_agg(i.open_cents order by i.number) filter (where i.open_cents > 0))[1] as next_open_cents
    from public.v_debt_installments i
   group by i.debt_id
)
select d.id as debt_id, d.household_id, d.principal_cents, d.total_cents,
       coalesce(p.cents, 0)::bigint as paid_cents,
       (case when d.settled_at is not null or d.status = 'canceled' then 0
             else greatest(d.total_cents - coalesce(p.cents, 0), 0) end)::bigint as remaining_cents,
       (d.total_cents - d.principal_cents)::bigint as financial_cost_cents,
       (case when d.settled_at is not null then 100.00
             when d.status = 'canceled' then 0.00
             else round(least(coalesce(p.cents, 0)::numeric * 100 / d.total_cents, 100), 2) end) as progress_percent,
       d.installments_count::integer as installments_count,
       coalesce(i.paid_count, 0) as installments_paid,
       coalesce(i.open_count, 0) as installments_open,
       i.next_due_date, i.next_open_cents::bigint as next_open_cents,
       coalesce(p.n, 0) as payments_count,
       d.settled_at, d.settlement_discount_cents::bigint as settlement_discount_cents,
       (case
          when d.status = 'canceled' then 'canceled'
          when d.settled_at is not null or greatest(d.total_cents - coalesce(p.cents, 0), 0) = 0 then 'paid'
          when d.status = 'paused' then 'paused'
          else 'active'
        end) as derived_status
  from public.debts d
  left join paid p on p.debt_id = d.id
  left join inst i on i.debt_id = d.id;
comment on view public.v_debt_summary is 'Resumo derivado por dívida. Paridade com domain/debts.ts (debtSummary).';

revoke all on public.v_debt_installments, public.v_debt_summary from anon, authenticated;
grant select on public.v_debt_installments, public.v_debt_summary to authenticated;

-- ============ create_debt ============
create or replace function public.create_debt(
  p_name text,
  p_principal_cents bigint,
  p_total_cents bigint,
  p_profile_id uuid,
  p_kind public.debt_kind default 'other',
  p_creditor text default null,
  p_notes text default null,
  p_installments integer default null,
  p_first_due_date date default null,
  p_payment_account_id uuid default null,
  p_category_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
  v_id uuid;
begin
  if (p_installments is null) <> (p_first_due_date is null)
     or (p_installments is not null and (p_installments < 1 or p_installments > 120)) then
    raise exception 'invalid_installments' using errcode = '22023';
  end if;

  select f.household_id into v_household from public.financial_profiles f where f.id = p_profile_id;
  if v_household is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_household)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.debts
    (household_id, profile_id, name, creditor, kind, notes, principal_cents, total_cents, installments_count,
     first_due_date, payment_account_id, category_id)
  values
    (v_household, p_profile_id, btrim(p_name), nullif(btrim(p_creditor), ''), p_kind, nullif(btrim(p_notes), ''),
     p_principal_cents, p_total_cents, p_installments, p_first_due_date, p_payment_account_id, p_category_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- ============ update_debt ============
-- Dados descritivos sempre; valores/cronograma só se a dívida não foi quitada, e o total nunca fica abaixo do que
-- já foi pago. O cronograma é derivado: mudar total/parcelas/1º vencimento recalcula as parcelas; o HISTÓRICO de
-- pagamentos (transações) nunca muda.
create or replace function public.update_debt(p_id uuid, p_patch jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_d record;
  v_allowed text[] := array['name','creditor','kind','notes','profile_id','category_id','payment_account_id',
                            'principal_cents','total_cents','installments_count','first_due_date'];
  v_money text[] := array['principal_cents','total_cents','installments_count','first_due_date'];
  v_new_total bigint;
  v_paid bigint;
begin
  select * into v_d from public.debts d where d.id = p_id for update;
  if not found then
    raise exception 'debt_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_d.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k where k <> all (v_allowed)) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  if coalesce(p_patch, '{}'::jsonb) ?| v_money and v_d.settled_at is not null then
    raise exception 'debt_settled_locked' using errcode = 'P0001';
  end if;

  v_new_total := case when p_patch ? 'total_cents' then (p_patch ->> 'total_cents')::bigint else v_d.total_cents end;
  select coalesce(sum(t.amount_cents), 0) into v_paid
    from public.transactions t where t.debt_id = p_id and t.kind = 'debt_payment' and t.status = 'paid';
  if v_new_total < v_paid then
    raise exception 'total_below_paid' using errcode = 'P0001';
  end if;

  update public.debts d set
    name               = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else d.name end,
    creditor           = case when p_patch ? 'creditor' then nullif(btrim(p_patch ->> 'creditor'), '') else d.creditor end,
    kind               = case when p_patch ? 'kind' then (p_patch ->> 'kind')::public.debt_kind else d.kind end,
    notes              = case when p_patch ? 'notes' then nullif(btrim(p_patch ->> 'notes'), '') else d.notes end,
    profile_id         = case when p_patch ? 'profile_id' then (p_patch ->> 'profile_id')::uuid else d.profile_id end,
    category_id        = case when p_patch ? 'category_id' then nullif(p_patch ->> 'category_id', '')::uuid else d.category_id end,
    payment_account_id = case when p_patch ? 'payment_account_id' then nullif(p_patch ->> 'payment_account_id', '')::uuid else d.payment_account_id end,
    principal_cents    = case when p_patch ? 'principal_cents' then (p_patch ->> 'principal_cents')::bigint else d.principal_cents end,
    total_cents        = v_new_total,
    installments_count = case when p_patch ? 'installments_count' then nullif(p_patch ->> 'installments_count', '')::smallint else d.installments_count end,
    first_due_date     = case when p_patch ? 'first_due_date' then nullif(p_patch ->> 'first_due_date', '')::date else d.first_due_date end
  where d.id = p_id;
end;
$$;

-- ============ pay_debt ============
-- Cria o pagamento (transação debt_payment, sempre paga) e valida o saldo devido NO MESMO COMANDO, com a dívida
-- travada: ou entra o pagamento, ou nada muda. Pagar mais que o restante é recusado (payment_exceeds_remaining).
create or replace function public.pay_debt(
  p_debt_id uuid,
  p_account_id uuid,
  p_amount_cents bigint,
  p_date date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_d record;
  v_paid bigint;
  v_remaining bigint;
  v_id uuid;
begin
  select * into v_d from public.debts d where d.id = p_debt_id for update;
  if not found then
    raise exception 'debt_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_d.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_d.status = 'canceled' then
    raise exception 'debt_canceled' using errcode = 'P0001';
  end if;
  if v_d.settled_at is not null then
    raise exception 'debt_settled_locked' using errcode = 'P0001';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  select coalesce(sum(t.amount_cents), 0) into v_paid
    from public.transactions t where t.debt_id = p_debt_id and t.kind = 'debt_payment' and t.status = 'paid';
  v_remaining := v_d.total_cents - v_paid;
  if v_remaining <= 0 then
    raise exception 'debt_already_paid' using errcode = 'P0001';
  end if;
  if p_amount_cents > v_remaining then
    raise exception 'payment_exceeds_remaining' using errcode = 'P0001';
  end if;

  insert into public.transactions
    (household_id, kind, status, description, amount_cents, date, paid_at, profile_id, account_id, category_id, debt_id)
  values
    (v_d.household_id, 'debt_payment', 'paid', left('Pagamento — ' || v_d.name, 80), p_amount_cents, p_date, p_date,
     v_d.profile_id, p_account_id, v_d.category_id, p_debt_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- ============ settle_debt (quitação antecipada) ============
-- Registra o valor EFETIVAMENTE pago (uma transação, se > 0) e encerra a dívida. Guarda o desconto = saldo projetado -
-- valor pago. Nunca aceita pagar mais que o saldo projetado.
create or replace function public.settle_debt(
  p_debt_id uuid,
  p_account_id uuid,
  p_amount_cents bigint,
  p_date date
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_d record;
  v_paid bigint;
  v_remaining bigint;
  v_id uuid;
begin
  select * into v_d from public.debts d where d.id = p_debt_id for update;
  if not found then
    raise exception 'debt_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_d.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_d.status = 'canceled' then
    raise exception 'debt_canceled' using errcode = 'P0001';
  end if;
  if v_d.settled_at is not null then
    raise exception 'debt_settled_locked' using errcode = 'P0001';
  end if;
  if p_amount_cents is null or p_amount_cents < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  select coalesce(sum(t.amount_cents), 0) into v_paid
    from public.transactions t where t.debt_id = p_debt_id and t.kind = 'debt_payment' and t.status = 'paid';
  v_remaining := v_d.total_cents - v_paid;
  if v_remaining <= 0 then
    raise exception 'debt_already_paid' using errcode = 'P0001';
  end if;
  if p_amount_cents > v_remaining then
    raise exception 'payment_exceeds_remaining' using errcode = 'P0001';
  end if;

  if p_amount_cents > 0 then
    insert into public.transactions
      (household_id, kind, status, description, amount_cents, date, paid_at, profile_id, account_id, category_id, debt_id)
    values
      (v_d.household_id, 'debt_payment', 'paid', left('Quitação — ' || v_d.name, 80), p_amount_cents, p_date, p_date,
       v_d.profile_id, p_account_id, v_d.category_id, p_debt_id)
    returning id into v_id;
  end if;

  update public.debts d set settled_at = p_date, settlement_discount_cents = v_remaining - p_amount_cents
   where d.id = p_debt_id;

  return jsonb_build_object('payment_id', v_id, 'projected_cents', v_remaining, 'paid_cents', p_amount_cents,
                            'discount_cents', v_remaining - p_amount_cents);
end;
$$;

-- ============ reopen_debt (desfaz a quitação: o desconto volta a ser saldo devido) ============
create or replace function public.reopen_debt(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_d record;
begin
  select * into v_d from public.debts d where d.id = p_id for update;
  if not found then
    raise exception 'debt_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_d.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_d.settled_at is null then
    raise exception 'debt_not_settled' using errcode = 'P0001';
  end if;
  update public.debts d set settled_at = null, settlement_discount_cents = null where d.id = p_id;
end;
$$;

-- ============ set_debt_status ============
-- active <-> paused (pausada não entra no "disponível"). canceled só sem pagamentos (cadastro errado): com pagamentos,
-- quite a dívida. "Quitada" NUNCA é um status gravado: é derivada do saldo.
create or replace function public.set_debt_status(p_id uuid, p_status public.debt_status)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_d record;
begin
  select * into v_d from public.debts d where d.id = p_id for update;
  if not found then
    raise exception 'debt_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_d.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_d.settled_at is not null then
    raise exception 'debt_settled_locked' using errcode = 'P0001';
  end if;
  if p_status = 'canceled' and exists (
       select 1 from public.transactions t where t.debt_id = p_id and t.kind = 'debt_payment'
     ) then
    raise exception 'debt_has_payments' using errcode = 'P0001';
  end if;
  update public.debts d set status = p_status where d.id = p_id;
end;
$$;

revoke all on function public.create_debt(text, bigint, bigint, uuid, public.debt_kind, text, text, integer, date, uuid, uuid) from public, anon;
revoke all on function public.update_debt(uuid, jsonb) from public, anon;
revoke all on function public.pay_debt(uuid, uuid, bigint, date) from public, anon;
revoke all on function public.settle_debt(uuid, uuid, bigint, date) from public, anon;
revoke all on function public.reopen_debt(uuid) from public, anon;
revoke all on function public.set_debt_status(uuid, public.debt_status) from public, anon;
grant execute on function public.create_debt(text, bigint, bigint, uuid, public.debt_kind, text, text, integer, date, uuid, uuid) to authenticated;
grant execute on function public.update_debt(uuid, jsonb) to authenticated;
grant execute on function public.pay_debt(uuid, uuid, bigint, date) to authenticated;
grant execute on function public.settle_debt(uuid, uuid, bigint, date) to authenticated;
grant execute on function public.reopen_debt(uuid) to authenticated;
grant execute on function public.set_debt_status(uuid, public.debt_status) to authenticated;
