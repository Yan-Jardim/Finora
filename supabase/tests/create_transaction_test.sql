-- Teste de create_transaction (e rollback de create_installment_purchase). Reexecutável; nada persiste.
-- O "rollback proposital no meio da operação" instala (dentro do bloco revertido) um trigger que FALHA ao ligar a
-- tag: assim a movimentação e as tags NOVAS já foram inseridas quando o erro acontece.

create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok rows='||n;
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,70); end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; p1 uuid; p2 uuid; a1 uuid; a2 uuid; ba uuid; c1 uuid; bc uuid; cat_exp uuid; cat_inc uuid; bcat uuid;
  tx uuid; inv uuid; today date; out text := ''; v bigint; v2 bigint; s text; b boolean; n1 bigint; n2 bigint; n3 bigint;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'b@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where kind='individual';
  select id into cat_exp from public.categories where name='Mercado' and parent_id is null;
  select id into cat_inc from public.categories where name='Salário' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Nubank',100000) returning id into a1;
  insert into public.accounts (household_id, owner_profile_id, name) values (h1,p1,'Mercado Pago') returning id into a2;
  insert into public.credit_cards (household_id, owner_profile_id, name, limit_cents, closing_day, due_day) values (h1,p1,'Cartao A',500000,28,5) returning id into c1;
  today := private.household_today(h1);

  out := out || E'--- sem tags ---\n';
  tx := public.create_transaction('income', 'Salario', 500000, today, p1, 'paid', a1, null, null, cat_inc);
  select count(*) into v from public.tags; select count(*) into v2 from public.transaction_tags;
  out := out || format('T1  receita paga sem tags: tags=%s (0) ligacoes=%s (0)', v, v2) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('T2  receita paga aumenta o saldo: %s (600000)', v) || E'\n';
  select paid_at::text into s from public.transactions where id = tx;
  out := out || format('T3  paid_at padrao = data da movimentacao: %s (%s)', s, today) || E'\n';
  tx := public.create_transaction('expense', 'Luz', 20000, today, p1, 'pending', a1, null, null, cat_exp, today + 10);
  select (status = 'pending' and paid_at is null and due_date = today + 10) into b from public.transactions where id = tx;
  out := out || format('T4  despesa pendente com vencimento, sem paid_at: %s (true)', b) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('T5  despesa pendente nao mexe no saldo: %s (600000)', v) || E'\n';

  out := out || E'\n--- com tags ---\n';
  tx := public.create_transaction('expense', 'Mercado', 15000, today, p1, 'paid', a1, null, null, cat_exp, null, null, '  compras do mes ', array['#Londres','Casa nova','londres','', '#']);
  select count(*) into v from public.tags; select count(*) into v2 from public.transaction_tags where transaction_id = tx;
  out := out || format('T6  tags novas criadas e ligadas (normalizadas, sem duplicadas): %s tags / %s ligacoes (2 / 2)', v, v2) || E'\n';
  select string_agg(g.name, ',' order by g.name) into s from public.transaction_tags tt join public.tags g on g.id = tt.tag_id where tt.transaction_id = tx;
  out := out || format('T7  nomes: %s (Casa nova,Londres)', s) || E'\n';
  select notes into s from public.transactions where id = tx;
  out := out || format('T8  observacao normalizada: [%s] (compras do mes)', s) || E'\n';
  tx := public.create_transaction('expense', 'Outra', 1000, today, p1, 'paid', a1, null, null, cat_exp, null, null, null, array['LONDRES','Viagem']);
  select count(*) into v from public.tags;
  out := out || format('T9  tag existente e reutilizada (ignora caixa), so "Viagem" e nova: %s tags (3)', v) || E'\n';
  tx := public.create_transaction('expense', 'Muitas', 1000, today, p1, 'paid', a1, null, null, cat_exp, null, null, null,
          array['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11','t12']);
  select count(*) into v from public.transaction_tags where transaction_id = tx;
  out := out || format('T10 maximo de 10 tags por movimentacao: %s (10)', v) || E'\n';

  out := out || E'\n--- tipos e regras ---\n';
  tx := public.create_transaction('transfer', 'Reserva', 100000, today, p1, 'paid', a1, a2);
  select balance_cents into v from public.v_account_balances where account_id = a1;
  select balance_cents into v2 from public.v_account_balances where account_id = a2;
  out := out || format('T11 transferencia: origem %s (483000 = 600000-15000-1000-1000-100000) destino %s (100000)', v, v2) || E'\n';
  tx := public.create_transaction('credit_card_purchase', 'Jantar', 50000, today - 1, p1, null, null, null, c1, cat_exp, null, null, null, array['Casal']);
  select (t.status = 'pending' and t.account_id is null and i.due_month = (select due_month from public.invoice_cycle(28,5,t.date))) into b
    from public.transactions t join public.card_invoices i on i.id = t.invoice_id where t.id = tx;
  out := out || format('T12 compra no cartao: status derivado (pending), sem conta, fatura decidida pelo banco: %s (true)', b) || E'\n';
  select used_cents into v from public.v_card_usage where card_id = c1;
  out := out || format('T13 consome limite: %s (50000)', v) || E'\n';
  tx := public.create_transaction('credit_card_purchase', 'Futura', 20000, today + 40, p1, null, null, null, c1, cat_exp);
  select status::text into s from public.transactions where id = tx;
  out := out || format('T14 compra com data futura -> status: %s (planned)', s) || E'\n';
  out := out || 'T15 compra no cartao paga:        ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,null,null,%L,%L)', 'credit_card_purchase','x',today,p1,'paid',c1,cat_exp)) || ' (ERR 23514)' || E'\n';
  out := out || 'T16 card_payment:                 ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,%L)', 'card_payment','x',today,p1,'paid',a1,c1)) || ' (ERR 22023 use_pay_invoice)' || E'\n';
  out := out || 'T17 sem status (despesa):         ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,null,%L,null,null,%L)', 'expense','x',today,p1,a1,cat_exp)) || ' (ERR 22023 status_required)' || E'\n';
  out := out || 'T18 paid_at sem status paid:      ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,null,%L,null,%L)', 'expense','x',today,p1,'pending',a1,cat_exp,today)) || ' (ERR 22023)' || E'\n';
  out := out || 'T19 transferencia mesma conta:    ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,%L)', 'transfer','x',today,p1,'paid',a1,a1)) || ' (ERR 23514)' || E'\n';
  out := out || 'T20 despesa sem conta:            ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,null,null,null,%L)', 'expense','x',today,p1,'paid',cat_exp)) || ' (ERR 23514)' || E'\n';
  out := out || 'T21 despesa sem categoria:        ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L)', 'expense','x',today,p1,'paid',a1)) || ' (ERR 23514)' || E'\n';
  out := out || 'T22 receita com categoria de despesa: ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,null,%L)', 'income','x',today,p1,'paid',a1,cat_exp)) || ' (ERR P0001 category_kind_mismatch)' || E'\n';
  out := out || 'T23 valor zero:                   ' || pg_temp.try(format('select public.create_transaction(%L,%L,0,%L,%L,%L,%L,null,null,%L)', 'expense','x',today,p1,'paid',a1,cat_exp)) || ' (ERR 23514)' || E'\n';
  out := out || 'T24 sem data:                     ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,null,%L,%L,%L,null,null,%L)', 'expense','x',p1,'paid',a1,cat_exp)) || ' (ERR 22023)' || E'\n';

  out := out || E'\n--- atomicidade ---\n';
  select count(*) into n1 from public.tags;
  out := out || 'A1  falha ANTES de gravar (conta inexistente) com tags novas: ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,null,%L,null,null,null,array[%L,%L])', 'expense','x',today,p1,'paid',gen_random_uuid(),cat_exp,'tagfantasma1','tagfantasma2')) || ' (ERR 23503)' || E'\n';
  select count(*) into n2 from public.tags;
  select count(*) into v from public.transactions where description = 'x';
  out := out || format('A2  nenhuma tag criada e nenhuma movimentacao: tags %s -> %s (iguais), transacoes "x"=%s (0)', n1, n2, v) || E'\n';
  reset role;

  reset role;

  -- ===== usuario B =====
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  perform public.bootstrap_household('Casa B','Bia',false);
  select id into p2 from public.financial_profiles where kind='individual';
  select id into bcat from public.categories where name='Mercado' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name) values ((select household_id from public.financial_profiles limit 1),p2,'Conta B') returning id into ba;
  insert into public.credit_cards (household_id, owner_profile_id, name, limit_cents, closing_day, due_day) values ((select household_id from public.financial_profiles limit 1),p2,'Cartao B',100000,5,15) returning id into bc;
  out := out || E'\n--- usuario B ---\n';
  out := out || 'X1  B usa PERFIL do A:                ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,null,%L)', 'expense','x',today,p1,'paid',ba,bcat)) || ' (ERR P0002 profile_not_found)' || E'\n';
  out := out || 'X2  B usa CONTA do A (perfil dele):   ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,null,%L)', 'expense','x',today,p2,'paid',a1,bcat)) || ' (ERR 23503)' || E'\n';
  out := out || 'X3  B usa conta do A como DESTINO:    ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,%L)', 'transfer','x',today,p2,'paid',ba,a1)) || ' (ERR 23503)' || E'\n';
  out := out || 'X4  B usa CARTAO do A:                ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,null,null,null,%L,%L)', 'credit_card_purchase','x',today,p2,c1,bcat)) || ' (ERR 23503)' || E'\n';
  out := out || 'X5  B usa CATEGORIA do A:             ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,null,%L)', 'expense','x',today,p2,'paid',ba,cat_exp)) || ' (ERR 23503)' || E'\n';
  out := out || 'X6  B cria normal no que e dele:      ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,null,%L,null,null,null,array[%L])', 'expense','Dele',today,p2,'paid',ba,bcat,'Londres')) || ' (ok)' || E'\n';
  select count(*) into v from public.tags;
  out := out || format('X7  tags sao por household: B tem %s (1; a "Londres" do A nao e dele nem e compartilhada)', v) || E'\n';
  select count(*) into v from public.transactions where description <> 'Dele';
  out := out || format('X8  B nao ve movimentacoes do A: %s (0)', v) || E'\n';
  reset role;

  set local role anon;
  out := out || E'\n--- anon ---\n';
  out := out || 'N1  anon create_transaction: ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,null,%L)', 'expense','x',today,p1,'paid',a1,cat_exp)) || ' (ERR 42501)' || E'\n';
  reset role;

  out := out || E'
