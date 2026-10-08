-- Teste dos cofrinhos (migrations 1 e 2): privilégios, imutabilidade, invariantes, estorno, lastro, saldo negativo, RLS.
-- SEM DELETE. Reexecutável. Tudo roda num bloco que termina em RAISE EXCEPTION: NADA persiste (nem DDL, se rodado junto).
-- Os movimentos são escritos pela única porta (private.pocket_write / pocket_transfer_write), como as RPCs da migration 3 farão.
-- Cada linha mostra o resultado e o esperado entre parênteses.

create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin
  execute q; get diagnostics n = row_count;
  execute 'set constraints all immediate';          -- dispara AGORA as checagens deferidas (no app elas rodam no COMMIT)
  execute 'set constraints all deferred';
  return 'ok';
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,60);
end $f$;

-- Cria uma movimentação válida: o banco exige categoria em receita/despesa/compra e proíbe em transferência (transactions_kind_shape).
create function pg_temp.mk(p_kind text, p_desc text, p_amount bigint, p_date date, p_profile uuid, p_status text,
                           p_account uuid, p_to uuid default null, p_card uuid default null) returns uuid language plpgsql as $f$
declare v_cat uuid;
begin
  if p_kind <> 'transfer' then
    select c.id into v_cat from public.categories c
     where c.household_id = (select fp.household_id from public.financial_profiles fp where fp.id = p_profile)
       and c.kind in (case when p_kind = 'income' then 'income'::public.category_kind else 'expense'::public.category_kind end, 'both')
     limit 1;
  end if;
  return public.create_transaction(p_kind::public.transaction_kind, p_desc, p_amount, p_date, p_profile,
                                   p_status::public.transaction_status, p_account, p_to, p_card, v_cat);
