-- Bloco 2 / migration 6: credit_cards.
-- Limite em centavos. Guarda apenas os 4 últimos dígitos: NUNCA número completo nem CVV (não há coluna para isso).
-- FKs compostas: dono (financial_profiles) e conta de pagamento (accounts) sempre do MESMO household.

create type public.card_brand as enum ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'other');

create table public.credit_cards (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  owner_profile_id    uuid not null,
  payment_account_id  uuid not null,
  name                text not null check (char_length(btrim(name)) between 1 and 60),
  brand               public.card_brand,
  limit_cents         bigint not null check (limit_cents > 0 and limit_cents <= 100000000000000),
  closing_day         smallint not null check (closing_day between 1 and 31),
  due_day             smallint not null check (due_day between 1 and 31),
  last4               char(4) check (last4 ~ '^[0-9]{4}$'),
  color               text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active           boolean not null default true,
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint credit_cards_household_id_id_key unique (household_id, id),
  constraint credit_cards_owner_profile_fk foreign key (household_id, owner_profile_id)
    references public.financial_profiles (household_id, id),
  constraint credit_cards_payment_account_fk foreign key (household_id, payment_account_id)
    references public.accounts (household_id, id)
);
comment on table public.credit_cards is 'Cartões de crédito. Apenas last4 é armazenado; nunca PAN completo nem CVV.';
comment on column public.credit_cards.last4 is 'Somente os 4 últimos dígitos.';

create unique index credit_cards_household_name_key on public.credit_cards (household_id, lower(name));
create index credit_cards_household_owner_idx on public.credit_cards (household_id, owner_profile_id);
create index credit_cards_household_payment_account_idx on public.credit_cards (household_id, payment_account_id);
create index credit_cards_created_by_idx on public.credit_cards (created_by);

create trigger set_updated_at before update on public.credit_cards
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_change before update on public.credit_cards
  for each row execute function private.prevent_tenant_change();

alter table public.credit_cards enable row level security;
revoke all on public.credit_cards from anon, authenticated;
grant select, insert, update, delete on public.credit_cards to authenticated;

create policy credit_cards_select on public.credit_cards
  for select to authenticated using ((select private.is_member(household_id)));
create policy credit_cards_insert on public.credit_cards
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy credit_cards_update on public.credit_cards
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));
create policy credit_cards_delete on public.credit_cards
  for delete to authenticated using ((select private.can_write(household_id)));
