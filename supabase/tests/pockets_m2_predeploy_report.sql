create function pg_temp.try(q text) returns text language plpgsql as $f$
begin
  execute q;
  return 'ok';
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,48);
end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; p1 uuid; p2 uuid; a uuid; b uuid; pa uuid; pa2 uuid; pb uuid; cat1 uuid; e1 uuid;
  today date; out text := ''; v bigint; v2 bigint; r record; nm text; sig text;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'b@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  -- familia A
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where household_id = h1 and kind = 'individual';
  today := private.household_today(h1);
  select id into cat1 from public.categories where household_id = h1 and kind in ('expense','both') limit 1;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Conta A',100000) returning id into a;
  insert into public.pockets (household_id, profile_id, account_id, name) values (h1,p1,a,'Viagem') returning id into pa;
  insert into public.pockets (household_id, profile_id, account_id, name) values (h1,p1,a,'IPVA') returning id into pa2;
  perform private.pocket_write(pa, 'reserve', 30000, today);
  perform private.pocket_write(pa2, 'reserve', 10000, today);
  e1 := public.create_transaction('expense','Mercado',5000,today,p1,'paid',a,null,null,cat1);
  insert into public.goals (household_id, profile_id, name, target_cents, pocket_id) values (h1,p1,'Meta A',100000,pa);
  out := out || 'A (dono) pocket_transfer_write(pa->pa2,1000): ' || pg_temp.try(format('select private.pocket_transfer_write(%L,%L,1000,%L)', pa, pa2, today)) || ' (ok)' || E'\n';

  -- familia B
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  h2 := public.bootstrap_household('Casa B','Beto',false);
  select id into p2 from public.financial_profiles where household_id = h2 and kind = 'individual';
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h2,p2,'Conta B',50000) returning id into b;
  insert into public.pockets (household_id, profile_id, account_id, name) values (h2,p2,b,'Natal') returning id into pb;
  out := out || 'B (dono) pocket_write(pb, reserve 1000):       ' || pg_temp.try(format('select private.pocket_write(%L,%L,1000,%L)', pb,'reserve',today)) || ' (ok)' || E'\n';
  reset role;

  -- (1) e (2) privilegios efetivos
  out := out || E'\n== PRIVILEGIOS (quem pode EXECUTE) ==\n';
  for r in select p.oid, p.proname, p.prosecdef,
                  (select string_agg(coalesce(nullif(g.grantee,0)::regrole::text,'PUBLIC'), ',' order by g.grantee) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g where g.privilege_type='EXECUTE') as grantees,
                  has_function_privilege('anon', p.oid, 'execute') as anon_x,
                  has_function_privilege('authenticated', p.oid, 'execute') as auth_x
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'private'
              and p.proname in ('pocket_write','pocket_transfer_write','pocket_balance','account_reserved','tx_effect',
                                'lock_accounts','lock_pockets','lock_reserve_accounts','assert_account_backed','assert_use_consistent',
                                'check_reserve_backing_tx','check_reserve_backing_account','check_reserve_backing_movement',
                                'validate_pocket_movement','pocket_history_immutable','check_transfer_pair','check_pocket_nonneg',
                                'check_use_consistency_movement','check_use_consistency_tx','guard_pocket_use','validate_pocket')
            order by 2 loop
    out := out || format('%-32s definer=%-5s anon=%-5s authenticated=%-5s EXECUTE=[%s]', r.proname, r.prosecdef, r.anon_x, r.auth_x, r.grantees) || E'\n';
  end loop;
  out := out || format('search_path seguro (todas as DEFINER novas): %s funcoes sem search_path vazio (0)',
     (select count(*) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='private' and p.prosecdef
        and p.proname in ('pocket_write','pocket_transfer_write','lock_accounts','lock_pockets','lock_reserve_accounts','assert_account_backed','assert_use_consistent','check_reserve_backing_tx','check_reserve_backing_account','check_reserve_backing_movement','validate_pocket_movement','pocket_history_immutable','check_transfer_pair','check_pocket_nonneg','check_use_consistency_movement','check_use_consistency_tx','guard_pocket_use','validate_pocket')
        and not coalesce(p.proconfig::text,'') like '%search_path=""%')) || E'\n';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  out := out || 'authenticated chama lock_accounts direto:      ' || pg_temp.try(format('select private.lock_accounts(array[%L]::uuid[])', a)) || ' (ERR 42501)' || E'\n';
  out := out || 'authenticated chama lock_pockets direto:       ' || pg_temp.try(format('select private.lock_pockets(array[%L]::uuid[])', pa)) || ' (ERR 42501)' || E'\n';
  out := out || 'authenticated chama assert_account_backed:     ' || pg_temp.try(format('select private.assert_account_backed(%L)', a)) || ' (ERR 42501)' || E'\n';
  out := out || 'authenticated chama assert_use_consistent:     ' || pg_temp.try(format('select private.assert_use_consistent(%L)', e1)) || ' (ERR 42501)' || E'\n';
  reset role;
  set local role anon;
  out := out || 'anon chama pocket_write:                       ' || pg_temp.try(format('select private.pocket_write(%L,%L,1,current_date)', pa,'reserve')) || ' (ERR 42501)' || E'\n';
  out := out || 'anon chama pocket_transfer_write:              ' || pg_temp.try(format('select private.pocket_transfer_write(%L,%L,1,current_date)', pa, pa2)) || ' (ERR 42501)' || E'\n';
  out := out || 'anon chama pocket_balance:                     ' || pg_temp.try(format('select private.pocket_balance(%L)', pa)) || ' (ERR 42501)' || E'\n';
  out := out || 'anon le v_pocket_balances:                     ' || pg_temp.try('select count(*) from public.v_pocket_balances') || ' (ERR 42501)' || E'\n';
  reset role;

  -- (3) isolamento I1-I8: usuario B (outra familia) contra os dados da familia A
  out := out || E'\n== ISOLAMENTO I1-I8 (usuario B x familia A) ==\n';
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v from public.pockets where household_id = h1;
  select count(*) into v2 from public.pockets;
  out := out || format('I1a pockets:          B ve %s da familia A (0); total visivel a B: %s (1 = o proprio)', v, v2) || E'\n';
  select count(*) into v from public.pocket_movements where household_id = h1;
  select count(*) into v2 from public.pocket_movements;
  out := out || format('I1b pocket_movements: B ve %s da familia A (0); total visivel a B: %s (1 = o proprio)', v, v2) || E'\n';
  select count(*) into v from public.goals where household_id = h1;
  out := out || format('I1c goals:            B ve %s da familia A (0)', v) || E'\n';
  select count(*) into v from public.v_pocket_balances where household_id = h1;
  select count(*) into v2 from public.v_account_reserves where household_id = h1;
  out := out || format('I2  views:            v_pocket_balances=%s v_account_reserves=%s da familia A (0 / 0)', v, v2) || E'\n';
  select private.pocket_balance(pa) into v;
  select private.account_reserved(a) into v2;
  out := out || format('I2b pocket_balance(pa)=%s account_reserved(a)=%s (0 / 0: o RLS do INVOKER esconde)', v, v2) || E'\n';
  out := out || 'I3  pocket_write no cofrinho da A (reserve):      ' || pg_temp.try(format('select private.pocket_write(%L,%L,100,%L)', pa,'reserve',today)) || ' (ERR P0002)' || E'\n';
  out := out || 'I3b pocket_write no cofrinho da A (withdraw):     ' || pg_temp.try(format('select private.pocket_write(%L,%L,100,%L)', pa,'withdraw',today)) || ' (ERR P0002)' || E'\n';
  out := out || 'I4  pocket_transfer_write entre cofrinhos da A:   ' || pg_temp.try(format('select private.pocket_transfer_write(%L,%L,100,%L)', pa, pa2, today)) || ' (ERR P0002)' || E'\n';
  out := out || 'I4b transferir do cofrinho B para cofrinho da A:  ' || pg_temp.try(format('select private.pocket_transfer_write(%L,%L,100,%L)', pb, pa, today)) || ' (ERR P0002)' || E'\n';
  out := out || 'I5  usar TRANSACAO da A no cofrinho da B (use):   ' || pg_temp.try(format('select private.pocket_write(%L,%L,100,%L,null,%L)', pb,'use',today,e1)) || ' (ERR 22023)' || E'\n';
  out := out || 'I6  criar cofrinho em B com CONTA da A:           ' || pg_temp.try(format('insert into public.pockets (household_id, profile_id, account_id, name) values (%L,%L,%L,%L)', h2,p2,a,'X')) || ' (ERR P0001/23503)' || E'\n';
  out := out || 'I6b criar cofrinho em B com PERFIL da A:          ' || pg_temp.try(format('insert into public.pockets (household_id, profile_id, account_id, name) values (%L,%L,%L,%L)', h2,p1,b,'X')) || ' (ERR 23503)' || E'\n';
  out := out || 'I6c criar cofrinho NA familia A:                  ' || pg_temp.try(format('insert into public.pockets (household_id, profile_id, account_id, name) values (%L,%L,%L,%L)', h1,p1,a,'Invasor')) || ' (ERR 42501)' || E'\n';
  out := out || 'I7  criar objetivo na familia A:                  ' || pg_temp.try(format('insert into public.goals (household_id, profile_id, name, target_cents) values (%L,%L,%L,1000)', h1,p1,'Invasor')) || ' (ERR 42501)' || E'\n';
  out := out || 'I7b objetivo em B ligado ao COFRINHO da A (pa2, sem objetivo):' || pg_temp.try(format('insert into public.goals (household_id, profile_id, name, target_cents, pocket_id) values (%L,%L,%L,1000,%L)', h2,p2,'X',pa2)) || ' (ERR 23503)' || E'\n';
  update public.pockets set name = 'hack' where id = pa;      get diagnostics v = row_count;
  update public.goals set name = 'hack';                       get diagnostics v2 = row_count;
  out := out || format('I8  UPDATE em cofrinhos/objetivos da A: %s / %s linhas (0 / 0)', v, v2) || E'\n';
  out := out || 'I8b INSERT direto em pocket_movements da A:       ' || pg_temp.try(format('insert into public.pocket_movements (household_id,pocket_id,kind,amount_cents,movement_date) values (%L,%L,%L,1,%L)', h1,pa,'reserve',today)) || ' (ERR 42501)' || E'\n';
  get diagnostics v = row_count;
  reset role;

  -- prova de que nada da familia A foi alterado
  select name into nm from public.pockets where id = pa;
  select count(*) into v from public.pocket_movements where household_id = h1;
  select count(*) into v2 from public.goals where household_id = h1 and name = 'Meta A';
  out := out || format('INTACTO apos os ataques: cofrinho=%s movimentos da A=%s (3: reserve, reserve, transfer x2 = 4) objetivo=%s (1)', nm, v, v2) || E'\n';
  raise exception E'DRYRUN_ROLLBACK_PROPOSITAL\n%', out;
end $$;