end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; p1 uuid; p2 uuid; cat uuid;
  a uuid; b uuid; n uuid; inv uuid; c1 uuid;
  pa uuid; pa2 uuid; pb uuid; pn uuid; pinv uuid;
  today date; out text := ''; v bigint; v2 bigint; s text; r record; g uuid;
  e1 uuid; e2 uuid; e3 uuid; mv uuid; mid uuid; d1 uuid; due date; txcount0 bigint; txcount1 bigint;
  bal0 bigint;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'b@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where household_id = h1 and kind = 'individual';
  today := private.household_today(h1);
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Conta A',100000) returning id into a;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Conta B',50000) returning id into b;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Conta Negativa',-20000) returning id into n;
  insert into public.accounts (household_id, owner_profile_id, name, type, initial_balance_cents) values (h1,p1,'Corretora','investment',900000) returning id into inv;
  insert into public.credit_cards (household_id, owner_profile_id, payment_account_id, name, limit_cents, closing_day, due_day) values (h1,p1,a,'Cartao',500000,28,5) returning id into c1;

  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  h2 := public.bootstrap_household('Casa B','Beto',false);
  select id into p2 from public.financial_profiles where household_id = h2 and kind = 'individual';
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);

  out := out || E'--- cofrinhos: criação e regras de conta ---\n';
  insert into public.pockets (household_id, profile_id, account_id, name) values (h1,p1,a,'Viagem') returning id into pa;
  insert into public.pockets (household_id, profile_id, account_id, name) values (h1,p1,a,'IPVA') returning id into pa2;
  insert into public.pockets (household_id, profile_id, account_id, name) values (h1,p1,b,'Natal') returning id into pb;
  out := out || 'C1  cofrinho em conta de consumo: criado (3 cofrinhos)' || E'\n';
  out := out || 'C2  cofrinho em conta de INVESTIMENTO: ' || pg_temp.try(format('insert into public.pockets (household_id, profile_id, account_id, name) values (%L,%L,%L,%L)', h1,p1,inv,'X')) || ' (ERR P0001 account_not_allowed)' || E'\n';
  out := out || 'C3  trocar a conta do cofrinho:     ' || pg_temp.try(format('update public.pockets set account_id=%L where id=%L', b, pa)) || ' (ERR P0001 pocket_account_immutable)' || E'\n';

  out := out || E'\n--- reservar: é só alocação virtual (não mexe em saldo nem cria despesa) ---\n';
  select count(*) into txcount0 from public.transactions where household_id = h1;
  select balance_cents into bal0 from public.v_account_balances where account_id = a;
  perform private.pocket_write(pa, 'reserve', 30000, today, 'viagem');
  select * into r from public.v_account_reserves where account_id = a;
  out := out || format('R1  reservar 30000: saldo=%s reservado=%s livre=%s (100000 / 30000 / 70000)', r.balance_cents, r.reserved_cents, r.free_cents) || E'\n';
  select count(*) into txcount1 from public.transactions where household_id = h1;
  out := out || format('R2  nenhuma transação criada: %s -> %s (iguais); saldo bancário igual: %s', txcount0, txcount1, (r.balance_cents = bal0)) || E'\n';
  out := out || 'R3  reservar acima do livre (70001): ' || pg_temp.try(format('select private.pocket_write(%L,%L,70001,%L)', pa,'reserve',today)) || ' (ERR P0001 insufficient_free)' || E'\n';
  begin perform private.pocket_write(pa, 'reserve', 70001, today);
  exception when others then get stacked diagnostics s = pg_exception_detail; out := out || 'R3b detalhe do erro: ' || s || E' (free_cents=70000;…;shortfall_cents=1)\n'; end;
  out := out || 'R4  valor zero / negativo:          ' || pg_temp.try(format('select private.pocket_write(%L,%L,0,%L)', pa,'reserve',today)) || ' (ERR 22023)' || E'\n';
  out := out || 'R5  data futura:                    ' || pg_temp.try(format('select private.pocket_write(%L,%L,100,%L)', pa,'reserve',today+1)) || ' (ERR 22023 future_date)' || E'\n';
  select created_by, created_at into r from public.pocket_movements limit 1;
  out := out || format('R6  autor carimbado pelo banco: %s (true)', r.created_by = u1) || E'\n';

  out := out || E'\n--- retirar ---\n';
  perform private.pocket_write(pa, 'withdraw', 5000, today);
  select * into r from public.v_account_reserves where account_id = a;
  out := out || format('W1  retirar 5000: saldo=%s reservado=%s livre=%s (100000 / 25000 / 75000) — o livre AUMENTA, o saldo bancário não muda', r.balance_cents, r.reserved_cents, r.free_cents) || E'\n';
  out := out || 'W2  retirar acima do reservado (25001): ' || pg_temp.try(format('select private.pocket_write(%L,%L,25001,%L)', pa,'withdraw',today)) || ' (ERR P0001 insufficient_pocket)' || E'\n';
  select balance_cents into v from public.v_pocket_balances where pocket_id = pa;
  out := out || format('W3  saldo do cofrinho derivado: %s (25000)', v) || E'\n';

  out := out || E'\n--- transferir reserva ---\n';
  perform private.pocket_write(pb, 'reserve', 20000, today);
  g := private.pocket_transfer_write(pa, pa2, 10000, today, 'ajuste');
  select balance_cents into v from public.v_pocket_balances where pocket_id = pa;
  select balance_cents into v2 from public.v_pocket_balances where pocket_id = pa2;
  out := out || format('T1  transferir 10000 (mesma conta): origem=%s destino=%s (15000 / 10000)', v, v2) || E'\n';
  select reserved_cents into v from public.v_account_reserves where account_id = a;
  out := out || format('T2  reservado da conta não muda: %s (25000)', v) || E'\n';
  select count(*) into v from public.pocket_movements where transfer_group_id = g;
  out := out || format('T3  duas linhas ligadas pelo mesmo grupo: %s (2)', v) || E'\n';
  out := out || 'T4  entre contas diferentes:       ' || pg_temp.try(format('select private.pocket_transfer_write(%L,%L,100,%L)', pa, pb, today)) || ' (ERR P0001 different_accounts)' || E'\n';
  out := out || 'T5  para o mesmo cofrinho:         ' || pg_temp.try(format('select private.pocket_transfer_write(%L,%L,100,%L)', pa, pa, today)) || ' (ERR 22023 same_pocket)' || E'\n';
  out := out || 'T6  acima do saldo do cofrinho:    ' || pg_temp.try(format('select private.pocket_transfer_write(%L,%L,15001,%L)', pa, pa2, today)) || ' (ERR P0001 insufficient_pocket)' || E'\n';

  out := out || E'\n--- usar reserva em despesa (total e parcial) ---\n';
  e1 := pg_temp.mk('expense','Mercado',8000,today,p1,'paid',a);
  select * into r from public.v_account_reserves where account_id = a;
  out := out || format('U0  despesa paga 8000 (sem usar reserva): saldo=%s reservado=%s livre=%s (92000 / 25000 / 67000)', r.balance_cents, r.reserved_cents, r.free_cents) || E'\n';
  mv := private.pocket_write(pa2, 'use', 8000, today, null, e1);
  select * into r from public.v_account_reserves where account_id = a;
  out := out || format('U1  usar 8000 do cofrinho nessa despesa: saldo=%s reservado=%s livre=%s (92000 / 17000 / 75000) — livre NÃO muda: sem dupla contagem', r.balance_cents, r.reserved_cents, r.free_cents) || E'\n';
  e2 := pg_temp.mk('expense','Padaria',5000,today,p1,'paid',a);
  perform private.pocket_write(pa, 'use', 3000, today, null, e2);
  select * into r from public.v_account_reserves where account_id = a;
  out := out || format('U2  uso PARCIAL (3000 de 5000): saldo=%s reservado=%s livre=%s (87000 / 14000 / 73000)', r.balance_cents, r.reserved_cents, r.free_cents) || E'\n';
  out := out || 'U3  mesma despesa usada duas vezes:   ' || pg_temp.try(format('select private.pocket_write(%L,%L,1000,%L,null,%L)', pa,'use',today,e2)) || ' (ERR 23505 índice único)' || E'\n';
  e3 := pg_temp.mk('expense','Pendente',1000,today,p1,'pending',a);
  out := out || 'U4  despesa NÃO paga:                ' || pg_temp.try(format('select private.pocket_write(%L,%L,1000,%L,null,%L)', pa,'use',today,e3)) || ' (ERR 22023 use_invalid_expense)' || E'\n';
  out := out || 'U5  valor maior que a despesa:       ' || pg_temp.try(format('select private.pocket_write(%L,%L,5001,%L,null,%L)', pa,'use',today,pg_temp.mk('expense','Gasto',5000,today,p1,'paid',a))) || ' (ERR 22023 use_invalid_expense)' || E'\n';
  out := out || 'U6  despesa de OUTRA conta:          ' || pg_temp.try(format('select private.pocket_write(%L,%L,100,%L,null,%L)', pa,'use',today,pg_temp.mk('expense','Na B',1000,today,p1,'paid',b))) || ' (ERR 22023 use_invalid_expense)' || E'\n';
  out := out || 'U7  despesa que não é do cofrinho (receita): ' || pg_temp.try(format('select private.pocket_write(%L,%L,100,%L,null,%L)', pa,'use',today,pg_temp.mk('income','Receita',1000,today,p1,'paid',a))) || ' (ERR 22023 use_invalid_expense)' || E'\n';
  out := out || 'U8  uso acima do saldo do cofrinho:  ' || pg_temp.try(format('select private.pocket_write(%L,%L,12001,%L,null,%L)', pa,'use',today,pg_temp.mk('expense','Grande',20000,today,p1,'paid',a))) || ' (ERR P0001 insufficient_pocket)' || E'\n';

  out := out || E'\n--- despesa ligada à reserva: não se altera nem se exclui ---\n';
  out := out || 'F1  alterar valor:      ' || pg_temp.try(format('update public.transactions set amount_cents=9000 where id=%L', e1)) || ' (ERR 22023 use_pocket_flow)' || E'\n';
  out := out || 'F2  alterar status:     ' || pg_temp.try(format('update public.transactions set status=%L, paid_at=null where id=%L','pending', e1)) || ' (ERR 22023 use_pocket_flow)' || E'\n';
  out := out || 'F3  alterar conta:      ' || pg_temp.try(format('update public.transactions set account_id=%L where id=%L', b, e1)) || ' (ERR 22023 use_pocket_flow)' || E'\n';
  out := out || 'F4  cancelar SEM estorno: ' || pg_temp.try(format('update public.transactions set status=%L, paid_at=null where id=%L','canceled', e1)) || ' (ERR 22023 use_pocket_flow)' || E'\n';
  out := out || 'F5  editar descrição/notas: ' || pg_temp.try(format('update public.transactions set description=%L, notes=%L where id=%L','Mercado do mês','ok', e1)) || ' (ok)' || E'\n';

  out := out || E'\n--- estorno auditável (use_reversal + cancelamento) ---\n';
  select * into r from public.v_account_reserves where account_id = a;
  v := r.free_cents; bal0 := r.balance_cents;
  out := out || 'E1  estorno com valor diferente:  ' || pg_temp.try(format('select private.pocket_write(%L,%L,7999,%L,null,%L,null,%L)', pa2,'use_reversal',today,e1,mv)) || ' (ERR 22023 reversal_invalid)' || E'\n';
  out := out || 'E2  estorno em outro cofrinho:    ' || pg_temp.try(format('select private.pocket_write(%L,%L,8000,%L,null,%L,null,%L)', pa,'use_reversal',today,e1,mv)) || ' (ERR 22023 reversal_invalid)' || E'\n';
  out := out || 'E3  estorno SEM cancelar a despesa: ' || pg_temp.try(format('select private.pocket_write(%L,%L,8000,%L,null,%L,null,%L)', pa2,'use_reversal',today,e1,mv)) || ' (ERR P0001 use_inconsistent — a transação desfaz)' || E'\n';
  mid := private.pocket_write(pa2, 'use_reversal', 8000, today, 'estorno', e1, null, mv);
  update public.transactions set status = 'canceled', paid_at = null where id = e1;   -- permitido porque o estorno existe
  out := out || 'flush apos estorno+cancelamento: ' || pg_temp.try('select 1') || E' (ok)
