-- Recorrências / migration 1: TEMPLATE (recurring_transactions) separado das MOVIMENTAÇÕES GERADAS (transactions).
--
-- Regra de ouro: o template NUNCA entra em somas. Só `transactions` soma (saldo, despesas, dashboard, views).
-- Cada ocorrência é uma Transaction comum ligada ao template por (recurring_transaction_id, occurrence_date),
-- com índice ÚNICO nesse par => gerar duas vezes jamais duplica ("Internet novembro" nunca existe 2x).
--
-- Tags do template ficam em array (normalizado por private.normalize_tags) e são copiadas para cada ocorrência
-- na geração. Excluir uma ocorrência gerada registra um "skip" (recurring_skips) para a sincronização não recriá-la.
-- Templates não podem ser excluídos pelo cliente (sem policy/grant de DELETE): só pausar.

create type public.recurrence_frequency as enum ('weekly', 'monthly', 'yearly');

create table public.recurring_transactions (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  -- Fase 1: receita, despesa e compra recorrente no cartão (nunca parcelada: parcelamento é outra coisa).
  kind             public.transaction_kind not null,
  description      text not null check (char_length(btrim(description)) between 1 and 80),
  amount_cents     bigint not null check (amount_cents > 0 and amount_cents <= 100000000000000),
  profile_id       uuid not null,
  account_id       uuid,
  card_id          uuid,
  category_id      uuid not null,
  notes            text check (notes is null or char_length(notes) <= 300),
  tags             text[] not null default '{}' check (cardinality(tags) <= 10),
  frequency        public.recurrence_frequency not null,
  -- "a cada N" semanas/meses/anos
  interval_count   smallint not null default 1 check (interval_count between 1 and 24),
  -- data ÂNCORA: dia do mês (ou dia da semana) vem dela; dias inexistentes caem no último dia válido do mês
  start_date       date not null,
  end_date         date,
  -- Nada é gerado antes desta data: o passado nunca é "reconstruído" (histórico é do usuário).
  materialize_from date not null,
  is_active        boolean not null default true,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint recurring_transactions_household_id_id_key unique (household_id, id),
  constraint recurring_transactions_profile_fk foreign key (household_id, profile_id)
    references public.financial_profiles (household_id, id),
  constraint recurring_transactions_account_fk foreign key (household_id, account_id)
    references public.accounts (household_id, id),
  constraint recurring_transactions_card_fk foreign key (household_id, card_id)
    references public.credit_cards (household_id, id),
  constraint recurring_transactions_category_fk foreign key (household_id, category_id)
    references public.categories (household_id, id),

  constraint recurring_transactions_kind_allowed check (kind in ('income', 'expense', 'credit_card_purchase')),
  -- receita/despesa: conta; compra no cartão: cartão (sem conta). Mesmo formato das transações geradas.
  constraint recurring_transactions_kind_shape check (
    case kind
      when 'credit_card_purchase' then card_id is not null and account_id is null
      else account_id is not null and card_id is null
    end
  ),
  constraint recurring_transactions_date_range check (end_date is null or end_date >= start_date),
  constraint recurring_transactions_materialize_from_check check (materialize_from >= start_date)
);
comment on table public.recurring_transactions is
  'TEMPLATE de recorrência. NUNCA somar: as ocorrências são transactions (recurring_transaction_id + occurrence_date).';

create index recurring_transactions_household_active_idx on public.recurring_transactions (household_id, is_active);
create index recurring_transactions_household_profile_idx on public.recurring_transactions (household_id, profile_id);
create index recurring_transactions_household_account_idx on public.recurring_transactions (household_id, account_id);
create index recurring_transactions_household_card_idx on public.recurring_transactions (household_id, card_id);
create index recurring_transactions_household_category_idx on public.recurring_transactions (household_id, category_id);
create index recurring_transactions_created_by_idx on public.recurring_transactions (created_by);

create trigger set_updated_at before update on public.recurring_transactions
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_change before update on public.recurring_transactions
  for each row execute function private.prevent_tenant_change();

