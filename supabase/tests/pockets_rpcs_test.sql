-- Teste das RPCs públicas dos cofrinhos (migration 3). Roda DEPOIS das migrations 1, 2 e 3.
-- SEM DELETE de dados do usuário (só o DELETE direto de despesa ligada, que DEVE ser bloqueado). Termina em RAISE EXCEPTION: NADA persiste.
-- Cada linha: PASS/FAIL + o que foi obtido. No fim: contagem de FAIL.

create function pg_temp.ex(q text, want text) returns text language plpgsql as $f$
begin
  execute q;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  return case when want = 'ok' then 'PASS ok' else 'FAIL esperava '||want||' mas executou' end;
exception when others then
  return case when want <> 'ok' and (sqlstate = want or sqlerrm like '%'||want||'%')
              then 'PASS '||sqlstate||' '||left(sqlerrm,36)
              else 'FAIL esperava '||want||' obtido '||sqlstate||' '||left(sqlerrm,60) end;
end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; p1 uuid; p2 uuid; cx uuid; cx2 uuid;
  a uuid; b uuid; inv uuid; bx uuid;
  pa uuid; pl uuid; pl2 uuid; pb uuid; pc uuid; pz uuid; pbx uuid;
  r jsonb; r2 jsonb; tx1 uuid; tx2 uuid; tx3 uuid; txz uuid; rv uuid;
  g1 uuid; g2 uuid; today date; out text := ''; v bigint; v2 bigint; v3 bigint; s text; n0 bigint; n1 bigint; st text;
  fns text[] := array['create_pocket','update_pocket','set_pocket_archived','pocket_reserve','pocket_withdraw','pocket_transfer','spend_from_pocket','reverse_pocket_use','link_goal_pocket'];
  f text; rec record; fails int;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'b@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  -- família B (para os testes de isolamento)
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  h2 := public.bootstrap_household('Casa B','Beto',false);
  select id into p2 from public.financial_profiles where household_id = h2 and kind = 'individual';
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h2,p2,'Conta Beto',10000) returning id into bx;
  pbx := public.create_pocket(p2, bx, 'Pocket Beto');

  -- família A
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where household_id = h1 and kind = 'individual';
  today := private.household_today(h1);
  select id into cx from public.categories where household_id = h1 and kind in ('expense','both') limit 1;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Conta A',100000) returning id into a;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Conta B',50000) returning id into b;
  insert into public.accounts (household_id, owner_profile_id, name, type, initial_balance_cents) values (h1,p1,'Corretora','investment',900000) returning id into inv;

  out := out || E'== create_pocket ==\n';
  pa := public.create_pocket(p1, a, 'Viagem', 'Inglaterra', 'plane', '#112233', 30000);
  select balance_cents into v from public.v_pocket_balances where pocket_id = pa;
  select reserved_cents into v2 from public.v_account_reserves where account_id = a;
  select count(*) into n0 from public.transactions where household_id = h1;
  out := out || format('%s C1 cria cofrinho com reserva inicial: saldo=%s reservado=%s transacoes=%s (30000 / 30000 / 0)', case when v=30000 and v2=30000 and n0=0 then 'PASS' else 'FAIL' end, v, v2, n0) || E'\n';
  pl := public.create_pocket(p1, a, 'Legado', null, 'piggy-bank', '#4f46e5', 10000, null, 'legacy-1');
  pl2 := public.create_pocket(p1, a, 'Legado', null, 'piggy-bank', '#4f46e5', 10000, null, 'legacy-1');
  select count(*) into n1 from public.pocket_movements where pocket_id = pl;
  out := out || format('%s C2 importacao idempotente (legacy_ref): mesmo id=%s, movimentos=%s (true / 1)', case when pl=pl2 and n1=1 then 'PASS' else 'FAIL' end, pl=pl2, n1) || E'\n';
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L)', p1, inv, 'Inv'), 'account_not_allowed') || ' C3 conta de investimento' || E'\n';
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L)', p1, bx, 'Alheia'), 'account_not_allowed') || ' C4 conta de OUTRO household' || E'\n';
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L)', p2, a, 'x'), 'profile_not_found') || ' C5 perfil de OUTRO household' || E'\n';
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L,null,null,null,-1)', p1, a, 'x'), 'invalid_amount') || ' C6 valor inicial negativo' || E'\n';
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L,null,null,null,999999999)', p1, a, 'Estoura'), 'insufficient_free') || ' C7 reserva inicial acima do livre' || E'\n';

  out := out || E'\n== update_pocket / arquivar ==\n';
  out := out || pg_temp.ex(format('select public.update_pocket(%L, %L::jsonb)', pa, '{"name":"Viagem Inglaterra","color":"#223344"}'), 'ok') || ' U1 renomear' || E'\n';
  out := out || pg_temp.ex(format('select public.update_pocket(%L, %L::jsonb)', pa, '{"account_id":"00000000-0000-0000-0000-000000000000"}'), 'invalid_patch_key') || ' U2 conta imutavel (chave invalida)' || E'\n';
  out := out || pg_temp.ex(format('select public.set_pocket_archived(%L, true)', pa), 'pocket_has_balance') || ' U3 arquivar com saldo' || E'\n';

  out := out || E'\n== reservar / retirar / transferir ==\n';
  out := out || pg_temp.ex(format('select public.pocket_reserve(%L, 60001)', pa), 'insufficient_free') || ' R1 reservar acima do livre (livre=60000)' || E'\n';
  perform public.pocket_reserve(pa, 20000, null, 'extra');
  out := out || pg_temp.ex(format('select public.pocket_withdraw(%L, 50001)', pa), 'insufficient_pocket') || ' R2 retirar acima do reservado' || E'\n';
  pb := public.create_pocket(p1, a, 'IPVA');
  perform public.pocket_transfer(pa, pb, 10000, null, 'ajuste');
  pc := public.create_pocket(p1, b, 'Natal');
  out := out || pg_temp.ex(format('select public.pocket_transfer(%L,%L,100)', pa, pc), 'different_accounts') || ' R3 transferir entre contas diferentes' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_transfer(%L,%L,100)', pa, pa), 'same_pocket') || ' R4 mesmo cofrinho' || E'\n';
  select balance_cents into v from public.v_pocket_balances where pocket_id = pa;
  select balance_cents into v2 from public.v_pocket_balances where pocket_id = pb;
  out := out || format('%s R5 apos transferir 10000: pa=%s pb=%s (40000 / 10000)', case when v=40000 and v2=10000 then 'PASS' else 'FAIL' end, v, v2) || E'\n';

  out := out || E'\n== spend_from_pocket (total e parcial) ==\n';
  r := public.spend_from_pocket(pa, 'Mercado', 8000, null, null, cx);
  tx1 := (r ->> 'transaction_id')::uuid;
  select balance_cents into v from public.v_account_reserves where account_id = a;
  select free_cents into v2 from public.v_account_reserves where account_id = a;
  select balance_cents into v3 from public.v_pocket_balances where pocket_id = pa;
  out := out || format('%s S1 uso TOTAL 8000: saldo=%s livre=%s pa=%s (92000 / 40000 / 32000) livre nao muda', case when v=92000 and v2=40000 and v3=32000 then 'PASS' else 'FAIL' end, v, v2, v3) || E'\n';
  r2 := public.spend_from_pocket(pb, 'Padaria', 5000, 3000, null, cx);
  tx2 := (r2 ->> 'transaction_id')::uuid;
  select balance_cents into v from public.v_account_reserves where account_id = a;
  select free_cents into v2 from public.v_account_reserves where account_id = a;
  select balance_cents into v3 from public.v_pocket_balances where pocket_id = pb;
  out := out || format('%s S2 uso PARCIAL (3000 de 5000): saldo=%s livre=%s pb=%s (87000 / 38000 / 7000)', case when v=87000 and v2=38000 and v3=7000 then 'PASS' else 'FAIL' end, v, v2, v3) || E'\n';
  select count(*) into n0 from public.transactions where household_id = h1;
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,2000,5000,null,%L)', pb, 'x', cx), 'amount_from_pocket_invalid') || ' S3 reserva maior que a despesa' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,2000,0,null,%L)', pb, 'x', cx), 'amount_from_pocket_invalid') || ' S4 reserva zero' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,2000,null,null,null)', pb, 'x'), 'category_required') || ' S5 sem categoria' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,0,null,null,%L)', pb, 'x', cx), 'invalid_amount') || ' S6 valor zero' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,2000,null,%L,%L)', pb, 'x', today + 1, cx), 'future_date') || ' S7 data futura' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,20000,7001,null,%L)', pb, 'x', cx), 'insufficient_pocket') || ' S8 reserva insuficiente no cofrinho (7000)' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,200000,1000,null,%L)', pb, 'x', cx), 'reserve_shortfall') || ' S9 despesa que deixaria reserva sem lastro' || E'\n';
  select count(*) into n1 from public.transactions where household_id = h1;
  out := out || format('%s S10 atomicidade: nenhuma despesa ficou das tentativas que falharam (%s -> %s)', case when n0=n1 then 'PASS' else 'FAIL' end, n0, n1) || E'\n';
  out := out || pg_temp.ex(format('select public.update_transaction(%L, %L::jsonb)', tx1, '{"amount_cents":1}'), 'use_pocket_flow') || ' S11 editar valor da despesa ligada' || E'\n';
  out := out || pg_temp.ex(format('delete from public.transactions where id = %L', tx1), 'use_pocket_flow') || ' S12 excluir a despesa ligada' || E'\n';
  out := out || pg_temp.ex(format('select public.update_transaction(%L, %L::jsonb)', tx1, '{"description":"Mercado do mes"}'), 'ok') || ' S13 editar so a descricao' || E'\n';

  out := out || E'\n== reverse_pocket_use (estorno integral do valor efetivamente usado) ==\n';
  select free_cents into v from public.v_account_reserves where account_id = a;
  rv := public.reverse_pocket_use(tx2, 'desisti');
  select balance_cents into v2 from public.v_account_reserves where account_id = a;
  select free_cents into v3 from public.v_account_reserves where account_id = a;
  select balance_cents into n0 from public.v_pocket_balances where pocket_id = pb;
  select status::text into st from public.transactions where id = tx2;
  select count(*) into n1 from public.pocket_movements where transaction_id = tx2;
  out := out || format('%s V1 estorno do uso PARCIAL: pb=%s (10000: so os 3000 voltam) saldo=%s (92000: a despesa INTEIRA volta) livre=%s (era %s, volta a 40000) despesa=%s movimentos=%s (2)',
                       case when n0=10000 and v2=92000 and v3=40000 and st='canceled' and n1=2 then 'PASS' else 'FAIL' end, n0, v2, v3, v, st, n1) || E'\n';
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', tx2), 'already_reversed') || ' V2 estornar duas vezes' || E'\n';
  rv := public.reverse_pocket_use(tx1);
  select balance_cents into v2 from public.v_account_reserves where account_id = a;
  select balance_cents into n0 from public.v_pocket_balances where pocket_id = pa;
  out := out || format('%s V3 estorno do uso TOTAL: pa=%s (40000) saldo=%s (100000)', case when n0=40000 and v2=100000 then 'PASS' else 'FAIL' end, n0, v2) || E'\n';
  tx3 := public.create_transaction('expense','Sem reserva',1000,today,p1,'paid',a,null,null,cx);
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', tx3), 'no_pocket_use') || ' V4 despesa sem uso de reserva' || E'\n';
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', gen_random_uuid()), 'transaction_not_found') || ' V5 transacao inexistente' || E'\n';
  pz := public.create_pocket(p1, b, 'Zero', null, null, null, 5000);
  r := public.spend_from_pocket(pz, 'Zerou', 5000, null, null, cx);
  txz := (r ->> 'transaction_id')::uuid;
  perform public.set_pocket_archived(pz, true);
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', txz), 'pocket_archived') || ' V6 estornar para cofrinho arquivado (reative antes)' || E'\n';
  perform public.set_pocket_archived(pz, false);
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', txz), 'ok') || ' V7 depois de reativar, o estorno passa' || E'\n';

  out := out || E'\n== objetivos: link_goal_pocket ==\n';
  insert into public.goals (household_id, profile_id, name, target_cents, manual_amount_cents) values (h1,p1,'Meta 1',100000,5000) returning id into g1;
  insert into public.goals (household_id, profile_id, name, target_cents) values (h1,p1,'Meta 2',100000) returning id into g2;
  perform public.link_goal_pocket(g1, pa);
  select manual_amount_cents into v from public.goals where id = g1;
  out := out || format('%s G1 vincular zera o valor manual: %s (0)', case when v=0 then 'PASS' else 'FAIL' end, v) || E'\n';
  out := out || pg_temp.ex(format('select public.link_goal_pocket(%L,%L)', g2, pa), 'pocket_already_linked') || ' G2 cofrinho ja ligado a outro objetivo' || E'\n';
  out := out || pg_temp.ex(format('select public.link_goal_pocket(%L,%L)', g2, pbx), 'pocket_not_found') || ' G3 cofrinho de OUTRO household' || E'\n';
  out := out || pg_temp.ex(format('select public.link_goal_pocket(%L,null)', g1), 'ok') || ' G4 desvincular' || E'\n';

  out := out || E'\n== privilegios e contrato ==\n';
  foreach f in array fns loop
    select p.oid, p.prosecdef, p.proconfig::text cfg, pg_get_function_identity_arguments(p.oid) args,
           has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x,
           coalesce((select bool_or(g.grantee = 0) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g), false) public_x
      into rec from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = f;
    out := out || format('%s %-20s invoker=%s search_path=%s anon=%s authenticated=%s public=%s sem_arg_household=%s',
       case when not rec.prosecdef and rec.cfg like '%search_path=%' and not rec.anon_x and rec.auth_x and not rec.public_x and rec.args not ilike '%household%' then 'PASS' else 'FAIL' end,
       f, not rec.prosecdef, rec.cfg is not null, rec.anon_x, rec.auth_x, rec.public_x, rec.args not ilike '%household%') || E'\n';
  end loop;
  out := out || pg_temp.ex(format('insert into public.pocket_movements (household_id,pocket_id,kind,amount_cents,movement_date) values (%L,%L,%L,1,%L)', h1, pa, 'reserve', today), '42501') || ' P1 escrita direta em pocket_movements' || E'\n';
  out := out || pg_temp.ex(format('select private.lock_accounts(array[%L]::uuid[])', a), '42501') || ' P2 funcao interna de lock' || E'\n';
  out := out || pg_temp.ex(format('select private.assert_account_backed(%L)', a), '42501') || ' P3 funcao interna de guarda' || E'\n';

  out := out || E'\n== isolamento (usuario B contra a familia A) ==\n';
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L)', p1, a, 'x'), 'profile_not_found') || ' I1 create_pocket com perfil da A' || E'\n';
  out := out || pg_temp.ex(format('select public.update_pocket(%L, %L::jsonb)', pa, '{"name":"hack"}'), 'pocket_not_found') || ' I2 update_pocket' || E'\n';
  out := out || pg_temp.ex(format('select public.set_pocket_archived(%L, true)', pa), 'pocket_not_found') || ' I3 set_pocket_archived' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_reserve(%L, 100)', pa), 'pocket_not_found') || ' I4 pocket_reserve' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_withdraw(%L, 100)', pa), 'pocket_not_found') || ' I5 pocket_withdraw' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_transfer(%L,%L,100)', pa, pb), 'pocket_not_found') || ' I6 pocket_transfer' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_transfer(%L,%L,100)', pbx, pa), 'pocket_not_found') || ' I6b transferir do cofrinho B para o da A' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,100,null,null,%L)', pa, 'x', cx), 'pocket_not_found') || ' I7 spend_from_pocket' || E'\n';
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', tx1), 'transaction_not_found') || ' I8 reverse_pocket_use' || E'\n';
  out := out || pg_temp.ex(format('select public.link_goal_pocket(%L,%L)', g1, pa), 'goal_not_found') || ' I9 link_goal_pocket' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_reserve(%L, 1000)', pbx), 'ok') || ' I10 controle positivo: B reserva no proprio cofrinho' || E'\n';
  select count(*) into n0 from public.pocket_movements where household_id = h1 and kind = 'reserve' and movement_date = today and amount_cents = 100;
  out := out || format('%s I11 nenhuma escrita de B apareceu na familia A (%s)', case when n0=0 then 'PASS' else 'FAIL' end, n0) || E'\n';
  reset role;

  out := out || E'\n== anon nao executa nenhuma RPC de negocio ==\n';
  set local role anon;
  foreach f in array fns loop
    out := out || pg_temp.ex(format('select public.%I(%s)', f,
      case f when 'create_pocket' then format('%L,%L,%L', p1, a, 'x')
             when 'update_pocket' then format('%L,%L::jsonb', pa, '{}')
             when 'set_pocket_archived' then format('%L,true', pa)
             when 'pocket_reserve' then format('%L,100', pa)
             when 'pocket_withdraw' then format('%L,100', pa)
             when 'pocket_transfer' then format('%L,%L,100', pa, pb)
             when 'spend_from_pocket' then format('%L,%L,100', pa, 'x')
             when 'reverse_pocket_use' then format('%L', tx1)
             else format('%L,null', g1) end), '42501') || ' anon ' || f || E'\n';
  end loop;
  reset role;

  fails := (length(out) - length(replace(out, 'FAIL', ''))) / 4;
  out := out || E'\n== RESULTADO: ' || fails || E' FAIL ==\n';
  raise exception E'ROLLBACK_PROPOSITAL\n%', out;
end $$;