--- falha no meio da operacao (por ultimo: o trigger de teste some no rollback do bloco) ---
';
  -- trigger de teste: FALHA ao ligar tag a movimentacao (depois que movimentacao e tags novas ja foram inseridas)
  execute 'create function public.zz_boom() returns trigger language plpgsql as $f$ begin raise exception ''boom_tag_link''; end $f$';
  execute 'create trigger zz_boom before insert on public.transaction_tags for each row execute function public.zz_boom()';

  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n1 from public.tags;
  select count(*) into n2 from public.transactions;
  select count(*) into n3 from public.transaction_tags;
  out := out || 'A3  falha NO MEIO (ao ligar a tag) em create_transaction: ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,null,%L,null,null,null,array[%L])', 'expense','Meio',today,p1,'paid',a1,cat_exp,'tagnova')) || ' (ERR boom_tag_link)' || E'\n';
  out := out || format('A4  nada persistiu: tags %s -> %s, transacoes %s -> %s, ligacoes %s -> %s',
     n1, (select count(*) from public.tags), n2, (select count(*) from public.transactions), n3, (select count(*) from public.transaction_tags)) || ' (todos iguais)' || E'\n';
  select count(*) into v from public.transactions where description = 'Meio';
  out := out || format('A5  movimentacao "Meio" existe? %s (0)', v) || E'\n';
  select count(*) into n1 from public.installment_purchases; select count(*) into n2 from public.transactions;
  out := out || 'A6  falha NO MEIO em create_installment_purchase (parcelas ja inseridas): ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,90000,3,%L,null,array[%L])', c1, p1, cat_exp, 'Parcelado', today - 1, 'tagparcela')) || ' (ERR boom_tag_link)' || E'\n';
  out := out || format('A7  nenhum agrupador/parcela ficou: agrupadores %s -> %s, transacoes %s -> %s (iguais)', n1, (select count(*) from public.installment_purchases), n2, (select count(*) from public.transactions)) || E'\n';
  -- sem tags o mesmo trigger nao atrapalha (nao ha ligacao a fazer): a operacao passa
  out := out || 'A8  sem tags o trigger de teste nao interfere: ' || pg_temp.try(format('select public.create_transaction(%L,%L,1000,%L,%L,%L,%L,null,null,%L)', 'expense','SemTag',today,p1,'paid',a1,cat_exp)) || ' (ok rows=1)' || E'\n';
  reset role;
  -- (o trigger de teste some no rollback do bloco; nenhuma limpeza explicita e necessaria)

  raise exception E'\n==== RELATORIO create_transaction (tudo sera revertido) ====\n%', out;
end $$;