alter table public.recurring_transactions enable row level security;
revoke all on public.recurring_transactions from anon, authenticated;
-- Sem DELETE: não existe exclusão destrutiva de recorrência (só pausar).
grant select, insert, update on public.recurring_transactions to authenticated;

create policy recurring_transactions_select on public.recurring_transactions
  for select to authenticated using ((select private.is_member(household_id)));
create policy recurring_transactions_insert on public.recurring_transactions
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy recurring_transactions_update on public.recurring_transactions
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));

-- Ocorrências excluídas pelo usuário ("pular este mês"): a sincronização não as recria.
create table public.recurring_skips (
  household_id              uuid not null references public.households (id) on delete cascade,
  recurring_transaction_id  uuid not null,
  occurrence_date           date not null,
  created_at                timestamptz not null default now(),
  primary key (recurring_transaction_id, occurrence_date),
  constraint recurring_skips_recurring_fk foreign key (household_id, recurring_transaction_id)
    references public.recurring_transactions (household_id, id) on delete cascade
);
comment on table public.recurring_skips is 'Ocorrências ignoradas pelo usuário. Gravada só pelo trigger; leitura por membros.';
create index recurring_skips_household_idx on public.recurring_skips (household_id);

alter table public.recurring_skips enable row level security;
revoke all on public.recurring_skips from anon, authenticated;
grant select on public.recurring_skips to authenticated;
create policy recurring_skips_select on public.recurring_skips
  for select to authenticated using ((select private.is_member(household_id)));

-- ---------------------------------------------------------------- vínculo na transação gerada
alter table public.transactions
  add column recurring_transaction_id uuid,
  add column occurrence_date date,
  -- ocorrência futura cancelada PELA REGRA (pausa/mudança de agenda): a sincronização pode reativá-la.
  -- Cancelamento feito pelo usuário (false) nunca é desfeito pela regra.
  add column canceled_by_rule boolean not null default false,
  add constraint transactions_recurring_fk foreign key (household_id, recurring_transaction_id)
    references public.recurring_transactions (household_id, id),
  add constraint transactions_recurring_pair check ((recurring_transaction_id is null) = (occurrence_date is null)),
  add constraint transactions_recurring_not_installment check (recurring_transaction_id is null or installment_purchase_id is null),
  add constraint transactions_rule_canceled_status check (not canceled_by_rule or status = 'canceled');

-- UMA ocorrência por (recorrência, data): é o que torna a geração idempotente.
create unique index transactions_recurring_occurrence_key
  on public.transactions (recurring_transaction_id, occurrence_date)
  where recurring_transaction_id is not null;
create index transactions_recurring_idx on public.transactions (household_id, recurring_transaction_id)
  where recurring_transaction_id is not null;

-- O vínculo com a regra é imutável (mudar a data da ocorrência é permitido; a chave de geração não).
create or replace function private.prevent_recurrence_link_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recurring_transaction_id is distinct from old.recurring_transaction_id
     or new.occurrence_date is distinct from old.occurrence_date then
    raise exception 'recurrence_link_immutable' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_recurrence_link_change() from public, anon, authenticated;
create trigger prevent_recurrence_link_change before update on public.transactions
  for each row execute function private.prevent_recurrence_link_change();

-- Excluir uma ocorrência gerada = "pular": registra o skip (se o template ainda existir e o household não estiver
-- sendo excluído em cascata).
create or replace function private.record_recurring_skip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.recurring_transaction_id is not null
     and exists (select 1 from public.households h where h.id = old.household_id)
     and exists (
       select 1 from public.recurring_transactions r
        where r.household_id = old.household_id and r.id = old.recurring_transaction_id
     ) then
    insert into public.recurring_skips (household_id, recurring_transaction_id, occurrence_date)
    values (old.household_id, old.recurring_transaction_id, old.occurrence_date)
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.record_recurring_skip() from public, anon, authenticated;
create trigger z_record_recurring_skip after delete on public.transactions
  for each row execute function private.record_recurring_skip();
