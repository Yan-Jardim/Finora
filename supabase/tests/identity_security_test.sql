-- Teste de segurança do bloco 1 (identidade/household). Reexecutável.
-- Cria usuários e dados de teste DENTRO de um bloco que termina em RAISE EXCEPTION: tudo é revertido
-- (nenhum dado persiste) e o relatório aparece na mensagem de erro. Compare cada linha com o "(esperado ...)".
-- Como rodar: SQL Editor do Supabase, ou `execute_sql` do MCP, ou `psql -f`.

create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok rows='||n;
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,110); end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; out text := ''; v bigint;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'u1@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'u2@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  select count(*) into v from public.user_profiles where id in (u1,u2);
  out := out || format('T0  trigger cria user_profiles para novos usuarios: %s (esperado 2)', v) || E'\n';

  -- ================= usuario 1 (autenticado) =================
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa Teste','Ana',true,'Casal');
  out := out || format('T1  bootstrap_household retornou id: %s', h1 is not null) || E'\n';
  select count(*) into v from public.households;         out := out || format('T2  u1 ve households=%s (1)', v) || E'\n';
  select count(*) into v from public.household_members;  out := out || format('T3  u1 ve members=%s (1)', v) || E'\n';
  select count(*) into v from public.financial_profiles; out := out || format('T4  u1 ve financial_profiles=%s (2: Ana + Casal)', v) || E'\n';
  select count(*) into v from public.financial_profiles where kind='individual' and user_id=u1 and name='Ana';
  out := out || format('T5  perfil individual vinculado ao login: %s (1)', v) || E'\n';
  select count(*) into v from public.household_members where role='owner' and user_id=u1;
  out := out || format('T6  u1 e owner: %s (1)', v) || E'\n';
  select count(*) into v from public.user_profiles where id=u1 and display_name='Ana' and last_household_id=h1;
  out := out || format('T7  user_profiles atualizado (nome + last_household): %s (1)', v) || E'\n';
  out := out || 'T8  bootstrap duplicado:   ' || pg_temp.try('select public.bootstrap_household(''Outra'',''Ana'',false)') || ' (esperado ERR P0001 already_onboarded)' || E'\n';
  out := out || 'T9  owner cria perfil:     ' || pg_temp.try(format('insert into public.financial_profiles (household_id,name) values (%L,%L)', h1, 'Extra')) || ' (ok rows=1)' || E'\n';
  out := out || 'T10 nome duplicado:        ' || pg_temp.try(format('insert into public.financial_profiles (household_id,name) values (%L,%L)', h1, 'extra')) || ' (ERR 23505)' || E'\n';
  out := out || 'T11 vincular nao-membro:   ' || pg_temp.try(format('insert into public.financial_profiles (household_id,name,user_id) values (%L,%L,%L)', h1, 'Fantasma', u2)) || ' (ERR 23503/42501)' || E'\n';
  out := out || 'T12 owner renomeia household: ' || pg_temp.try(format('update public.households set name=%L where id=%L','Casa Renomeada',h1)) || ' (ok rows=1)' || E'\n';
  out := out || 'T13 insert direto household: ' || pg_temp.try('insert into public.households (name) values (''X'')') || ' (ERR 42501)' || E'\n';
  out := out || 'T14 insert direto member:    ' || pg_temp.try(format('insert into public.household_members (household_id,user_id,role) values (%L,%L,%L)', h1, u1, 'owner')) || ' (ERR 42501)' || E'\n';
  out := out || 'T15 ultimo owner sai:        ' || pg_temp.try(format('delete from public.household_members where household_id=%L and user_id=%L', h1, u1)) || ' (ERR P0001 guard_last_owner)' || E'\n';
  out := out || 'T16 rebaixar ultimo owner:   ' || pg_temp.try(format('update public.household_members set role=%L where household_id=%L and user_id=%L','member', h1, u1)) || ' (ERR P0001)' || E'\n';
  out := out || 'T17 trocar household_id:     ' || pg_temp.try(format('update public.financial_profiles set household_id=%L where household_id=%L and name=%L', gen_random_uuid(), h1, 'Extra')) || ' (ERR 23503/42501)' || E'\n';
  out := out || 'T18 updated_at trigger:      ' || pg_temp.try(format('update public.financial_profiles set color=%L where household_id=%L and name=%L','#112233',h1,'Extra')) || ' (ok rows=1)' || E'\n';
  out := out || 'T19 last_household alheio:   ' || pg_temp.try(format('update public.user_profiles set last_household_id=%L where id=%L', gen_random_uuid(), u1)) || ' (ERR 42501 / FK)' || E'\n';
  reset role;

  -- ================= usuario 2 (autenticado, outro household) =================
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  out := out || E'\n--- u2 SEM household ---\n';
  select count(*) into v from public.households;         out := out || format('T20 u2 ve households=%s (0)', v) || E'\n';
  select count(*) into v from public.household_members;  out := out || format('T21 u2 ve members=%s (0)', v) || E'\n';
  select count(*) into v from public.financial_profiles; out := out || format('T22 u2 ve financial_profiles=%s (0)', v) || E'\n';
  select count(*) into v from public.user_profiles;      out := out || format('T23 u2 ve user_profiles=%s (1: so o proprio)', v) || E'\n';
  out := out || 'T24 u2 insere perfil no h1:  ' || pg_temp.try(format('insert into public.financial_profiles (household_id,name) values (%L,%L)', h1, 'Intruso')) || ' (ERR 42501 RLS)' || E'\n';
  out := out || 'T25 u2 renomeia h1:          ' || pg_temp.try(format('update public.households set name=%L where id=%L','HACK',h1)) || ' (ok rows=0)' || E'\n';
  out := out || 'T26 u2 apaga h1:             ' || pg_temp.try(format('delete from public.households where id=%L',h1)) || ' (ok rows=0)' || E'\n';
  out := out || 'T27 u2 apaga perfis do h1:   ' || pg_temp.try(format('delete from public.financial_profiles where household_id=%L',h1)) || ' (ok rows=0)' || E'\n';
  out := out || 'T28 u2 vira owner do h1:     ' || pg_temp.try(format('insert into public.household_members (household_id,user_id,role) values (%L,%L,%L)', h1, u2, 'owner')) || ' (ERR 42501)' || E'\n';
  out := out || 'T29 u2 edita perfil do u1:   ' || pg_temp.try(format('update public.user_profiles set display_name=%L where id=%L','HACK',u1)) || ' (ok rows=0)' || E'\n';
  out := out || 'T30 u2 aponta last_household p/ h1: ' || pg_temp.try(format('update public.user_profiles set last_household_id=%L where id=%L',h1,u2)) || ' (ERR 42501)' || E'\n';
  h2 := public.bootstrap_household('Casa do U2','Bia',false);
  select count(*) into v from public.households;         out := out || format('T31 u2 apos bootstrap ve households=%s (1, so o dele)', v) || E'\n';
  select count(*) into v from public.financial_profiles; out := out || format('T32 u2 ve financial_profiles=%s (1: sem Casal)', v) || E'\n';
  reset role;

  -- ================= anon =================
  set local role anon;
  out := out || E'\n--- anon ---\n';
  out := out || 'T33 anon le households:     ' || pg_temp.try('select count(*) from public.households') || ' (ERR 42501)' || E'\n';
  out := out || 'T34 anon le profiles:       ' || pg_temp.try('select count(*) from public.financial_profiles') || ' (ERR 42501)' || E'\n';
  out := out || 'T35 anon bootstrap:         ' || pg_temp.try('select public.bootstrap_household(''A'',''B'')') || ' (ERR 42501)' || E'\n';
  reset role;

  -- ================= role authenticated sem sessao (auth.uid() nulo) =================
  perform set_config('request.jwt.claims', '{}', true);
  set local role authenticated;
  out := out || 'T36 authenticated sem sub:  ' || pg_temp.try('select public.bootstrap_household(''A'',''B'')') || ' (ERR 28000 not_authenticated)' || E'\n';
  select count(*) into v from public.households; out := out || format('T37 sem sub ve households=%s (0)', v) || E'\n';
  reset role;

  -- ================= u1: excluir household inteiro (cascade com guard do ultimo owner) =================
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  out := out || E'\n--- cascade ---\n';
  out := out || 'T38 owner apaga household: ' || pg_temp.try(format('delete from public.households where id=%L',h1)) || ' (ok rows=1)' || E'\n';
  reset role;
  select count(*) into v from public.household_members where household_id=h1;  out := out || format('T39 members restantes=%s (0)', v) || E'\n';
  select count(*) into v from public.financial_profiles where household_id=h1; out := out || format('T40 perfis restantes=%s (0)', v) || E'\n';

  raise exception E'\n==== RELATORIO (tudo sera revertido) ====\n%', out;
end $$;
