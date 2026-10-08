-- Teste de dívidas (sem DELETE direto; exclusão de pagamento de dívida quitada está em debts_delete_test.sql).
-- Reexecutável. Tudo roda num bloco que termina em RAISE EXCEPTION: NADA persiste.

create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok rows='||n;
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,80); end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; p1 uuid; p2 uuid; a1 uuid; a2 uuid; cat uuid; today date; first_due date;
  d_simple uuid; d_loan uuid; d_x uuid; d_cancel uuid; pay uuid; tx uuid; r jsonb;
  out text := ''; v bigint; v2 bigint; v3 bigint; s text; n int; b boolean; bal0 bigint; sm record;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'b@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where kind='individual';
  select id into cat from public.categories where name='Dívidas' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Nubank',1000000) returning id into a1;
  today := private.household_today(h1);
  first_due := (date_trunc('month', today) - interval '4 months' + interval '11 days')::date;

  out := out || E'--- dívida sem parcelas (devo R$ 1.500 a um familiar) ---\n';
  d_simple := public.create_debt('Familiar', 150000, 150000, p1, 'personal', 'Tio', 'sem juros');
  select * into sm from public.v_debt_summary where debt_id = d_simple;
  out := out || format('S1  recem criada: pago=%s restante=%s progresso=%s%% status=%s (0 / 150000 / 0.00 / active)', sm.paid_cents, sm.remaining_cents, sm.progress_percent, sm.derived_status) || E'\n';
  select count(*) into v from public.v_debt_installments where debt_id = d_simple;
  out := out || format('S2  sem cronograma: %s parcelas (0)', v) || E'\n';
  select balance_cents into bal0 from public.v_account_balances where account_id = a1;
  out := out || format('S3  a divida NAO move saldo (nem a criacao): %s (1000000)', bal0) || E'\n';
  perform public.pay_debt(d_simple, a1, 50000, today);
  perform public.pay_debt(d_simple, a1, 30000, today);
  select * into sm from public.v_debt_summary where debt_id = d_simple;
  out := out || format('S4  apos 500 + 300: pago=%s restante=%s status=%s (80000 / 70000 / active)', sm.paid_cents, sm.remaining_cents, sm.derived_status) || E'\n';
  out := out || 'S5  pagar acima do restante: ' || pg_temp.try(format('select public.pay_debt(%L,%L,70001,%L)', d_simple, a1, today)) || ' (ERR P0001 payment_exceeds_remaining)' || E'\n';
  select count(*) into v from public.transactions where debt_id = d_simple;
  out := out || format('S6  a recusa nao deixou pagamento: %s transacoes (2)', v) || E'\n';
  perform public.pay_debt(d_simple, a1, 70000, today);
  select * into sm from public.v_debt_summary where debt_id = d_simple;
  out := out || format('S7  zerou: restante=%s status=%s progresso=%s (0 / paid / 100.00) — "quitada" e DERIVADA', sm.remaining_cents, sm.derived_status, sm.progress_percent) || E'\n';
  out := out || 'S8  pagar quitada: ' || pg_temp.try(format('select public.pay_debt(%L,%L,1,%L)', d_simple, a1, today)) || ' (ERR P0001 debt_already_paid)' || E'\n';
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('S9  saldo caiu so pelos 1.500 pagos: %s (850000)', v) || E'\n';
  select count(*) into v from public.transactions where debt_id = d_simple and kind = 'debt_payment' and status = 'paid' and category_id is null;
  out := out || format('S10 pagamentos sao debt_payment/paid ligados a divida: %s (3)', v) || E'\n';

  out := out || E'\n--- empréstimo parcelado: recebi 8.000, pago 10.300 em 13x ---\n';
  d_loan := public.create_debt('Emprestimo Banco X', 800000, 1030000, p1, 'loan', 'Banco X', null, 13, first_due, a1, cat);
  select sum(amount_cents), count(*) into v, n from public.v_debt_installments where debt_id = d_loan;
  out := out || format('L1  parcelas: %s somando %s (13 / 1030000: sem perder centavos)', n, v) || E'\n';
  select string_agg(amount_cents::text, ',' order by number) into s from public.v_debt_installments where debt_id = d_loan;
  out := out || format('L2  split_cents: %s (10x 79231 e 3x 79230)', s) || E'\n';
  select due_date::text into s from public.v_debt_installments where debt_id = d_loan and number = 1;
  out := out || format('L3  1o vencimento %s (esperado %s)', s, first_due) || E'\n';
  select * into sm from public.v_debt_summary where debt_id = d_loan;
  out := out || format('L4  custo financeiro=%s (230000); total=%s; parcelas=%s; abertas=%s (13)', sm.financial_cost_cents, sm.total_cents, sm.installments_count, sm.installments_open) || E'\n';
  select count(*) into v from public.v_debt_installments where debt_id = d_loan and is_overdue;
  out := out || format('L5  parcelas atrasadas (vencimento ja passou, nada pago): %s (>= 4)', v) || E'\n';

  perform public.pay_debt(d_loan, a1, 79231, today);
  perform public.pay_debt(d_loan, a1, 79231, today);
  select * into sm from public.v_debt_summary where debt_id = d_loan;
  out := out || format('L6  2 parcelas pagas: pagas=%s abertas=%s pago=%s restante=%s (2 / 11 / 158462 / 871538)', sm.installments_paid, sm.installments_open, sm.paid_cents, sm.remaining_cents) || E'\n';
  perform public.pay_debt(d_loan, a1, 50000, today);
  select status into s from public.v_debt_installments where debt_id = d_loan and number = 3;
  select paid_cents, open_cents into v, v2 from public.v_debt_installments where debt_id = d_loan and number = 3;
  out := out || format('L7  pagamento PARCIAL de 500 na parcela 3 (792,31): status=%s pago=%s aberto=%s (partial / 50000 / 29231)', s, v, v2) || E'\n';
  select next_due_date::text, next_open_cents into s, v from public.v_debt_summary where debt_id = d_loan;
  out := out || format('L8  proxima = parcela 3 com o que falta: %s / %s (esperado %s / 29231)', s, v, (first_due + interval '2 months')::date) || E'\n';
  select * into sm from public.v_debt_summary where debt_id = d_loan;
  out := out || format('L9  progresso=%s%% (esperado %s); status=%s (active; ainda ha saldo)', sm.progress_percent, round(208462::numeric*100/1030000, 2), sm.derived_status) || E'\n';
  -- pagamento adiantado cobre as seguintes em ordem
  perform public.pay_debt(d_loan, a1, 200000, today);
  select count(*) into v from public.v_debt_installments where debt_id = d_loan and status = 'paid';
  select open_cents into v2 from public.v_debt_installments where debt_id = d_loan and number = 3;
  out := out || format('L10 pagou 2.000 adiantado: parcelas quitadas=%s (5), parcela 3 aberta=%s (0)', v, v2) || E'\n';
  select sum(paid_cents) + sum(open_cents) into v from public.v_debt_installments where debt_id = d_loan;
  out := out || format('L11 pago-alocado + aberto == total (sem dupla contagem): %s (1030000)', v) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('L12 saldo = 850000 - 408462 pago no emprestimo: %s (441538)', v) || E'\n';

  out := out || E'\n--- quitação antecipada ---\n';
  select remaining_cents into v from public.v_debt_summary where debt_id = d_loan;
  out := out || format('Q1  saldo projetado: %s (621538)', v) || E'\n';
  out := out || 'Q2  quitar pagando MAIS que o projetado: ' || pg_temp.try(format('select public.settle_debt(%L,%L,%s,%L)', d_loan, a1, v + 1, today)) || ' (ERR P0001 payment_exceeds_remaining)' || E'\n';
  r := public.settle_debt(d_loan, a1, 490000, today);
  out := out || format('Q3  quitou por 4.900: %s', r) || E'\n';
  select * into sm from public.v_debt_summary where debt_id = d_loan;
  out := out || format('Q4  restante=%s status=%s desconto=%s progresso=%s (0 / paid / 131538 / 100.00)', sm.remaining_cents, sm.derived_status, sm.settlement_discount_cents, sm.progress_percent) || E'\n';
  select count(*) into v from public.v_debt_installments where debt_id = d_loan and open_cents > 0;
  out := out || format('Q5  nenhuma parcela em aberto: %s (0)', v) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('Q6  saldo caiu pelo VALOR REAL pago (4.900), nao pelo projetado: %s (441538 - 490000 = -48462)', v) || E'\n';
  out := out || 'Q7  pagar dívida quitada: ' || pg_temp.try(format('select public.pay_debt(%L,%L,100,%L)', d_loan, a1, today)) || ' (ERR P0001 debt_settled_locked)' || E'\n';
  out := out || 'Q8  alterar valores de quitada: ' || pg_temp.try(format('select public.update_debt(%L,%L)', d_loan, '{"total_cents":2000000}')) || ' (ERR P0001 debt_settled_locked)' || E'\n';
  out := out || 'Q9  descritivo continua editavel: ' || pg_temp.try(format('select public.update_debt(%L,%L)', d_loan, '{"notes":"quitado"}')) || ' (ok)' || E'\n';
  select id into tx from public.transactions where debt_id = d_loan order by created_at desc limit 1;
  out := out || 'Q10 editar pagamento pelo fluxo generico: ' || pg_temp.try(format('select public.update_transaction(%L,%L)', tx, '{"amount_cents":1}')) || ' (ERR 22023 use_debt_flow)' || E'\n';
  out := out || 'Q11 marcar pagamento como pendente: ' || pg_temp.try(format('select public.update_transaction(%L,%L)', tx, '{"status":"pending"}')) || ' (ERR 22023 use_debt_flow)' || E'\n';
  perform public.reopen_debt(d_loan);
  select remaining_cents, derived_status into v, s from public.v_debt_summary where debt_id = d_loan;
  out := out || format('Q12 reabrir devolve o desconto ao saldo: restante=%s status=%s (131538 / active)', v, s) || E'\n';
  out := out || 'Q13 reabrir uma nao quitada: ' || pg_temp.try(format('select public.reopen_debt(%L)', d_loan)) || ' (ERR P0001 debt_not_settled)' || E'\n';
  r := public.settle_debt(d_loan, a1, 0, today);
  select count(*) into v from public.transactions where debt_id = d_loan and description like 'Quita%';
  out := out || format('Q14 perdao total (valor 0): %s; transacoes de quitacao=%s (1: so a anterior; 0 nova)', r, v) || E'\n';

  out := out || E'\n--- editar / pausar / cancelar ---\n';
  d_x := public.create_debt('Financiamento', 500000, 600000, p1, 'financing', null, null, 6, first_due, a1);
  perform public.pay_debt(d_x, a1, 100000, today);
  out := out || 'E1  total abaixo do ja pago: ' || pg_temp.try(format('select public.update_debt(%L,%L)', d_x, '{"total_cents":99999,"principal_cents":50000}')) || ' (ERR P0001 total_below_paid)' || E'\n';
  perform public.update_debt(d_x, '{"total_cents":720000,"installments_count":12,"principal_cents":600000}');
  select string_agg(amount_cents::text, ',') into s from public.v_debt_installments where debt_id = d_x;
  select sum(amount_cents), count(*) into v, n from public.v_debt_installments where debt_id = d_x;
  out := out || format('E2  recalculou o cronograma: %s parcelas somando %s (12 / 720000); historico de pagamentos intacto', n, v) || E'\n';
  select paid_cents into v from public.v_debt_summary where debt_id = d_x;
  out := out || format('E3  pago continua o das transacoes: %s (100000)', v) || E'\n';
  out := out || 'E4  chave invalida: ' || pg_temp.try(format('select public.update_debt(%L,%L)', d_x, '{"settled_at":"2026-01-01"}')) || ' (ERR 22023 invalid_patch_key)' || E'\n';
  out := out || 'E5  cancelar com pagamentos: ' || pg_temp.try(format('select public.set_debt_status(%L,%L)', d_x, 'canceled')) || ' (ERR P0001 debt_has_payments)' || E'\n';
  perform public.set_debt_status(d_x, 'paused');
  select derived_status into s from public.v_debt_summary where debt_id = d_x;
  select count(*) into v from public.v_debt_installments where debt_id = d_x and is_overdue;
  out := out || format('E6  pausada: status=%s; parcelas atrasadas=%s (paused / 0: pausa nao atrasa)', s, v) || E'\n';
  perform public.set_debt_status(d_x, 'active');
  d_cancel := public.create_debt('Cadastro errado', 100000, 100000, p1);
  perform public.set_debt_status(d_cancel, 'canceled');
  select derived_status, remaining_cents into s, v from public.v_debt_summary where debt_id = d_cancel;
  out := out || format('E7  cancelada sem pagamentos: %s restante=%s (canceled / 0)', s, v) || E'\n';
  out := out || 'E8  pagar cancelada: ' || pg_temp.try(format('select public.pay_debt(%L,%L,100,%L)', d_cancel, a1, today)) || ' (ERR P0001 debt_canceled)' || E'\n';
  out := out || 'E9  parcelas sem 1o vencimento: ' || pg_temp.try(format('select public.create_debt(%L,100,100,%L,%L,null,null,3,null)', 'x', p1, 'loan')) || ' (ERR 22023 invalid_installments)' || E'\n';
  out := out || 'E10 total menor que o original: ' || pg_temp.try(format('select public.create_debt(%L,200,100,%L)', 'x', p1)) || ' (ERR 23514)' || E'\n';

  out := out || E'\n--- invariantes no banco (mesmo sem a RPC) ---\n';
  out := out || 'I1  pagamento de divida pendente: ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,account_id,debt_id) values (%L,%L,%L,%L,100,%L,%L,%L,%L)', h1,'debt_payment','pending','x',today,p1,a1,d_x)) || ' (ERR 23514)' || E'\n';
  out := out || 'I2  debt_id em despesa comum: ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,debt_id,category_id) values (%L,%L,%L,%L,100,%L,%L,%L,%L,%L,%L)', h1,'expense','paid','x',today,today,p1,a1,d_x,cat)) || ' (ERR 23514)' || E'\n';
  set constraints all immediate;
  out := out || 'I3  insert direto que estoura o total: ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,debt_id) values (%L,%L,%L,%L,99999999,%L,%L,%L,%L,%L)', h1,'debt_payment','paid','x',today,today,p1,a1,d_x)) || ' (ERR P0001 debt_overpaid)' || E'\n';
  set constraints all deferred;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  h2 := public.bootstrap_household('Casa B','Bia',false);
  select id into p2 from public.financial_profiles where kind='individual';
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h2,p2,'Conta B',100000) returning id into a2;
  out := out || E'\n--- usuário B tenta atacar o A ---\n';
  select count(*) into v from public.debts;
  select count(*) into v2 from public.v_debt_summary;
  select count(*) into v3 from public.v_debt_installments;
  out := out || format('X1  B enxerga dividas/resumos/parcelas do A: %s / %s / %s (0 / 0 / 0)', v, v2, v3) || E'\n';
  out := out || 'X2  B paga divida do A:     ' || pg_temp.try(format('select public.pay_debt(%L,%L,100,%L)', d_x, a2, today)) || ' (ERR P0002 debt_not_found)' || E'\n';
  out := out || 'X3  B quita divida do A:    ' || pg_temp.try(format('select public.settle_debt(%L,%L,0,%L)', d_x, a2, today)) || ' (ERR P0002)' || E'\n';
  out := out || 'X4  B edita divida do A:    ' || pg_temp.try(format('select public.update_debt(%L,%L)', d_x, '{"name":"HACK"}')) || ' (ERR P0002)' || E'\n';
  out := out || 'X5  B pausa divida do A:    ' || pg_temp.try(format('select public.set_debt_status(%L,%L)', d_x, 'paused')) || ' (ERR P0002)' || E'\n';
  out := out || 'X6  B cria divida com perfil do A: ' || pg_temp.try(format('select public.create_debt(%L,100,100,%L)', 'x', p1)) || ' (ERR P0002 profile_not_found)' || E'\n';
  out := out || 'X7  B cria divida dele com conta do A (FK composta): ' || pg_temp.try(format('select public.create_debt(%L,100,100,%L,%L,null,null,null,null,%L)', 'x', p2, 'other', a1)) || ' (ERR 23503)' || E'\n';
  out := out || 'X8  B insere divida direto no h1: ' || pg_temp.try(format('insert into public.debts (household_id,profile_id,name,principal_cents,total_cents) values (%L,%L,%L,1,1)', h1, p1, 'x')) || ' (ERR 42501)' || E'\n';
  out := out || 'X9  B paga a propria divida com conta do A (FK composta): ' || pg_temp.try(format('select public.pay_debt(public.create_debt(%L,1000,1000,%L),%L,100,%L)', 'Dele', p2, a1, today)) || ' (ERR 23503)' || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v from public.debts where name in ('Dele','HACK');
  out := out || format('X10 A nao ve nada do B e nada foi adulterado: %s (0)', v) || E'\n';
  reset role;

  set local role anon;
  out := out || E'\n--- anon ---\n';
  out := out || 'N1  anon le dividas:   ' || pg_temp.try('select count(*) from public.debts') || ' (ERR 42501)' || E'\n';
  out := out || 'N2  anon le resumo:    ' || pg_temp.try('select count(*) from public.v_debt_summary') || ' (ERR 42501)' || E'\n';
  out := out || 'N3  anon le parcelas:  ' || pg_temp.try('select count(*) from public.v_debt_installments') || ' (ERR 42501)' || E'\n';
  out := out || 'N4  anon pay_debt:     ' || pg_temp.try(format('select public.pay_debt(%L,%L,1,%L)', d_x, a1, today)) || ' (ERR 42501)' || E'\n';
  out := out || 'N5  anon create_debt:  ' || pg_temp.try(format('select public.create_debt(%L,1,1,%L)', 'x', p1)) || ' (ERR 42501)' || E'\n';
  reset role;

  raise exception E'\n==== RELATORIO DIVIDAS (tudo sera revertido) ====\n%', out;
end $$;
