-- Migration 2/3 (bloco 1): tabelas de identidade/household.
-- RLS é habilitado NA MESMA migration em que as tabelas nascem; sem policies = acesso negado.
-- As policies entram na migration 3.

-- ============ households ============
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  currency    char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  timezone    text not null default 'America/Sao_Paulo',
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.households is 'Raiz do multi-tenant: casal hoje, N households no SaaS.';

-- ============ user_profiles ============
create table public.user_profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  display_name       text not null default '' check (char_length(display_name) <= 80),
  avatar_url         text,
  locale             text not null default 'pt-BR',
  last_household_id  uuid references public.households (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.user_profiles is 'Dados do app sobre o login (1:1 com auth.users).';
create index user_profiles_last_household_idx on public.user_profiles (last_household_id);

-- ============ household_members ============
create table public.household_members (
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.household_role not null default 'member',
  created_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
comment on table public.household_members is 'Quem acessa cada household e com qual papel.';
create index household_members_user_id_idx on public.household_members (user_id);

-- ============ financial_profiles ============
create table public.financial_profiles (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  user_id       uuid,
  name          text not null check (char_length(btrim(name)) between 1 and 40),
  kind          public.profile_kind not null default 'individual',
  color         text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  avatar_url    text,
  is_active     boolean not null default true,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- alvo das FKs compostas dos próximos blocos (impede referência entre households)
  constraint financial_profiles_household_id_id_key unique (household_id, id),
  -- o login vinculado precisa ser membro do MESMO household; se o membro sai, o vínculo é limpo
  constraint financial_profiles_member_fk
    foreign key (household_id, user_id)
    references public.household_members (household_id, user_id)
    on delete set null (user_id),
  -- perfil compartilhado (Casal) não pertence a um login
  constraint financial_profiles_shared_without_user check (kind = 'individual' or user_id is null)
);
comment on table public.financial_profiles is 'Dono do dinheiro: pessoa (individual) ou Casal (shared). user_id é opcional: nem toda pessoa tem login.';
create unique index financial_profiles_household_name_key on public.financial_profiles (household_id, lower(name));
create unique index financial_profiles_household_user_key on public.financial_profiles (household_id, user_id) where user_id is not null;

-- ============ triggers ============
create trigger set_updated_at before update on public.households
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.user_profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.financial_profiles
  for each row execute function private.set_updated_at();

create trigger prevent_tenant_change before update on public.households
  for each row execute function private.prevent_tenant_change();
create trigger prevent_tenant_change before update on public.financial_profiles
  for each row execute function private.prevent_tenant_change();

-- Todo household precisa manter ao menos um owner (não pode sair/ser rebaixado o último).
-- Na exclusão do household inteiro (cascade) a regra não se aplica.
create or replace function private.guard_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if exists (select 1 from public.households h where h.id = old.household_id)
       and not exists (
         select 1 from public.household_members m
         where m.household_id = old.household_id and m.role = 'owner' and m.user_id <> old.user_id
       ) then
      raise exception 'O household precisa ter pelo menos um owner.' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_last_owner() from public, anon, authenticated;

create trigger guard_last_owner before update or delete on public.household_members
  for each row execute function private.guard_last_owner();

-- ============ novo usuário -> user_profiles ============
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.handle_new_user() to supabase_auth_admin;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Usuários que já existam ganham o perfil (idempotente).
insert into public.user_profiles (id, display_name)
select u.id, left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(u.email, ''), '@', 1)), 80)
from auth.users u
on conflict (id) do nothing;

-- ============ RLS ligado + privilégios mínimos ============
alter table public.households          enable row level security;
alter table public.user_profiles       enable row level security;
alter table public.household_members   enable row level security;
alter table public.financial_profiles  enable row level security;

revoke all on public.households, public.user_profiles, public.household_members, public.financial_profiles from anon, authenticated;

-- Escritas diretas só onde o app precisa; criação de household/membros é via função (bootstrap).
grant select on public.households to authenticated;
grant update (name, currency, timezone) on public.households to authenticated;
grant delete on public.households to authenticated;

grant select on public.user_profiles to authenticated;
grant update (display_name, avatar_url, locale, last_household_id) on public.user_profiles to authenticated;

grant select, delete on public.household_members to authenticated;
grant update (role) on public.household_members to authenticated;

grant select, insert, update, delete on public.financial_profiles to authenticated;
