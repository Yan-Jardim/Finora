-- Migration 3/3 (bloco 1): funções auxiliares de RLS, policies e bootstrap_household.
-- (household_invites / accept_invite: previstos na arquitetura, NÃO implementados neste bloco.)

-- ============ funções auxiliares de RLS (schema private, SECURITY DEFINER, search_path vazio) ============
create or replace function private.is_member(p_household_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.can_write(p_household_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'member')
  );
$$;

create or replace function private.is_owner(p_household_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household_id and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

-- O usuário p_user_id divide algum household com o usuário logado?
create or replace function private.shares_household_with(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members mine
    join public.household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user_id
  );
$$;

revoke all on function private.is_member(uuid), private.can_write(uuid), private.is_owner(uuid), private.shares_household_with(uuid)
  from public, anon;
grant execute on function private.is_member(uuid), private.can_write(uuid), private.is_owner(uuid), private.shares_household_with(uuid)
  to authenticated;

-- ============ policies ============
-- households: membros leem; só owner altera/exclui; criação SOMENTE via bootstrap_household.
create policy households_select on public.households
  for select to authenticated
  using ((select private.is_member(id)));

create policy households_update on public.households
  for update to authenticated
  using ((select private.is_owner(id)))
  with check ((select private.is_owner(id)));

create policy households_delete on public.households
  for delete to authenticated
  using ((select private.is_owner(id)));

-- user_profiles: o próprio usuário e quem divide household com ele leem; só o próprio edita.
create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.shares_household_with(id)));

create policy user_profiles_update on public.user_profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (last_household_id is null or (select private.is_member(last_household_id)))
  );

-- household_members: sem INSERT direto (entrada só por bootstrap/convite).
create policy household_members_select on public.household_members
  for select to authenticated
  using ((select private.is_member(household_id)));

create policy household_members_update on public.household_members
  for update to authenticated
  using ((select private.is_owner(household_id)))
  with check ((select private.is_owner(household_id)));

create policy household_members_delete on public.household_members
  for delete to authenticated
  using ((select private.is_owner(household_id)) or user_id = (select auth.uid()));

-- financial_profiles: membros leem; owner/member escrevem. Só owner vincula um login diferente do próprio.
create policy financial_profiles_select on public.financial_profiles
  for select to authenticated
  using ((select private.is_member(household_id)));

create policy financial_profiles_insert on public.financial_profiles
  for insert to authenticated
  with check (
    (select private.can_write(household_id))
    and (user_id is null or user_id = (select auth.uid()) or (select private.is_owner(household_id)))
  );

create policy financial_profiles_update on public.financial_profiles
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check (
    (select private.can_write(household_id))
    and (user_id is null or user_id = (select auth.uid()) or (select private.is_owner(household_id)))
  );

create policy financial_profiles_delete on public.financial_profiles
  for delete to authenticated
  using ((select private.can_write(household_id)));

-- ============ bootstrap_household ============
-- Único caminho para criar um household: cria household + membro owner + perfil individual
-- (+ perfil compartilhado opcional) para o usuário autenticado. SECURITY DEFINER com checagens explícitas.
create or replace function public.bootstrap_household(
  p_household_name text,
  p_display_name text,
  p_create_couple_profile boolean default true,
  p_couple_profile_name text default 'Casal'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_household_name text := btrim(coalesce(p_household_name, ''));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_couple_name text := btrim(coalesce(p_couple_profile_name, ''));
  v_household_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if char_length(v_household_name) not between 1 and 80 then
    raise exception 'invalid_household_name' using errcode = '22023';
  end if;
  if char_length(v_display_name) not between 1 and 40 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  if p_create_couple_profile and (char_length(v_couple_name) not between 1 and 40 or lower(v_couple_name) = lower(v_display_name)) then
    raise exception 'invalid_couple_name' using errcode = '22023';
  end if;

  -- Evita household duplicado por duplo clique / requisições concorrentes do mesmo usuário.
  perform pg_advisory_xact_lock(hashtextextended('bootstrap_household:' || v_uid::text, 0));

  if exists (select 1 from public.household_members m where m.user_id = v_uid) then
    raise exception 'already_onboarded' using errcode = 'P0001';
  end if;

  insert into public.households (name, created_by)
  values (v_household_name, v_uid)
  returning id into v_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, v_uid, 'owner');

  insert into public.financial_profiles (household_id, user_id, name, kind, color, created_by)
  values (v_household_id, v_uid, v_display_name, 'individual', '#4f46e5', v_uid);

  if p_create_couple_profile then
    insert into public.financial_profiles (household_id, user_id, name, kind, color, created_by)
    values (v_household_id, null, v_couple_name, 'shared', '#0d9488', v_uid);
  end if;

  update public.user_profiles
     set display_name = v_display_name, last_household_id = v_household_id
   where id = v_uid;

  return v_household_id;
end;
$$;

comment on function public.bootstrap_household(text, text, boolean, text) is
  'Cria o household do usuário autenticado (owner) com perfil individual e, opcionalmente, o perfil Casal.';

revoke all on function public.bootstrap_household(text, text, boolean, text) from public, anon;
grant execute on function public.bootstrap_household(text, text, boolean, text) to authenticated;