';
  select * into r from public.v_account_reserves where account_id = a;
  out := out || format('E4  estorno + cancelamento: saldo=%s (+8000 -> %s), livre=%s (igual a antes: %s)', r.balance_cents, bal0 + 8000, r.free_cents, v) || E'\n';
  select balance_cents into v2 from public.v_pocket_balances where pocket_id = pa2;
  out := out || format('E5  cofrinho voltou a ter: %s (10000)', v2) || E'\n';
  select count(*) into v2 from public.pocket_movements where transaction_id = e1;
  out := out || format('E6  histórico preservado (use + use_reversal): %s linhas (2)', v2) || E'\n';
  out := out || 'E7  segundo estorno do mesmo uso: ' || pg_temp.try(format('select private.pocket_write(%L,%L,8000,%L,null,%L,null,%L)', pa2,'use_reversal',today,e1,mv)) || ' (ERR 23505 índice único)' || E'\n';
  out := out || 'E8  reativar a despesa estornada: ' || pg_temp.try(format('update public.transactions set status=%L, paid_at=%L where id=%L','paid', today, e1)) || ' (ERR 22023 use_pocket_flow)' || E'\n';
  select status::text into s from public.transactions where id = e1;
  out := out || format('E9  a despesa continua visível, cancelada: %s (canceled)', s) || E'\n';

  out := out || E'\n--- lastro: operações que deixariam reserva sem cobertura ---\n';
  select * into r from public.v_account_reserves where account_id = a;
  out := out || format('L0  estado: saldo=%s reservado=%s livre=%s', r.balance_cents, r.reserved_cents, r.free_cents) || E'\n';
  v := r.free_cents;
  out := out || 'L1  despesa paga que passa do livre: ' || pg_temp.try(format('select pg_temp.mk(%L,%L,%s,%L,%L,%L,%L)','expense','Estoura',v+1,today,p1,'paid',a)) || ' (ERR P0001 reserve_shortfall)' || E'\n';
  begin perform pg_temp.mk('expense','Estoura',v+1,today,p1,'paid',a); set constraints all immediate;
  exception when others then get stacked diagnostics s = pg_exception_detail; out := out || 'L1b detalhe: ' || s || E' (shortfall_cents=1)\n'; end;
  set constraints all deferred;
  out := out || 'L2  despesa até o limite do livre:  ' || pg_temp.try(format('select pg_temp.mk(%L,%L,%s,%L,%L,%L,%L)','expense','No limite',v,today,p1,'paid',a)) || ' (ok — livre fica 0)' || E'\n';
  select free_cents into v2 from public.v_account_reserves where account_id = a;
  out := out || format('L2b livre agora: %s (0)', v2) || E'\n';
  out := out || 'L3  qualquer nova despesa paga:     ' || pg_temp.try(format('select pg_temp.mk(%L,%L,1,%L,%L,%L,%L)','expense','Mais um',today,p1,'paid',a)) || ' (ERR P0001 reserve_shortfall)' || E'\n';
  out := out || 'L4  transferência de saída (A->B): ' || pg_temp.try(format('select pg_temp.mk(%L,%L,1,%L,%L,%L,%L,%L)','transfer','Sai',today,p1,'paid',a,b)) || ' (ERR P0001 reserve_shortfall)' || E'\n';
  out := out || 'L5  receita nova paga (melhora):   ' || pg_temp.try(format('select pg_temp.mk(%L,%L,5000,%L,%L,%L,%L)','income','Entrou',today,p1,'paid',a)) || ' (ok)' || E'\n';
  e3 := pg_temp.mk('income','Receita grande',20000,today,p1,'paid',a);
  select free_cents into v from public.v_account_reserves where account_id = a;
  perform pg_temp.mk('expense','Esgota a folga',v,today,p1,'paid',a);        -- folga volta a 0
  out := out || 'flush das checagens deferidas: ' || pg_temp.try('select 1') || E' (ok)
