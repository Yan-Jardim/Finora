-- Dívidas / migration 1: DÍVIDA (contrato) + vínculo do pagamento na transação.
--
-- Modelagem (sem dupla contagem):
--   * debts ............ o CONTRATO: valor original, total previsto, nº de parcelas e 1º vencimento. NUNCA soma em saldo,
--                        receitas ou despesas.
--   * parcelas ......... NÃO são tabela nem transação: o cronograma é DERIVADO (split_cents + datas) na view
--                        v_debt_installments. Uma obrigação futura não é dinheiro movido, então não vira Transaction.
--   * pagamentos ....... SÃO transactions (kind = debt_payment, status = paid, debt_id). Só elas movem saldo.
--   * pago / restante / progresso / situação "quitada" ... derivados em v_debt_summary (nada disso é gravado).
-- Quitação antecipada guarda só o FATO do acordo (data e desconto); o valor pago é a própria transação.

create type public.debt_kind as enum ('loan', 'financing', 'personal', 'external_installment', 'other');
create type public.debt_status as enum ('active', 'paused', 'canceled');

create table public.debts (
  id                         uuid primary key default gen_random_uuid(),
  household_id               uuid not null references public.households (id) on delete cascade,
  profile_id                 uuid not null,
  name                       text not null check (char_length(btrim(name)) between 1 and 80),
  creditor                   text check (creditor is null or char_length(creditor) <= 80),
  kind                       public.debt_kind not null default 'other',
  notes                      text check (notes is null or char_length(notes) <= 300),
  -- o que foi recebido/devido originalmente e o total previsto a pagar (a diferença é só "custo financeiro")
  principal_cents            bigint not null check (principal_cents > 0 and principal_cents <= 100000000000000),
  total_cents                bigint not null check (total_cents > 0 and total_cents <= 100000000000000),
  -- sem parcelas = NULL nos dois campos (pagamentos livres até zerar)
  installments_count         smallint check (installments_count is null or installments_count between 1 and 120),
  first_due_date             date,
  payment_account_id         uuid,
  category_id                uuid,
  status                     public.debt_status not null default 'active',
  -- quitação antecipada: data do acordo e o desconto (saldo projetado - valor realmente pago)
  settled_at                 date,
  settlement_discount_cents  bigint check (settlement_discount_cents is null or settlement_discount_cents >= 0),
  created_by                 uuid default auth.uid() references auth.users (id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint debts_household_id_id_key unique (household_id, id),
  constraint debts_profile_fk foreign key (household_id, profile_id)
    references public.financial_profiles (household_id, id),
  constraint debts_payment_account_fk foreign key (household_id, payment_account_id)
    references public.accounts (household_id, id),
  constraint debts_category_fk foreign key (household_id, category_id)
    references public.categories (household_id, id),

  constraint debts_total_not_below_principal check (total_cents >= principal_cents),
  constraint debts_schedule_pair check ((installments_count is null) = (first_due_date is null)),
  constraint debts_settlement_pair check ((settled_at is null) = (settlement_discount_cents is null)),
  constraint debts_canceled_not_settled check (status <> 'canceled' or settled_at is null)
);
comment on table public.debts is
  'Contrato da dívida. NUNCA somar. Parcelas = view derivada; pagamentos = transactions(debt_payment, debt_id).';

create index debts_household_status_idx on public.debts (household_id, status);
create index debts_household_profile_idx on public.debts (household_id, profile_id);
create index debts_household_account_idx on public.debts (household_id, payment_account_id);
create index debts_household_category_idx on public.debts (household_id, category_id);
create index debts_created_by_idx on public.debts (created_by);

create trigger set_updated_at before update on public.debts
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_change before update on public.debts
  for each row execute function private.prevent_tenant_change();

alter table public.debts enable row level security;
revoke all on public.debts from anon, authenticated;
-- Sem DELETE: dívida não é excluída pelo cliente (cancelar só sem pagamentos; senão, quitar/pausar).
grant select, insert, update on public.debts to authenticated;

create policy debts_select on public.debts
  for select to authenticated using ((select private.is_member(household_id)));
create policy debts_insert on public.debts
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy debts_update on public.debts
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));

-- ---------------------------------------------------------------- vínculo na transação
alter table public.transactions
  add column debt_id uuid,
  add constraint transactions_debt_fk foreign key (household_id, debt_id)
    references public.debts (household_id, id),
  -- pagamento de dívida é sempre uma saída REAL: pago (corrigir = excluir o pagamento)
  add constraint transactions_debt_payment_only check (debt_id is null or (kind = 'debt_payment' and status = 'paid'));

create index transactions_debt_idx on public.transactions (household_id, debt_id) where debt_id is not null;

-- Pagamento de dívida só muda pelo fluxo da dívida: o genérico (update_transaction, status, valor, conta, data) é
-- recusado. Excluir é permitido (reabre o saldo), exceto se a dívida foi QUITADA (reabra a dívida antes).
-- Alterações que não tocam nos campos financeiros (ex.: ON DELETE SET NULL de created_by) passam.
create or replace function private.guard_debt_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (old.debt_id is not null or new.debt_id is not null)
       and (new.amount_cents, new.date, new.status, new.paid_at, new.account_id, new.debt_id, new.kind)
           is distinct from (old.amount_cents, old.date, old.status, old.paid_at, old.account_id, old.debt_id, old.kind) then
      raise exception 'use_debt_flow' using errcode = '22023';
    end if;
    return new;
  end if;

  if old.debt_id is not null
     and exists (select 1 from public.debts d where d.id = old.debt_id and d.settled_at is not null) then
    raise exception 'debt_settled_locked' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_debt_payment() from public, anon, authenticated;
create trigger d_guard_debt_payment before update or delete on public.transactions
  for each row execute function private.guard_debt_payment();

-- Invariante final (adiada para o COMMIT): pagamentos nunca excedem o total da dívida.
create or replace function private.check_debt_not_overpaid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := '{}';
  v_id uuid;
  v_total bigint;
  v_paid bigint;
begin
  if tg_op <> 'DELETE' and new.debt_id is not null then v_ids := array_append(v_ids, new.debt_id); end if;
  if tg_op <> 'INSERT' and old.debt_id is not null then v_ids := array_append(v_ids, old.debt_id); end if;
  foreach v_id in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_ids) x) loop
    select d.total_cents into v_total from public.debts d where d.id = v_id;
    if v_total is null then
      continue; -- dívida já removida (cascata do household)
    end if;
    select coalesce(sum(t.amount_cents), 0) into v_paid
      from public.transactions t where t.debt_id = v_id and t.kind = 'debt_payment' and t.status = 'paid';
    if v_paid > v_total then
      raise exception 'debt_overpaid' using errcode = 'P0001';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.check_debt_not_overpaid() from public, anon, authenticated;
create constraint trigger check_debt_not_overpaid after insert or update or delete on public.transactions
  deferrable initially deferred
  for each row execute function private.check_debt_not_overpaid();
