-- Bloco 2 / migration 7: novos households já nascem com as categorias padrão.
-- (mesma função do bloco 1, com uma chamada a seed_default_categories antes do retorno)
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

  perform public.seed_default_categories(v_household_id);

  return v_household_id;
end;
$$;

revoke all on function public.bootstrap_household(text, text, boolean, text) from public, anon;
grant execute on function public.bootstrap_household(text, text, boolean, text) to authenticated;