';
  out := out || 'L6  reduzir o valor da receita paga: ' || pg_temp.try(format('update public.transactions set amount_cents=1 where id=%L', e3)) || ' (ERR P0001 reserve_shortfall — a folga cairia abaixo do reservado)' || E'\n';
  out := out || 'L7  receita paga -> pendente:       ' || pg_temp.try(format('update public.transactions set status=%L, paid_at=null where id=%L','pending', e3)) || ' (ERR P0001 reserve_shortfall)' || E'\n';
  out := out || 'L8  saldo inicial menor:            ' || pg_temp.try(format('update public.accounts set initial_balance_cents=initial_balance_cents-30000 where id=%L', a)) || ' (ERR P0001 reserve_shortfall)' || E'\n';
  out := out || 'L9  saldo inicial maior (melhora):  ' || pg_temp.try(format('update public.accounts set initial_balance_cents=initial_balance_cents+1000 where id=%L', a)) || ' (ok)' || E'\n';
  out := out || 'L10 desativar conta com reserva:    ' || pg_temp.try(format('update public.accounts set is_active=false where id=%L', a)) || ' (ERR P0001 account_has_reserve)' || E'\n';
  out := out || 'L11 conta com reserva vira investimento: ' || pg_temp.try(format('update public.accounts set type=%L where id=%L','investment', a)) || ' (ERR P0001 account_has_reserve)' || E'\n';
  -- fatura e dívida
  perform pg_temp.mk('credit_card_purchase','Compra cartao',20000,today,p1,null,null,null,c1);
  select due_month into due from public.card_invoices where card_id = c1 limit 1;
  out := out || 'L12 pagar fatura que passa do livre: ' || pg_temp.try(format('select public.pay_invoice(%L,%L,%L,20000,%L)', c1, due, a, today)) || ' (ERR P0001 reserve_shortfall)' || E'\n';
  d1 := public.create_debt('Emprestimo', 50000, 50000, p1, 'loan', null, null, null, null, a);
  out := out || 'L13 pagar dívida que passa do livre:  ' || pg_temp.try(format('select public.pay_debt(%L,%L,40000,%L)', d1, a, today)) || ' (ERR P0001 reserve_shortfall)' || E'\n';
  -- libera o necessário e repete (o app NÃO libera sozinho)
  perform private.pocket_write(pa2, 'withdraw', 10000, today, 'liberar para pagar fatura');
  perform private.pocket_write(pa, 'withdraw', 9000, today, 'liberar para pagar fatura');
  out := out || 'L14 depois de liberar a reserva, a MESMA fatura passa: ' || pg_temp.try(format('select public.pay_invoice(%L,%L,%L,20000,%L)', c1, due, a, today)) || ' (ok)' || E'\n';
  select * into r from public.v_account_reserves where account_id = a;
  out := out || format('L15 invariante saldo >= reservado: %s (true) [saldo=%s reservado=%s]', r.balance_cents >= r.reserved_cents, r.balance_cents, r.reserved_cents) || E'\n';

  out := out || E'\n--- saldo NEGATIVO sem reservas continua funcionando como antes dos cofrinhos ---\n';
  select balance_cents into v from public.v_account_balances where account_id = n;
  out := out || format('N0  conta negativa: saldo=%s (-20000), sem cofrinhos', v) || E'\n';
  out := out || 'N1  despesa paga:            ' || pg_temp.try(format('select pg_temp.mk(%L,%L,10000,%L,%L,%L,%L)','expense','No vermelho',today,p1,'paid',n)) || ' (ok)' || E'\n';
  out := out || 'N2  transferência de saída:   ' || pg_temp.try(format('select pg_temp.mk(%L,%L,5000,%L,%L,%L,%L,%L)','transfer','Sai',today,p1,'paid',n,b)) || ' (ok)' || E'\n';
  out := out || 'N3  saldo inicial mais negativo: ' || pg_temp.try(format('update public.accounts set initial_balance_cents=initial_balance_cents-50000 where id=%L', n)) || ' (ok)' || E'\n';
  e3 := pg_temp.mk('income','Salario N',1000,today,p1,'paid',n);
  out := out || 'N4  reduzir receita paga:     ' || pg_temp.try(format('update public.transactions set amount_cents=1 where id=%L', e3)) || ' (ok)' || E'\n';
  perform pg_temp.mk('credit_card_purchase','Compra N',3000,today,p1,null,null,null,c1);
  out := out || 'N5  pagar fatura com a conta negativa: ' || pg_temp.try(format('select public.pay_invoice(%L,%L,%L,1000,%L)', c1, due, n, today)) || ' (ok ou ERR P0001 payment_exceeds_open — nunca reserve_shortfall)' || E'\n';
  d1 := public.create_debt('Divida N', 10000, 10000, p1, 'other', null, null, null, null, n);
  out := out || 'N6  pagar dívida com a conta negativa:  ' || pg_temp.try(format('select public.pay_debt(%L,%L,4000,%L)', d1, n, today)) || ' (ok)' || E'\n';
  out := out || 'N7  arquivar a conta negativa sem reserva: ' || pg_temp.try(format('update public.accounts set is_active=false where id=%L', n)) || ' (ok)' || E'\n';
  update public.accounts set is_active = true where id = n;
  select * into r from public.v_account_reserves where account_id = n;
  out := out || format('N8  v_account_reserves da conta negativa: saldo=%s reservado=%s livre=%s (livre = saldo, reservado 0)', r.balance_cents, r.reserved_cents, r.free_cents) || E'\n';
  insert into public.pockets (household_id, profile_id, account_id, name) values (h1,p1,n,'Na negativa') returning id into pn;
  out := out || 'N9  reservar numa conta de saldo negativo: ' || pg_temp.try(format('select private.pocket_write(%L,%L,1,%L)', pn,'reserve',today)) || ' (ERR P0001 insufficient_free — livre negativo)' || E'\n';
  out := out || 'N10 operações na conta negativa não são afetadas pela reserva da conta A: ' || pg_temp.try(format('select pg_temp.mk(%L,%L,1000,%L,%L,%L,%L)','expense','Outra',today,p1,'paid',n)) || ' (ok)' || E'\n';

  out := out || E'\n--- arquivar cofrinho ---\n';
  out := out || 'A1  arquivar com saldo:       ' || pg_temp.try(format('update public.pockets set status=%L where id=%L','archived', pa)) || ' (ERR P0001 pocket_has_balance)' || E'\n';
  select balance_cents into v from public.v_pocket_balances where pocket_id = pb;
  perform private.pocket_write(pb, 'withdraw', v, today);
  out := out || 'A2  arquivar zerado:          ' || pg_temp.try(format('update public.pockets set status=%L where id=%L','archived', pb)) || ' (ok)' || E'\n';
  out := out || 'A3  reservar em arquivado:    ' || pg_temp.try(format('select private.pocket_write(%L,%L,100,%L)', pb,'reserve',today)) || ' (ERR P0001 pocket_archived)' || E'\n';
  out := out || 'A4  reativar:                 ' || pg_temp.try(format('update public.pockets set status=%L where id=%L','active', pb)) || ' (ok)' || E'\n';

  out := out || E'\n--- objetivos ---\n';
  out := out || 'G1  objetivo vinculado ao cofrinho: ' || pg_temp.try(format('insert into public.goals (household_id, profile_id, name, target_cents, pocket_id) values (%L,%L,%L,100000,%L)', h1,p1,'Meta',pa)) || ' (ok)' || E'\n';
  out := out || 'G2  vincular COM valor manual:     ' || pg_temp.try(format('insert into public.goals (household_id, profile_id, name, target_cents, pocket_id, manual_amount_cents) values (%L,%L,%L,100000,%L,5)', h1,p1,'Meta2',pa2)) || ' (ERR 23514)' || E'\n';
  out := out || 'G3  2o objetivo no mesmo cofrinho:  ' || pg_temp.try(format('insert into public.goals (household_id, profile_id, name, target_cents, pocket_id) values (%L,%L,%L,100000,%L)', h1,p1,'Meta3',pa)) || ' (ERR 23505)' || E'\n';
  out := out || 'G4  objetivo manual (sem cofrinho):  ' || pg_temp.try(format('insert into public.goals (household_id, profile_id, name, target_cents, manual_amount_cents) values (%L,%L,%L,100000,25000)', h1,p1,'Manual')) || ' (ok)' || E'\n';

  out := out || E'\n--- escrita direta e histórico imutável ---\n';
  out := out || 'D1  INSERT direto (authenticated): ' || pg_temp.try(format('insert into public.pocket_movements (household_id,pocket_id,kind,amount_cents,movement_date) values (%L,%L,%L,1,%L)', h1,pa,'reserve',today)) || ' (ERR 42501)' || E'\n';
  out := out || 'D2  UPDATE direto (authenticated): ' || pg_temp.try('update public.pocket_movements set amount_cents = 1') || ' (ERR 42501)' || E'\n';
  out := out || 'D3  DELETE direto (authenticated): ' || pg_temp.try('delete from public.pocket_movements') || ' (ERR 42501)' || E'\n';
  out := out || 'D4  TRUNCATE (authenticated):      ' || pg_temp.try('truncate public.pocket_movements') || ' (ERR 42501)' || E'\n';
  out := out || 'D5  lock_accounts por authenticated: ' || pg_temp.try(format('select private.lock_accounts(array[%L]::uuid[])', a)) || ' (ERR 42501)' || E'\n';
  out := out || 'D6  DELETE em pockets:              ' || pg_temp.try('delete from public.pockets') || ' (ERR 42501)' || E'\n';
  reset role;
  out := out || 'D7  UPDATE com papel privilegiado:  ' || pg_temp.try('update public.pocket_movements set amount_cents = 1') || ' (ERR P0001 pocket_history_immutable)' || E'\n';
  out := out || 'D8  DELETE com papel privilegiado:  ' || pg_temp.try('delete from public.pocket_movements') || ' (ERR P0001 pocket_history_immutable)' || E'\n';
  out := out || 'D9  TRUNCATE com papel privilegiado:' || pg_temp.try('truncate public.pocket_movements') || ' (ERR P0001 pocket_history_immutable)' || E'\n';
  out := out || 'D10 transfer_in sozinho:            ' || pg_temp.try(format('insert into public.pocket_movements (household_id,pocket_id,kind,amount_cents,movement_date,transfer_group_id) values (%L,%L,%L,100,%L,gen_random_uuid())', h1,pb,'transfer_in',today)) || ' (ERR P0001 transfer_unbalanced)' || E'\n';
  g := gen_random_uuid();
  out := out || 'D11 dois transfer_out no grupo:     ' || pg_temp.try(format('insert into public.pocket_movements (household_id,pocket_id,kind,amount_cents,movement_date,transfer_group_id) values (%L,%L,%L,100,%L,%L),(%L,%L,%L,100,%L,%L)', h1,pa,'transfer_out',today,g, h1,pa2,'transfer_out',today,g)) || ' (ERR 23505 índice único)' || E'\n';
  out := out || 'D12 use sem transação (CHECK):      ' || pg_temp.try(format('insert into public.pocket_movements (household_id,pocket_id,kind,amount_cents,movement_date) values (%L,%L,%L,100,%L)', h1,pa,'use',today)) || ' (ERR 22023 use_invalid_expense — o CHECK 23514 também a barraria)' || E'\n';
  out := out || 'D13 cofrinho de outro household:    ' || pg_temp.try(format('insert into public.pocket_movements (household_id,pocket_id,kind,amount_cents,movement_date) values (%L,%L,%L,100,%L)', h2,pa,'reserve',today)) || ' (ERR P0002 pocket_not_found — a FK composta 23503 também a barraria)' || E'\n';
  out := out || 'D14 transação de outro household no use: ' || pg_temp.try(format('insert into public.pocket_movements (household_id,pocket_id,kind,amount_cents,movement_date,transaction_id) values (%L,%L,%L,100,%L,%L)', h1,pa,'use',today, e1)) || ' (ERR 22023 — e1 é cancelada; use_invalid_expense)' || E'\n';
  out := out || 'D15 retirada acima do saldo, escrita privilegiada: ' || pg_temp.try(format('insert into public.pocket_movements (household_id,pocket_id,kind,amount_cents,movement_date) values (%L,%L,%L,99999999,%L)', h1,pa,'withdraw',today)) || ' (ERR P0001 insufficient_pocket)' || E'\n';
  select count(*) into v from public.pocket_movements;
  out := out || format('D16 histórico intacto após tudo isso: %s linhas (>0, sem remoções)', v) || E'\n';

  out := out || E'\n--- privilégios das funções e search_path ---\n';
  for r in select p.proname, p.prosecdef, p.proconfig::text cfg,
                  has_function_privilege('anon', p.oid, 'execute') anon_x,
                  has_function_privilege('authenticated', p.oid, 'execute') auth_x,
                  coalesce((select bool_or(a.grantee = 0) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), false) public_x
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'private' and p.proname in ('pocket_write','pocket_transfer_write','lock_accounts','lock_pockets','lock_reserve_accounts','assert_account_backed','validate_pocket_movement','pocket_history_immutable','guard_pocket_use','pocket_balance','account_reserved') order by 1 loop
    out := out || format('X   %-26s definer=%s search_path=%s anon=%s authenticated=%s public=%s', r.proname, r.prosecdef, coalesce(r.cfg,'-'), r.anon_x, r.auth_x, r.public_x) || E'\n';
  end loop;
  out := out || E'    esperado: pocket_write/pocket_transfer_write -> definer, search_path="", anon=false, authenticated=true, public=false; lock_* e guardas -> authenticated=false, public=false; pocket_balance/account_reserved -> INVOKER, authenticated=true\n';

  out := out || E'\n--- RLS e isolamento entre households ---\n';
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v from public.pockets;
  select count(*) into v2 from public.pocket_movements;
  out := out || format('I1  outro usuário enxerga: %s cofrinhos, %s movimentos (0 / 0)', v, v2) || E'\n';
  select count(*) into v from public.v_pocket_balances;
  select count(*) into v2 from public.v_account_reserves;
  out := out || format('I2  views derivadas: %s / %s (0 / 0)', v, v2) || E'\n';
  select count(*) into v from public.goals;
  out := out || format('I3  objetivos visíveis: %s (0)', v) || E'\n';
  out := out || 'I4  gravar movimento no cofrinho alheio: ' || pg_temp.try(format('select private.pocket_write(%L,%L,100,%L)', pa,'reserve',today)) || ' (ERR P0002 pocket_not_found — mesmo erro de "não existe")' || E'\n';
  out := out || 'I5  criar cofrinho no household alheio: ' || pg_temp.try(format('insert into public.pockets (household_id, profile_id, account_id, name) values (%L,%L,%L,%L)', h1,p1,a,'Invasor')) || ' (ERR 42501 RLS)' || E'\n';
  out := out || 'I6  criar objetivo no household alheio: ' || pg_temp.try(format('insert into public.goals (household_id, profile_id, name, target_cents) values (%L,%L,%L,1000)', h1,p1,'Invasor')) || ' (ERR 42501 RLS)' || E'\n';
  out := out || 'I7  transferir cofrinhos alheios:        ' || pg_temp.try(format('select private.pocket_transfer_write(%L,%L,100,%L)', pa, pa2, today)) || ' (ERR P0002 pocket_not_found)' || E'\n';
  select private.pocket_balance(pa) into v;
  out := out || format('I8  pocket_balance do cofrinho alheio (RLS no INVOKER): %s (0)', v) || E'\n';
  reset role;
  set local role anon;
  out := out || 'I9  anon lê cofrinhos:        ' || pg_temp.try('select count(*) from public.pockets') || ' (ERR 42501)' || E'\n';
  out := out || 'I10 anon executa pocket_write: ' || pg_temp.try(format('select private.pocket_write(%L,%L,1,current_date)', pa,'reserve')) || ' (ERR 42501)' || E'\n';
  reset role;

  raise exception E'ROLLBACK_PROPOSITAL\n%', out;
end $$;
