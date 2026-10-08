-- Teste do bloco 3 (parte 1): transactions, card_invoices, installment_purchases, tags, views e isolamento.
-- (As RPCs têm teste próprio: transactions_rpc_test.sql.)
-- Reexecutável. Tudo roda num bloco que termina em RAISE EXCEPTION: NADA persiste; o relatório vem na
-- mensagem de erro. Compare cada linha com o "(esperado ...)".

create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok rows='||n;
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,80); end $f$;

-- Igual a try, mas informa a CONSTRAINT que rejeitou (usado onde importa qual regra disparou).
create function pg_temp.try_cn(q text) returns text language plpgsql as $f$
declare cn text; st text;
begin execute q; return 'ok';
exception when others then
  get stacked diagnostics cn = constraint_name, st = returned_sqlstate;
  return 'ERR '||st||' constraint='||coalesce(cn,'-'); end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; p1 uuid; p2 uuid; a1 uuid; a2 uuid; ba uuid; c1 uuid; c2 uuid; bc uuid;
  cat_exp uuid; cat_inc uuid; bcat uuid; inv_a uuid; inv_fut uuid; pur1 uuid; ip1 uuid; pay1 uuid; pay2 uuid; tg uuid; tx_id uuid;
  v_today date; d_buy date; d_fut date;
  out text := ''; v bigint; v2 bigint; b boolean; s text;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'b@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  -- ===== estrutura e funções de domínio (como dono) =====
  select is_nullable into s from information_schema.columns where table_schema='public' and table_name='credit_cards' and column_name='payment_account_id';
  out := out || format('S1  credit_cards.payment_account_id anulavel: %s (YES)', s) || E'\n';
  select count(*) into v from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('tags','card_invoices','installment_purchases','transactions','transaction_tags') and c.relrowsecurity;
  out := out || format('S2  tabelas novas com RLS ativo: %s (5)', v) || E'\n';
  select count(*) into v from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='v' and c.relname in ('v_account_balances','v_card_invoice_totals','v_card_usage')
     and coalesce(c.reloptions::text,'') like '%security_invoker=true%';
  out := out || format('S3  views com security_invoker: %s (3)', v) || E'\n';
  select count(*) into v from information_schema.columns where table_schema='public' and table_name='card_invoices' and column_name ilike any (array['%total%','%paid%','%open%','%pago%','%aberto%']);
  out := out || format('S4  colunas de total/pago/aberto em card_invoices: %s (0)', v) || E'\n';
  select count(*) into v from information_schema.columns where table_schema='public' and table_name in ('transactions','accounts') and column_name in ('balance','balance_cents','saldo','current_balance');
  out := out || format('S5  colunas de saldo atual em transactions/accounts: %s (0)', v) || E'\n';

  -- invoice_cycle: casos de ouro (os mesmos de tests/calculations.test.ts)
  select format('%s|%s|%s', closing_date, due_date, due_month) into s from public.invoice_cycle(20,27,'2026-10-15');
  out := out || format('C1  fecha 20/vence 27, compra 15/10: %s (2026-10-20|2026-10-27|2026-10-01)', s) || E'\n';
  select due_month::text into s from public.invoice_cycle(20,27,'2026-10-20');
  out := out || format('C2  compra no dia do fechamento ainda entra: %s (2026-10-01)', s) || E'\n';
  select format('%s|%s|%s', closing_date, due_date, due_month) into s from public.invoice_cycle(20,27,'2026-10-22');
  out := out || format('C3  compra 22/10 vai p/ a seguinte: %s (2026-11-20|2026-11-27|2026-11-01)', s) || E'\n';
  select due_month::text into s from public.invoice_cycle(20,27,'2026-12-25');
  out := out || format('C4  virada de ano: %s (2027-01-01)', s) || E'\n';
  select format('%s|%s|%s', closing_date, due_date, due_month) into s from public.invoice_cycle(25,3,'2026-10-10');
  out := out || format('C5  fecha 25/vence 3, compra 10/10: %s (2026-10-25|2026-11-03|2026-11-01)', s) || E'\n';
  select due_month::text into s from public.invoice_cycle(25,3,'2026-10-26');
  out := out || format('C6  fecha 25/vence 3, compra 26/10: %s (2026-12-01)', s) || E'\n';
  select format('%s|%s', closing_date, due_date) into s from public.invoice_cycle(31,10,'2027-02-28');
  out := out || format('C7  dia 31 limitado ao fim de fevereiro: %s (2027-02-28|2027-03-10)', s) || E'\n';
  out := out || format('C8  split_cents(100000,3)=%s (esperado {33334,33333,33333})', public.split_cents(100000,3)) || E'\n';
  out := out || format('C9  split_cents(1,2)=%s ({1,0})', public.split_cents(1,2)) || E'\n';
  select bool_and((select sum(x) from unnest(public.split_cents(t,n)) x) = t and cardinality(public.split_cents(t,n)) = n) into b
    from (values (100000::bigint,3),(100001,7),(999999,48),(300000,10),(1,48),(0,5)) as z(t,n);
  out := out || format('C10 soma das parcelas == total em 6 casos: %s (true)', b) || E'\n';
  out := out || format('C11 normalize_tags: %s ({Londres,"casa nova",Viagem})', private.normalize_tags(array['#Londres','  casa   nova ','LONDRES','','#','#Viagem'])) || E'\n';

  -- ===== usuario A =====
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where kind='individual';
  select id into cat_exp from public.categories where name='Mercado' and parent_id is null;
  select id into cat_inc from public.categories where name='Salário' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Nubank',100000) returning id into a1;
  insert into public.accounts (household_id, owner_profile_id, name) values (h1,p1,'Mercado Pago') returning id into a2;
  insert into public.credit_cards (household_id, owner_profile_id, payment_account_id, name, limit_cents, closing_day, due_day)
    values (h1,p1,null,'Cartao A',500000,28,5) returning id into c1;   -- conta padrão NULL (opcional)
  insert into public.credit_cards (household_id, owner_profile_id, payment_account_id, name, limit_cents, closing_day, due_day)
    values (h1,p1,a1,'Cartao A2',300000,10,20) returning id into c2;
  v_today := (now() at time zone 'America/Sao_Paulo')::date;
  d_buy := v_today - 1;  d_fut := v_today + 40;
  out := out || E'\n--- saldo (A) ---\n';

  insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,category_id) values (h1,'income','paid','Salario',500000,v_today,v_today,p1,a1,cat_inc);
  select balance_cents into v from public.v_account_balances where account_id=a1;
  out := out || format('B1  receita paga aumenta o saldo: %s (600000)', v) || E'\n';
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,category_id) values (h1,'expense','paid','Mercado',50000,v_today,v_today,p1,a1,cat_exp);
  select balance_cents into v from public.v_account_balances where account_id=a1;
  out := out || format('B2  despesa paga reduz o saldo: %s (550000)', v) || E'\n';
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,account_id,category_id) values (h1,'expense','planned','Futuro',30000,d_fut,p1,a1,cat_exp);
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,account_id,category_id) values (h1,'expense','pending','Pendente',10000,v_today,p1,a1,cat_exp);
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,account_id,category_id) values (h1,'income','pending','A receber',70000,v_today,p1,a1,cat_inc);
  select balance_cents into v from public.v_account_balances where account_id=a1;
  out := out || format('B3  despesa prevista/pendente e receita pendente NAO mexem no saldo: %s (550000)', v) || E'\n';
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,to_account_id) values (h1,'transfer','paid','Reserva',100000,v_today,v_today,p1,a1,a2);
  select balance_cents into v from public.v_account_balances where account_id=a1;
  select balance_cents into v2 from public.v_account_balances where account_id=a2;
  out := out || format('B4  transferencia: origem %s (450000) destino %s (100000)', v, v2) || E'\n';
  select sum(balance_cents) into v from public.v_account_balances;
  out := out || format('B5  transferencia nao altera o total (patrimonio): %s (550000)', v) || E'\n';
  out := out || 'B6  transferencia p/ a mesma conta: ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,to_account_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L)', h1,'transfer','paid','x',v_today,v_today,p1,a1,a1)) || ' (ERR 23514)' || E'\n';
  out := out || 'B7  transferencia com categoria:  ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,to_account_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L,%L)', h1,'transfer','paid','x',v_today,v_today,p1,a1,a2,cat_exp)) || ' (ERR 23514)' || E'\n';
  out := out || 'B8  despesa sem conta:           ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L)', h1,'expense','paid','x',v_today,v_today,p1,cat_exp)) || ' (ERR 23514)' || E'\n';
  out := out || 'B9  valor zero:                  ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,category_id) values (%L,%L,%L,%L,0,%L,%L,%L,%L,%L)', h1,'expense','paid','x',v_today,v_today,p1,a1,cat_exp)) || ' (ERR 23514)' || E'\n';
  out := out || 'B10 pago sem paid_at:            ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,account_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L)', h1,'expense','paid','x',v_today,p1,a1,cat_exp)) || ' (ERR 23514)' || E'\n';
  out := out || 'B11 receita com categoria de despesa: ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,account_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L)', h1,'income','pending','x',v_today,p1,a1,cat_exp)) || ' (ERR P0001 category_kind_mismatch)' || E'\n';

  out := out || E'\n--- compra no cartao (A) ---\n';
  -- invoice_id enviado pelo cliente (aleatorio) e IGNORADO: o banco decide
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,card_id,category_id,invoice_id)
    values (h1,'credit_card_purchase','pending','Jantar',50000,d_buy,p1,c1,cat_exp,gen_random_uuid()) returning id, invoice_id into pur1, inv_a;
  select (i.due_month = (select due_month from public.invoice_cycle(28,5,d_buy)) and i.closing_date = (select closing_date from public.invoice_cycle(28,5,d_buy)) and i.due_date = (select due_date from public.invoice_cycle(28,5,d_buy)))
    into b from public.card_invoices i where i.id = inv_a;
  out := out || format('K1  banco decide a fatura (cliente enviou invoice_id falso): %s (true)', b) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id=a1;
  out := out || format('K2  compra no cartao NAO reduz saldo: %s (450000)', v) || E'\n';
  select used_cents into v from public.v_card_usage where card_id=c1;
  out := out || format('K3  compra no cartao consome limite: %s (50000)', v) || E'\n';
  out := out || 'K4  compra com account_id:        ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,card_id,account_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L)', h1,'credit_card_purchase','pending','x',d_buy,p1,c1,a1,cat_exp)) || ' (ERR 23514)' || E'\n';
  out := out || 'K5  compra com status paid:       ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,card_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L)', h1,'credit_card_purchase','paid','x',d_buy,d_buy,p1,c1,cat_exp)) || ' (ERR 23514)' || E'\n';
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,card_id,category_id)
    values (h1,'credit_card_purchase','planned','Viagem futura',20000,d_fut,p1,c1,cat_exp) returning invoice_id into inv_fut;
  select used_cents into v from public.v_card_usage where card_id=c1;
  out := out || format('K6  compra apenas prevista nao consome limite: %s (50000)', v) || E'\n';
  select count(*) into v from public.card_invoices where card_id=c1;
  out := out || format('K7  faturas do cartao: %s (2: compra de ontem e a futura)', v) || E'\n';
  out := out || 'K8  mover compra p/ data da outra fatura: ' || pg_temp.try(format('update public.transactions set date=%L where id=%L', d_fut, pur1)) || ' (ok rows=1)' || E'\n';
  select count(*) into v from public.card_invoices where card_id=c1;
  out := out || format('K9  fatura vazia some (higiene): %s (1)', v) || E'\n';
  update public.transactions set date = d_buy where id = pur1;
  select invoice_id into inv_a from public.transactions where id = pur1;
  select count(*) into v from public.card_invoices where card_id=c1;
  out := out || format('K10 fatura recriada ao voltar a data: %s (2)', v) || E'\n';

  out := out || E'\n--- parcelas / agrupador (A) ---\n';
  insert into public.installment_purchases (household_id,card_id,profile_id,category_id,description,total_cents,installments_count,purchase_date)
    values (h1,c1,p1,cat_exp,'Notebook',30000,3,d_buy) returning id into ip1;
  out := out || 'I1  parcela 1:                   ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,card_id,category_id,installment_purchase_id,installment_number) values (%L,%L,%L,%L,10000,%L,%L,%L,%L,%L,1)', h1,'credit_card_purchase','pending','Notebook',d_buy,p1,c1,cat_exp,ip1)) || ' (ok rows=1)' || E'\n';
  out := out || 'I2  mesmo numero de parcela:     ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,card_id,category_id,installment_purchase_id,installment_number) values (%L,%L,%L,%L,10000,%L,%L,%L,%L,%L,1)', h1,'credit_card_purchase','pending','Notebook',d_buy,p1,c1,cat_exp,ip1)) || ' (ERR 23505)' || E'\n';
  out := out || 'I3  parcela 4 de 3:              ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,card_id,category_id,installment_purchase_id,installment_number) values (%L,%L,%L,%L,10000,%L,%L,%L,%L,%L,4)', h1,'credit_card_purchase','pending','Notebook',d_buy,p1,c1,cat_exp,ip1)) || ' (ERR P0001 out_of_range)' || E'\n';
  out := out || 'I4  parcela em outro cartao:    ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,card_id,category_id,installment_purchase_id,installment_number) values (%L,%L,%L,%L,10000,%L,%L,%L,%L,%L,2)', h1,'credit_card_purchase','pending','Notebook',d_buy,p1,c2,cat_exp,ip1)) || ' (ERR P0001 card_mismatch)' || E'\n';
  -- I5 isola o CHECK transactions_installment_only_card_purchase: card_id = cartao do agrupador, entao o trigger
  -- (installment_card_mismatch) nao rejeita antes. Sem card_id, o trigger (BEFORE ROW) dispararia primeiro.
  -- O formato por tipo (transactions_kind_shape) tambem rejeitaria card_id em despesa, mas CHECKs sao avaliados
  -- em ordem alfabetica de nome: installment_only_card_purchase vem antes de kind_shape.
  out := out || 'I5  parcela em despesa comum:   ' || pg_temp.try_cn(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,account_id,card_id,category_id,installment_purchase_id,installment_number) values (%L,%L,%L,%L,10000,%L,%L,%L,%L,%L,%L,2)', h1,'expense','pending','x',d_buy,p1,a1,c1,cat_exp,ip1)) || ' (ERR 23514 constraint=transactions_installment_only_card_purchase)' || E'\n';
  out := out || 'I6  apagar agrupador com parcelas: ' || pg_temp.try(format('delete from public.installment_purchases where id=%L', ip1)) || ' (ERR 23503)' || E'\n';
  -- o agrupador nunca soma: a fatura soma so as transacoes
  select total_cents into v from public.v_card_invoice_totals where invoice_id = inv_a;
  out := out || format('I7  fatura soma so transacoes (50000 + parcela 10000; agrupador de 30000 NAO entra): %s (60000)', v) || E'\n';

  out := out || E'\n--- pagamento de fatura (A) ---\n';
  select total_cents, paid_cents, open_cents, is_paid into v, v2, s, b from public.v_card_invoice_totals where invoice_id = inv_a;
  out := out || format('F1  fatura: total=%s pago=%s aberto=%s paga=%s (60000, 0, 60000, false)', v, v2, s, b) || E'\n';
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,card_id,invoice_id)
    values (h1,'card_payment','paid','Fatura parcial',20000,v_today,v_today,p1,a1,c1,inv_a) returning id into pay1;
  select balance_cents into v from public.v_account_balances where account_id=a1;
  select open_cents into v2 from public.v_card_invoice_totals where invoice_id = inv_a;
  out := out || format('F2  pagamento parcial: saldo=%s (430000) em aberto=%s (40000)', v, v2) || E'\n';
  select used_cents into v from public.v_card_usage where card_id=c1;
  out := out || format('F3  pagamento libera limite: usado=%s (40000)', v) || E'\n';
  out := out || 'F4  pagar acima do em aberto:   ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,card_id,invoice_id) values (%L,%L,%L,%L,40001,%L,%L,%L,%L,%L,%L)', h1,'card_payment','paid','x',v_today,v_today,p1,a1,c1,inv_a)) || ' (ERR P0001 payment_exceeds_open)' || E'\n';
  out := out || 'F5  pagamento p/ fatura de outro cartao: ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,card_id,invoice_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L,%L)', h1,'card_payment','paid','x',v_today,v_today,p1,a1,c2,inv_a)) || ' (ERR P0001 mismatch)' || E'\n';
  out := out || 'F6  pagamento p/ fatura inexistente: ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,card_id,invoice_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L,%L)', h1,'card_payment','paid','x',v_today,v_today,p1,a1,c1,gen_random_uuid())) || ' (ERR P0001 mismatch)' || E'\n';
  out := out || 'F7  pagamento como pendente:    ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,account_id,card_id,invoice_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L)', h1,'card_payment','pending','x',v_today,p1,a1,c1,inv_a)) || ' (ERR 23514)' || E'\n';
  out := out || 'F8  pagamento com categoria:   ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,card_id,invoice_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L,%L,%L)', h1,'card_payment','paid','x',v_today,v_today,p1,a1,c1,inv_a,cat_exp)) || ' (ERR 23514)' || E'\n';
  out := out || 'F9  despesa com invoice_id:   ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,category_id,invoice_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L,%L)', h1,'expense','paid','x',v_today,v_today,p1,a1,cat_exp,inv_a)) || ' (ERR 23514)' || E'\n';
  -- invariante adiada (no COMMIT): aqui forçamos a checagem imediata
  set constraints all immediate;
  out := out || 'F10 reduzir compra abaixo do ja pago: ' || pg_temp.try(format('update public.transactions set amount_cents=5000 where id=%L', pur1)) || ' (ERR P0001 invoice_overpaid)' || E'\n';
  set constraints all deferred;
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,card_id,invoice_id)
    values (h1,'card_payment','paid','Fatura final',40000,v_today,v_today,p1,a1,c1,inv_a) returning id into pay2;
  select open_cents, is_paid into v, b from public.v_card_invoice_totals where invoice_id = inv_a;
  out := out || format('F11 quitada: em aberto=%s (0) paga=%s (true)', v, b) || E'\n';
  select used_cents into v from public.v_card_usage where card_id=c1;
  out := out || format('F12 limite totalmente liberado: %s (0)', v) || E'\n';
  out := out || 'F13 editar compra da fatura paga:   ' || pg_temp.try(format('update public.transactions set description=%L where id=%L','x',pur1)) || ' (ERR P0001 invoice_paid_locked)' || E'\n';
  out := out || 'F14 cancelar compra da fatura paga: ' || pg_temp.try(format('update public.transactions set status=%L where id=%L','canceled',pur1)) || ' (ERR P0001 invoice_paid_locked)' || E'\n';
  out := out || 'F15 excluir compra da fatura paga:  ' || pg_temp.try(format('delete from public.transactions where id=%L',pur1)) || ' (ERR P0001 invoice_paid_locked)' || E'\n';
  out := out || 'F16 excluir o pagamento (reabre):   ' || pg_temp.try(format('delete from public.transactions where id=%L',pay2)) || ' (ok rows=1)' || E'\n';
  out := out || 'F17 compra volta a ser editavel:    ' || pg_temp.try(format('update public.transactions set description=%L where id=%L','Jantar 2',pur1)) || ' (ok rows=1)' || E'\n';
  select balance_cents into v from public.v_account_balances where account_id=a1;
  out := out || format('F18 saldo apos excluir o pagamento: %s (430000)', v) || E'\n';
  out := out || 'F19 mudar o tipo de uma movimentacao: ' || pg_temp.try(format('update public.transactions set kind=%L where id=%L','expense',pur1)) || ' (ERR P0001 kind_immutable)' || E'\n';

  out := out || E'\n--- tags (A) ---\n';
  insert into public.tags (household_id, name) values (h1, 'Londres') returning id into tg;
  select id into tx_id from public.transactions where household_id=h1 and description='Mercado' limit 1;
  out := out || 'G1  ligar tag:                    ' || pg_temp.try(format('insert into public.transaction_tags (household_id,transaction_id,tag_id) values (%L,%L,%L)', h1, tx_id, tg)) || ' (ok rows=1)' || E'\n';
  out := out || 'G2  tag duplicada (outra caixa):  ' || pg_temp.try(format('insert into public.tags (household_id,name) values (%L,%L)', h1, 'LONDRES')) || ' (ERR 23505)' || E'\n';
  out := out || 'G3  tag com #:                    ' || pg_temp.try(format('insert into public.tags (household_id,name) values (%L,%L)', h1, '#Casa')) || ' (ERR 23514)' || E'\n';
  reset role;

  -- ===== usuario B (outro household) =====
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  h2 := public.bootstrap_household('Casa B','Bia',false);
  select id into p2 from public.financial_profiles where kind='individual';
  select id into bcat from public.categories where name='Mercado' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name) values (h2,p2,'Conta B') returning id into ba;
  insert into public.credit_cards (household_id, owner_profile_id, name, limit_cents, closing_day, due_day) values (h2,p2,'Cartao B',100000,5,15) returning id into bc;
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,category_id) values (h2,'income','paid','Salario B',999900,v_today,v_today,p2,ba,(select id from public.categories where name='Salário' and parent_id is null));
  out := out || E'\n--- isolamento: usuario B ---\n';
  select count(*) into v from public.transactions;            out := out || format('X1  B ve transacoes: %s (1, so a dele)', v) || E'\n';
  select count(*) into v from public.transactions where household_id=h1; out := out || format('X2  B ve transacoes do A: %s (0)', v) || E'\n';
  select count(*) into v from public.card_invoices;           out := out || format('X3  B ve faturas: %s (0)', v) || E'\n';
  select count(*) into v from public.installment_purchases;   out := out || format('X4  B ve agrupadores: %s (0)', v) || E'\n';
  select count(*) into v from public.tags;                    out := out || format('X5  B ve tags: %s (0)', v) || E'\n';
  select count(*) into v from public.transaction_tags;        out := out || format('X6  B ve transaction_tags: %s (0)', v) || E'\n';
  select count(*) into v from public.v_account_balances;      out := out || format('X7  B ve saldos: %s (1, so a conta dele)', v) || E'\n';
  select count(*) into v from public.v_card_invoice_totals;   out := out || format('X8  B ve totais de fatura: %s (0)', v) || E'\n';
  select count(*) into v from public.v_card_usage;            out := out || format('X9  B ve uso de cartao: %s (1, so o dele)', v) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id=a1;
  out := out || format('X10 B le o saldo da conta do A: %s (nenhuma linha)', coalesce(v::text,'nenhuma linha')) || E'\n';
  out := out || 'X11 B cria movimentacao no h1:         ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L)', h1,'expense','paid','Invasao',v_today,v_today,p1,a1,cat_exp)) || ' (ERR 42501)' || E'\n';
  out := out || 'X12 B usa CONTA do A no h2:           ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L)', h2,'expense','paid','x',v_today,v_today,p2,a1,bcat)) || ' (ERR 23503)' || E'\n';
  out := out || 'X13 B usa conta do A como DESTINO:    ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,to_account_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L)', h2,'transfer','paid','x',v_today,v_today,p2,ba,a1)) || ' (ERR 23503)' || E'\n';
  out := out || 'X14 B usa CARTAO do A (compra):       ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,card_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L)', h2,'credit_card_purchase','pending','x',d_buy,p2,c1,bcat)) || ' (ERR 23503)' || E'\n';
  out := out || 'X15 B usa CATEGORIA do A:            ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L)', h2,'expense','paid','x',v_today,v_today,p2,ba,cat_exp)) || ' (ERR 23503)' || E'\n';
  out := out || 'X16 B usa PERFIL do A:               ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,category_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L)', h2,'expense','paid','x',v_today,v_today,p1,ba,bcat)) || ' (ERR 23503)' || E'\n';
  out := out || 'X17 B liga parcela ao agrupador do A: ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,card_id,category_id,installment_purchase_id,installment_number) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L,2)', h2,'credit_card_purchase','pending','x',d_buy,p2,bc,bcat,ip1)) || ' (ERR 23503/P0001)' || E'\n';
  out := out || 'X18 B paga FATURA do A:              ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,card_id,invoice_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L,%L)', h2,'card_payment','paid','x',v_today,v_today,p2,ba,bc,inv_a)) || ' (ERR P0001 mismatch)' || E'\n';
  out := out || 'X19 B paga fatura do A no h1:        ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,card_id,invoice_id) values (%L,%L,%L,%L,1000,%L,%L,%L,%L,%L,%L)', h1,'card_payment','paid','x',v_today,v_today,p1,a1,c1,inv_a)) || ' (ERR 42501)' || E'\n';
  out := out || 'X20 B altera transacao do A:          ' || pg_temp.try(format('update public.transactions set description=%L where id=%L','HACK',pur1)) || ' (ok rows=0)' || E'\n';
  out := out || 'X21 B apaga transacoes do A:          ' || pg_temp.try(format('delete from public.transactions where household_id=%L',h1)) || ' (ok rows=0)' || E'\n';
  out := out || 'X22 B cria agrupador no h1:           ' || pg_temp.try(format('insert into public.installment_purchases (household_id,card_id,profile_id,description,total_cents,installments_count,purchase_date) values (%L,%L,%L,%L,3000,3,%L)', h1,c1,p1,'x',d_buy)) || ' (ERR 42501)' || E'\n';
  out := out || 'X23 B cria agrupador no h2 c/ cartao do A: ' || pg_temp.try(format('insert into public.installment_purchases (household_id,card_id,profile_id,description,total_cents,installments_count,purchase_date) values (%L,%L,%L,%L,3000,3,%L)', h2,c1,p2,'x',d_buy)) || ' (ERR 23503)' || E'\n';
  out := out || 'X24 B cria tag no h1:                ' || pg_temp.try(format('insert into public.tags (household_id,name) values (%L,%L)', h1,'Invasao')) || ' (ERR 42501)' || E'\n';
  out := out || 'X25 B liga SUA transacao a tag do A:  ' || pg_temp.try(format('insert into public.transaction_tags (household_id,transaction_id,tag_id) select %L, id, %L from public.transactions limit 1', h2, tg)) || ' (ERR 23503)' || E'\n';
  out := out || 'X26 B grava em card_invoices:         ' || pg_temp.try(format('insert into public.card_invoices (household_id,card_id,due_month,closing_date,due_date) values (%L,%L,%L,%L,%L)', h2,bc,'2026-12-01','2026-11-05','2026-12-15')) || ' (ERR 42501 sem privilegio)' || E'\n';
  out := out || 'X27 B altera card_invoices:           ' || pg_temp.try(format('update public.card_invoices set due_date=%L where id=%L','2030-01-01',inv_a)) || ' (ERR 42501)' || E'\n';
  out := out || 'X28 B apaga card_invoices:            ' || pg_temp.try(format('delete from public.card_invoices where id=%L',inv_a)) || ' (ERR 42501)' || E'\n';
  reset role;

  -- ===== A nao ve o B =====
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v from public.transactions where household_id = h2;
  out := out || format('X29 A ve transacoes do B: %s (0)', v) || E'\n';
  reset role;

  -- ===== anon =====
  set local role anon;
  out := out || E'\n--- anon ---\n';
  out := out || 'N1  anon le transactions:  ' || pg_temp.try('select count(*) from public.transactions') || ' (ERR 42501)' || E'\n';
  out := out || 'N2  anon le card_invoices: ' || pg_temp.try('select count(*) from public.card_invoices') || ' (ERR 42501)' || E'\n';
  out := out || 'N3  anon le tags:          ' || pg_temp.try('select count(*) from public.tags') || ' (ERR 42501)' || E'\n';
  out := out || 'N4  anon le agrupadores:   ' || pg_temp.try('select count(*) from public.installment_purchases') || ' (ERR 42501)' || E'\n';
  out := out || 'N5  anon le v_account_balances: ' || pg_temp.try('select count(*) from public.v_account_balances') || ' (ERR 42501)' || E'\n';
  out := out || 'N6  anon le v_card_usage:  ' || pg_temp.try('select count(*) from public.v_card_usage') || ' (ERR 42501)' || E'\n';
  out := out || 'N7  anon invoice_cycle:    ' || pg_temp.try('select * from public.invoice_cycle(20,27,current_date)') || ' (ERR 42501)' || E'\n';
  out := out || 'N8  anon insere transacao: ' || pg_temp.try(format('insert into public.transactions (household_id,kind,description,amount_cents,date,profile_id) values (%L,%L,%L,1,current_date,%L)', h1,'expense','x',p1)) || ' (ERR 42501)' || E'\n';
  reset role;

  -- ===== cascata: A exclui o household com fatura paga (nao pode ser travado pela regra de fatura paga) =====
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,card_id,invoice_id)
    values (h1,'card_payment','paid','Quita tudo',40000,v_today,v_today,p1,a1,c1,inv_a);
  out := out || E'\n--- cascata ---\n';
  out := out || 'Z1  excluir household com fatura paga: ' || pg_temp.try(format('delete from public.households where id=%L',h1)) || ' (ok rows=1)' || E'\n';
  reset role;
  select count(*) into v from public.transactions where household_id=h1;          out := out || format('Z2  transacoes restantes de A: %s (0)', v) || E'\n';
  select count(*) into v from public.card_invoices where household_id=h1;        out := out || format('Z3  faturas restantes de A: %s (0)', v) || E'\n';
  select count(*) into v from public.installment_purchases where household_id=h1; out := out || format('Z4  agrupadores restantes de A: %s (0)', v) || E'\n';
  select count(*) into v from public.transactions where household_id=h2;         out := out || format('Z5  transacoes do B intactas: %s (1)', v) || E'\n';

  raise exception E'\n==== RELATORIO (tudo sera revertido) ====\n%', out;
end $$;
