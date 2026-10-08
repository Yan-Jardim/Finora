-- MANUAL (contém DELETE): caminhos de exclusão dos cofrinhos. Roda DEPOIS das migrations 1 e 2 aplicadas.
-- Termina em RAISE EXCEPTION: NADA persiste. Executar no SQL Editor do Supabase.
--
-- Cobre:
--   X1  excluir RECEITA paga que deixaria a reserva sem lastro        -> ERR P0001 reserve_shortfall
--   X2  excluir receita paga em conta SEM reserva (saldo negativo)    -> ok (regra do saldo negativo)
--   X3  excluir despesa paga com reserva (use)                        -> ERR 22023 use_pocket_flow
--   X4  excluir a despesa depois do estorno                           -> continua bloqueada (histórico preservado)
--   X5  excluir a CONTA que tem cofrinho                              -> ERR 23503 (FK NO ACTION)
--   X6  excluir o HOUSEHOLD inteiro (cascata) com cofrinhos, movimentos use/use_reversal e despesas ligadas -> ok, tudo some
--   X7  nenhum resíduo depois da cascata (pockets/pocket_movements/goals/transactions = 0)

create function pg_temp.try(q text) returns text language plpgsql as $f$
begin
  execute q;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  return 'ok';
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,60);
end $f$;

create function pg_temp.mk(p_kind text, p_desc text, p_amount bigint, p_date date, p_profile uuid, p_status text,
                           p_account uuid) returns uuid language plpgsql as $f$
declare v_cat uuid;
begin
  select c.id into v_cat from public.categories c
   where c.household_id = (select fp.household_id from public.financial_profiles fp where fp.id = p_profile)
     and c.kind in (case when p_kind = 'income' then 'income'::public.category_kind else 'expense'::public.category_kind end, 'both')
   limit 1;
  return public.create_transaction(p_kind::public.transaction_kind, p_desc, p_amount, p_date, p_profile,
                                   p_status::public.transaction_status, p_account, null, null, v_cat);
end $f$;

do $$
declare
  u1 uuid := gen_random_uuid();
  h1 uuid; p1 uuid; a uuid; n uuid; pa uuid; pa2 uuid; today date; out text := '';
  inc uuid; incn uuid; e1 uuid; mv uuid; v bigint; v2 bigint; v3 bigint; v4 bigint;
begin
  insert into auth.users (id, email, instance_id, aud, role) values (u1,'c@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa C','Carla',false);
  select id into p1 from public.financial_profiles where household_id = h1 and kind = 'individual';
  today := private.household_today(h1);
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Conta A',0) returning id into a;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Conta Negativa',-50000) returning id into n;
  insert into public.pockets (household_id, profile_id, account_id, name) values (h1,p1,a,'Viagem') returning id into pa;
  insert into public.pockets (household_id, profile_id, account_id, name) values (h1,p1,a,'IPVA') returning id into pa2;

  inc := pg_temp.mk('income','Salario',50000,today,p1,'paid',a);
  perform private.pocket_write(pa, 'reserve', 30000, today);
  perform private.pocket_write(pa2, 'reserve', 10000, today);
  e1 := pg_temp.mk('expense','Mercado',5000,today,p1,'paid',a);
  mv := private.pocket_write(pa2, 'use', 5000, today, null, e1);

  out := out || 'X1  excluir receita paga que deixaria a reserva sem lastro: ' || pg_temp.try(format('delete from public.transactions where id=%L', inc)) || ' (ERR P0001 reserve_shortfall)' || E'\n';
  incn := pg_temp.mk('income','Salario N',20000,today,p1,'paid',n);
  out := out || 'X2  excluir receita paga em conta SEM reserva (saldo negativo): ' || pg_temp.try(format('delete from public.transactions where id=%L', incn)) || ' (ok)' || E'\n';
  out := out || 'X3  excluir despesa paga com reserva: ' || pg_temp.try(format('delete from public.transactions where id=%L', e1)) || ' (ERR 22023 use_pocket_flow)' || E'\n';

  perform private.pocket_write(pa2, 'use_reversal', 5000, today, 'estorno', e1, null, mv);
  update public.transactions set status = 'canceled', paid_at = null where id = e1;
  out := out || 'X4  excluir a despesa DEPOIS do estorno (histórico preservado): ' || pg_temp.try(format('delete from public.transactions where id=%L', e1)) || ' (ERR 22023 use_pocket_flow)' || E'\n';
  out := out || 'X5  excluir a conta que tem cofrinho: ' || pg_temp.try(format('delete from public.accounts where id=%L', a)) || ' (ERR 23503)' || E'\n';

  select count(*) into v from public.pocket_movements;
  out := out || format('    movimentos antes da cascata: %s (4: 2 reserves + use + use_reversal)', v) || E'\n';
  delete from public.households where id = h1;                         -- cascata completa
  set constraints all immediate;                                       -- confere as checagens deferidas sobre a cascata
  set constraints all deferred;
  reset role;
  select count(*) into v  from public.pockets where household_id = h1;
  select count(*) into v2 from public.pocket_movements where household_id = h1;
  select count(*) into v3 from public.goals where household_id = h1;
  select count(*) into v4 from public.transactions where household_id = h1;
  out := out || format('X6/X7 após excluir o household: pockets=%s movimentos=%s goals=%s transactions=%s (0 / 0 / 0 / 0)', v, v2, v3, v4) || E'\n';
  raise exception E'ROLLBACK_PROPOSITAL\n%', out;
end $$;
