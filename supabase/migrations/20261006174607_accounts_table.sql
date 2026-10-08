-- Bloco 2 / migration 5: accounts.
-- Dinheiro em centavos (bigint). NÃO existe coluna de saldo atual: o saldo é derivado das movimentações.
-- FK composta (household_id, owner_profile_id) -> financial_profiles: dono sempre do mesmo household.

create type public.account_type as enum ('checking', 'digital', 'savings', 'wallet', 'cash', 'investment', 'other');

create table public.accounts (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households (id) on delete cascade,
  owner_profile_id       uuid not null,
  name                   text not null check (char_length(btrim(name)) between 1 and 60),
  institution            text check (institution is null or char_length(btrim(institution)) between 1 and 60),
  type                   public.account_type not null default 'checking',
  initial_balance_cents  bigint not null default 0
                           check (initial_balance_cents between -100000000000000 and 100000000000000),
  color                  text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon                   text not null default 'landmark' check (char_length(icon) between 1 and 40),
  include_in_net_worth   boolean not null default true,
  is_active              boolean not null default true,
  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint accounts_household_id_id_key unique (household_id, id),
  constraint accounts_owner_profile_fk foreign key (household_id, owner_profile_id)
    references public.financial_profiles (household_id, id)
);
comment on table public.accounts is 'Contas/carteiras. Saldo atual = initial_balance_cents + movimentações pagas (view futura); nunca armazenado.';

create unique index accounts_household_name_key on public.accounts (household_id, lower(name));
create index accounts_household_owner_idx on public.accounts (household_id, owner_profile_id);
create index accounts_created_by_idx on public.accounts (created_by);

create trigger set_updated_at before update on public.accounts
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_change before update on public.accounts
  for each row execute function private.prevent_tenant_change();

alter table public.accounts enable row level security;
revoke all on public.accounts from anon, authenticated;
grant select, insert, update, delete on public.accounts to authenticated;

create policy accounts_select on public.accounts
  for select to authenticated using ((select private.is_member(household_id)));
create policy accounts_insert on public.accounts
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy accounts_update on public.accounts
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));
create policy accounts_delete on public.accounts
  for delete to authenticated using ((select private.can_write(household_id)));
