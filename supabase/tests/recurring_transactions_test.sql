-- Teste de recorrências (sem DELETE direto; o teste de "excluir ocorrência = pular" está em recurring_skip_test.sql).
-- Reexecutável. Tudo roda num bloco que termina em RAISE EXCEPTION: NADA persiste.
-- Datas relativas a "hoje" do household (America/Sao_Paulo), então vale em qualquer dia.

create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok rows='||n;
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,80); end $f$;

create function pg_temp.dates(f public.recurrence_frequency, i int, a date, d1 date, d2 date) returns text language sql as $f$
  select coalesce(string_agg(to_char(d,'YYYY-MM-DD'), ' ' order by d), '(vazio)') from public.recurrence_dates(f, i, a, d1, d2) d $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; p1 uuid; p2 uuid; a1 uuid; a2 uuid; c1 uuid; cat_exp uuid; cat_inc uuid; cat_b uuid;
  today date; r jsonb; r2 jsonb; rid uuid; rid2 uuid; rid3 uuid; tx uuid; tx2 uuid;
  out text := ''; v bigint; v2 bigint; v3 bigint; s text; b boolean; bal0 bigint; used0 bigint; ids uuid[];
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'b@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  -- ================= regra de datas (função pura) =================
  out := out || E'--- recurrence_dates ---\n';
  out := out || format('D1  mensal dia 31 (out/2026..mar/2027): %s', pg_temp.dates('monthly',1,'2026-10-31','2026-10-01','2027-03-31')) || E'\n';
  out := out || '    (esperado 2026-10-31 2026-11-30 2026-12-31 2027-01-31 2027-02-28 2027-03-31: nunca encadeia 28 -> 28)' || E'\n';
  out := out || format('D2  fevereiro ano BISSEXTO (dia 31 em 2028): %s', pg_temp.dates('monthly',1,'2028-01-31','2028-01-01','2028-03-31')) || E'\n';
  out := out || '    (esperado 2028-01-31 2028-02-29 2028-03-31)' || E'\n';
  out := out || format('D3  virada de ano mensal dia 15: %s', pg_temp.dates('monthly',1,'2026-11-15','2026-11-01','2027-02-28')) || E'\n';
  out := out || '    (esperado 2026-11-15 2026-12-15 2027-01-15 2027-02-15)' || E'\n';
  out := out || format('D4  a cada 2 meses: %s', pg_temp.dates('monthly',2,'2026-10-10','2026-10-01','2027-04-30')) || E'\n';
  out := out || '    (esperado 2026-10-10 2026-12-10 2027-02-10 2027-04-10)' || E'\n';
  out := out || format('D5  semanal: %s', pg_temp.dates('weekly',1,'2026-10-05','2026-10-01','2026-10-31')) || E'\n';
  out := out || '    (esperado 2026-10-05 2026-10-12 2026-10-19 2026-10-26)' || E'\n';
  out := out || format('D6  a cada 2 semanas: %s', pg_temp.dates('weekly',2,'2026-10-05','2026-10-01','2026-11-30')) || E'\n';
  out := out || '    (esperado 2026-10-05 2026-10-19 2026-11-02 2026-11-16 2026-11-30)' || E'\n';
  out := out || format('D7  anual (IPVA em janeiro): %s', pg_temp.dates('yearly',1,'2027-01-15','2026-01-01','2029-12-31')) || E'\n';
  out := out || '    (esperado 2027-01-15 2028-01-15 2029-01-15; nada antes da ancora)' || E'\n';
  out := out || format('D8  anual 29/02: %s', pg_temp.dates('yearly',1,'2028-02-29','2028-01-01','2031-12-31')) || E'\n';
  out := out || '    (esperado 2028-02-29 2029-02-28 2030-02-28 2031-02-28)' || E'\n';
  out := out || format('D9  a cada 2 anos: %s', pg_temp.dates('yearly',2,'2026-03-01','2026-01-01','2031-12-31')) || E'\n';
  out := out || '    (esperado 2026-03-01 2028-03-01 2030-03-01)' || E'\n';
  out := out || format('D10 janela depois da ancora (mensal dia 10, jun..ago/2027): %s', pg_temp.dates('monthly',1,'2026-10-10','2027-06-01','2027-08-31')) || E'\n';
  out := out || '    (esperado 2027-06-10 2027-07-10 2027-08-10)' || E'\n';
  out := out || 'D11 intervalo invalido: ' || pg_temp.try('select * from public.recurrence_dates(''monthly'',0,''2026-01-01'',''2026-01-01'',''2026-12-31'')') || ' (ERR 22023)' || E'\n';

  -- ================= usuário A =================
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where kind='individual';
  select id into cat_exp from public.categories where name='Moradia' and parent_id is null;
  select id into cat_inc from public.categories where name='Salário' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Nubank',100000) returning id into a1;
  insert into public.credit_cards (household_id, owner_profile_id, name, limit_cents, closing_day, due_day) values (h1,p1,'Cartao A',500000,28,5) returning id into c1;
  today := private.household_today(h1);

  out := out || E'\n--- criar e gerar (A) ---\n';
  -- Internet: mensal, âncora = hoje -> ocorrências de hoje até +12 meses
  r := public.create_recurring_transaction('expense','  Internet  ',12000,p1,'monthly',today,cat_exp,1,null,a1,null,'obs',array['Casa','#Fixa','casa']);
  rid := (r->>'id')::uuid;
  select count(*) into v from public.transactions where recurring_transaction_id = rid;
  out := out || format('R1  ocorrencias geradas: %s (13 = hoje + 12 meses): %s', v, r) || E'\n';
  select count(*) into v from public.transactions where recurring_transaction_id = rid and occurrence_date > today + interval '12 months';
  out := out || format('R2  nada alem do horizonte de 12 meses: %s (0)', v) || E'\n';
  select string_agg(distinct status::text, ',') into s from public.transactions where recurring_transaction_id = rid and occurrence_date > today;
  out := out || format('R3  futuras nascem planned: %s (planned)', s) || E'\n';
  select status::text into s from public.transactions where recurring_transaction_id = rid and occurrence_date = today;
  out := out || format('R4  a de hoje nasce pending (a data chegou): %s (pending)', s) || E'\n';
  select count(*) into v from public.transactions where recurring_transaction_id = rid and description = 'Internet' and amount_cents = 12000 and account_id = a1 and category_id = cat_exp and notes = 'obs' and kind = 'expense';
  out := out || format('R5  campos copiados do template (descricao normalizada, valor, conta, categoria): %s (13)', v) || E'\n';
  select string_agg(g.name, ',' order by g.name) into s from public.transaction_tags tt join public.tags g on g.id = tt.tag_id
   where tt.transaction_id = (select id from public.transactions where recurring_transaction_id = rid limit 1);
  out := out || format('R6  tags normalizadas e copiadas: %s (Casa,Fixa)', s) || E'\n';
  select tags::text into s from public.recurring_transactions where id = rid;
  out := out || format('R7  template guarda tags normalizadas: %s ({Casa,Fixa})', s) || E'\n';

  out := out || E'\n--- idempotência ---\n';
  r2 := public.sync_recurring_transactions();
  select count(*) into v2 from public.transactions where recurring_transaction_id = rid;
  out := out || format('I1  sync de novo: %s; total continua %s (created=0; 13)', r2, v2) || E'\n';
  r2 := public.sync_recurring_transactions(rid);
  r2 := public.sync_recurring_transactions(rid);
  select count(*) into v2 from public.transactions where recurring_transaction_id = rid;
  select count(distinct occurrence_date) into v3 from public.transactions where recurring_transaction_id = rid;
  out := out || format('I2  mais 2 syncs: total %s = datas distintas %s (13 = 13)', v2, v3) || E'\n';
  out := out || 'I3  insert manual duplicado na mesma data: ' || pg_temp.try(format('insert into public.transactions (household_id,kind,status,description,amount_cents,date,profile_id,account_id,category_id,recurring_transaction_id,occurrence_date) values (%L,%L,%L,%L,1,%L,%L,%L,%L,%L,%L)', h1,'expense','planned','dup',today,p1,a1,cat_exp,rid,today)) || ' (ERR 23505)' || E'\n';

  out := out || E'\n--- o template nunca soma ---\n';
  select balance_cents into bal0 from public.v_account_balances where account_id = a1;
  out := out || format('S1  saldo so muda com ocorrencia PAGA (nada pago ainda): %s (100000)', bal0) || E'\n';
  select count(*) into v from public.recurring_transactions;
  out := out || format('S2  template e tabela separada (1 regra, ocorrencias em transactions): %s (1)', v) || E'\n';

  out := out || E'\n--- status: pago / cancelado nunca são alterados ---\n';
  select id into tx from public.transactions where recurring_transaction_id = rid and occurrence_date = today;
  perform public.update_transaction(tx, '{"status":"paid"}');
  select id into tx2 from public.transactions where recurring_transaction_id = rid and occurrence_date = (select min(occurrence_date) from public.transactions where recurring_transaction_id = rid and occurrence_date > today);
  perform public.update_transaction(tx2, '{"status":"canceled"}');
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('P1  ocorrencia paga reduz o saldo uma vez: %s (88000)', v) || E'\n';
  r2 := public.sync_recurring_transactions();
  select status::text into s from public.transactions where id = tx;
  out := out || format('P2  paga continua paga apos sync: %s (paid)', s) || E'\n';
  select status::text || '/' || canceled_by_rule::text into s from public.transactions where id = tx2;
  out := out || format('P3  cancelada pelo usuario continua cancelada (nao e da regra): %s (canceled/false)', s) || E'\n';

  out := out || E'\n--- editar a regra: histórico preservado ---\n';
  r2 := public.update_recurring_transaction(rid, '{"amount_cents":15000,"description":"Internet 500MB"}', array['Casa','Nova']);
  out := out || format('E1  resultado: %s', r2) || E'\n';
  select amount_cents into v from public.transactions where id = tx;
  out := out || format('E2  ocorrencia PAGA de hoje manteve R$ 120,00: %s (12000)', v) || E'\n';
  select description into s from public.transactions where id = tx;
  out := out || format('E3  ... e a descricao antiga: %s (Internet)', s) || E'\n';
  select count(*) into v from public.transactions where recurring_transaction_id = rid and occurrence_date > today and status = 'planned' and amount_cents = 15000 and description = 'Internet 500MB';
  out := out || format('E4  futuras planned receberam o novo valor: %s (11 = 12 futuras - 1 cancelada)', v) || E'\n';
  select amount_cents into v from public.transactions where id = tx2;
  out := out || format('E5  futura CANCELADA pelo usuario nao foi mexida: %s (12000)', v) || E'\n';
  select string_agg(g.name, ',' order by g.name) into s from public.transaction_tags tt join public.tags g on g.id = tt.tag_id
   where tt.transaction_id = (select id from public.transactions where recurring_transaction_id = rid and occurrence_date > today and status = 'planned' order by occurrence_date limit 1);
  out := out || format('E6  tags das futuras substituidas: %s (Casa,Nova)', s) || E'\n';
  select string_agg(g.name, ',' order by g.name) into s from public.transaction_tags tt join public.tags g on g.id = tt.tag_id where tt.transaction_id = tx;
  out := out || format('E7  tags da PAGA preservadas: %s (Casa,Fixa)', s) || E'\n';
  -- sem aplicar às futuras: só a regra muda
  r2 := public.update_recurring_transaction(rid, '{"amount_cents":16000}', null, false);
  select count(*) into v from public.transactions where recurring_transaction_id = rid and amount_cents = 16000;
  select amount_cents into v2 from public.recurring_transactions where id = rid;
  out := out || format('E8  apply_to_future=false: ocorrencias com 16000=%s (0); regra=%s (16000)', v, v2) || E'\n';
  out := out || 'E9  chave invalida (kind):   ' || pg_temp.try(format('select public.update_recurring_transaction(%L,%L)', rid, '{"kind":"income"}')) || ' (ERR 22023 invalid_patch_key)' || E'\n';

  out := out || E'\n--- mudar a agenda: futuras fora da nova agenda são canceladas pela regra ---\n';
  r2 := public.update_recurring_transaction(rid, '{"frequency":"yearly","amount_cents":15000}');
  out := out || format('G1  mensal -> anual: %s', r2) || E'\n';
  select count(*) into v from public.transactions where recurring_transaction_id = rid and status = 'planned' and occurrence_date > today;
  out := out || format('G2  futuras planned restantes (so as da agenda anual dentro do horizonte): %s (0 ou 1)', v) || E'\n';
  select count(*) into v from public.transactions where recurring_transaction_id = rid and status = 'canceled' and canceled_by_rule;
  out := out || format('G3  canceladas pela regra: %s (>= 10)', v) || E'\n';
  select status::text into s from public.transactions where id = tx;
  out := out || format('G4  paga de hoje intacta: %s (paid)', s) || E'\n';
  -- volta à agenda mensal: as futuras que a regra cancelou são reativadas (sem duplicar)
  r2 := public.update_recurring_transaction(rid, '{"frequency":"monthly"}');
  select count(*) into v from public.transactions where recurring_transaction_id = rid and status = 'planned' and occurrence_date > today;
  select count(*) into v2 from public.transactions where recurring_transaction_id = rid;
  out := out || format('G5  volta a mensal: %s planned futuras (11), total de linhas %s (13: sem duplicar)', v, v2) || E'\n';

  out := out || E'\n--- pausar / reativar ---\n';
  r2 := public.set_recurring_transaction_active(rid, false);
  out := out || format('Z1  pausar: %s', r2) || E'\n';
  select count(*) into v from public.transactions where recurring_transaction_id = rid and status = 'planned' and occurrence_date > today;
  out := out || format('Z2  nenhuma futura planned sobra: %s (0)', v) || E'\n';
  select status::text into s from public.transactions where id = tx;
  out := out || format('Z3  paga preservada: %s (paid); historico: %s linhas', s, (select count(*) from public.transactions where recurring_transaction_id = rid)) || E'\n';
  select count(*) into v from public.transactions where id = tx2 and status = 'canceled' and not canceled_by_rule;
  out := out || format('Z4  cancelada pelo usuario continua dela (nao vira "da regra"): %s (1)', v) || E'\n';
  r2 := public.sync_recurring_transactions();
  select count(*) into v from public.transactions where recurring_transaction_id = rid and status = 'planned' and occurrence_date > today;
  out := out || format('Z5  sync com regra pausada nao gera nada: %s (0)', v) || E'\n';
  r2 := public.set_recurring_transaction_active(rid, true);
  select count(*) into v from public.transactions where recurring_transaction_id = rid and status = 'planned' and occurrence_date > today;
  select count(*) into v2 from public.transactions where recurring_transaction_id = rid;
  out := out || format('Z6  reativar: %s; futuras planned %s (11), total %s (13)', r2, v, v2) || E'\n';
  select status::text into s from public.transactions where id = tx2;
  out := out || format('Z7  a cancelada pelo usuario NAO foi reativada: %s (canceled)', s) || E'\n';

  out := out || E'\n--- semanal e anual ---\n';
  r := public.create_recurring_transaction('expense','Feira',5000,p1,'weekly',today,cat_exp,2,null,a1);
  rid2 := (r->>'id')::uuid;
  select count(*) into v from public.transactions where recurring_transaction_id = rid2;
  out := out || format('W1  a cada 2 semanas em 12 meses: %s ocorrencias (27 ou 28)', v) || E'\n';
  r := public.create_recurring_transaction('expense','IPVA',200000,p1,'yearly',(date_trunc('year', today) + interval '1 year')::date,cat_exp,1,null,a1);
  rid3 := (r->>'id')::uuid;
  select count(*) into v from public.transactions where recurring_transaction_id = rid3;
  out := out || format('W2  anual (janeiro do ano que vem): %s ocorrencia(s) no horizonte (1)', v) || E'\n';
  r := public.create_recurring_transaction('income','Bonus',100000,p1,'monthly',today - 400,cat_inc,1,today + 40,a1);
  select count(*) into v from public.transactions where recurring_transaction_id = (r->>'id')::uuid;
  out := out || format('W3  inicio no PASSADO nao reconstroi historico; end_date respeitada: %s ocorrencias (1 ou 2, todas >= hoje: a ancora tem outro dia do mes)', v) || E'\n';
  select count(*) into v from public.transactions where recurring_transaction_id = (r->>'id')::uuid and occurrence_date < today;
  out := out || format('W4  nenhuma ocorrencia no passado: %s (0)', v) || E'\n';

  out := out || E'\n--- cartão: fatura do banco, sem mexer na conta, consome limite quando a data chega ---\n';
  select balance_cents into bal0 from public.v_account_balances where account_id = a1;
  r := public.create_recurring_transaction('credit_card_purchase','Netflix',5590,p1,'monthly',today,cat_exp,1,null,null,c1);
  rid2 := (r->>'id')::uuid;
  select count(*) into v from public.transactions where recurring_transaction_id = rid2 and invoice_id is not null and account_id is null;
  out := out || format('C1  13 ocorrencias, todas com fatura atribuida pelo banco e sem conta: %s (13)', v) || E'\n';
  select count(*) into v from public.transactions t join public.card_invoices i on i.id = t.invoice_id
   where t.recurring_transaction_id = rid2 and i.due_month = (select due_month from public.invoice_cycle(28,5,t.date));
  out := out || format('C2  fatura de cada ocorrencia == invoice_cycle(data): %s (13)', v) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('C3  saldo da conta NAO muda: %s -> %s (iguais)', bal0, v) || E'\n';
  select used_cents into v from public.v_card_usage where card_id = c1;
  out := out || format('C4  limite usado = so a de hoje (futuras prevista nao consomem): %s (5590)', v) || E'\n';
  select sum(total_cents) into v from public.v_card_invoice_totals where card_id = c1;
  out := out || format('C5  faturas somam as 13 ocorrencias (template nao soma): %s (72670)', v) || E'\n';
  out := out || 'C6  recorrencia no cartao com conta: ' || pg_temp.try(format('select public.create_recurring_transaction(%L,%L,100,%L,%L,%L,%L,1,null,%L,%L)', 'credit_card_purchase','x',p1,'monthly',today,cat_exp,a1,c1)) || ' (ERR 23514)' || E'\n';
  out := out || 'C7  tipo nao suportado (transferencia): ' || pg_temp.try(format('select public.create_recurring_transaction(%L,%L,100,%L,%L,%L,%L,1,null,%L)', 'transfer','x',p1,'monthly',today,cat_exp,a1)) || ' (ERR 22023)' || E'\n';
  r2 := public.set_recurring_transaction_active(rid2, false);
  select count(*) into v from public.transactions where recurring_transaction_id = rid2 and status = 'canceled' and canceled_by_rule;
  out := out || format('C8  pausar o cartao cancela as 12 futuras: %s (12); a de hoje permanece (pending)', v) || E'\n';
  reset role;

  -- ================= usuário B =================
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  h2 := public.bootstrap_household('Casa B','Bia',false);
  select id into p2 from public.financial_profiles where kind='individual';
  select id into cat_b from public.categories where name='Moradia' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name) values (h2,p2,'Conta B') returning id into a2;
  out := out || E'\n--- usuário B tenta atacar o A ---\n';
  select count(*) into v from public.recurring_transactions;
  out := out || format('X1  B enxerga recorrencias do A: %s (0)', v) || E'\n';
  select count(*) into v from public.transactions;
  out := out || format('X2  B nao enxerga ocorrencias do A: %s (0)', v) || E'\n';
  out := out || 'X3  B sincroniza regra do A: ' || pg_temp.try(format('select public.sync_recurring_transactions(%L)', rid)) || ' (ERR P0002 recurring_not_found)' || E'\n';
  out := out || 'X4  B edita regra do A:      ' || pg_temp.try(format('select public.update_recurring_transaction(%L,%L)', rid, '{"amount_cents":1}')) || ' (ERR P0002)' || E'\n';
  out := out || 'X5  B pausa regra do A:      ' || pg_temp.try(format('select public.set_recurring_transaction_active(%L,false)', rid)) || ' (ERR P0002)' || E'\n';
  out := out || 'X6  B cria regra com perfil do A: ' || pg_temp.try(format('select public.create_recurring_transaction(%L,%L,100,%L,%L,%L,%L,1,null,%L)', 'expense','x',p1,'monthly',today,cat_b,a2)) || ' (ERR P0002 profile_not_found)' || E'\n';
  out := out || 'X7  B cria regra no h2 com conta do A (FK composta): ' || pg_temp.try(format('select public.create_recurring_transaction(%L,%L,100,%L,%L,%L,%L,1,null,%L)', 'expense','x',p2,'monthly',today,cat_b,a1)) || ' (ERR 23503)' || E'\n';
  out := out || 'X8  B insere regra direto no h1: ' || pg_temp.try(format('insert into public.recurring_transactions (household_id,kind,description,amount_cents,profile_id,account_id,category_id,frequency,start_date,materialize_from) values (%L,%L,%L,1,%L,%L,%L,%L,%L,%L)', h1,'expense','x',p1,a1,cat_exp,'monthly',today,today)) || ' (ERR 42501)' || E'\n';
  r := public.create_recurring_transaction('expense','Dele',1000,p2,'monthly',today,cat_b,1,null,a2);
  select count(*) into v from public.recurring_transactions;
  out := out || format('X10 B so ve a propria: %s (1)', v) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v from public.recurring_transactions where description = 'Dele';
  select count(*) into v2 from public.transactions where description = 'Dele';
  out := out || format('X11 A nao ve a regra nem as ocorrencias do B: %s / %s (0 / 0)', v, v2) || E'\n';
  reset role;

  set local role anon;
  out := out || E'\n--- anon ---\n';
  out := out || 'N1  anon le recorrencias: ' || pg_temp.try('select count(*) from public.recurring_transactions') || ' (ERR 42501)' || E'\n';
  out := out || 'N2  anon sync:           ' || pg_temp.try('select public.sync_recurring_transactions()') || ' (ERR 42501)' || E'\n';
  out := out || 'N3  anon create:         ' || pg_temp.try(format('select public.create_recurring_transaction(%L,%L,100,%L,%L,%L,%L)', 'expense','x',p1,'monthly',today,cat_exp)) || ' (ERR 42501)' || E'\n';
  out := out || 'N4  anon recurrence_dates: ' || pg_temp.try('select * from public.recurrence_dates(''monthly'',1,''2026-01-01'',''2026-01-01'',''2026-02-01'')') || ' (ERR 42501)' || E'\n';
  reset role;

  raise exception E'\n==== RELATORIO RECORRENCIAS (tudo sera revertido) ====\n%', out;
end $$;
