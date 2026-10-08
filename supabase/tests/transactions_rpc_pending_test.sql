-- Teste das funções de supabase/pending/transaction_rpcs.sql:
--   delete_installments, set_transaction_tags (substituição de tags), update_transaction e update_installments (com tags).
--
-- ATENÇÃO: este teste AINDA NÃO FOI EXECUTADO (as funções dependem de DELETE e a ferramenta recusou aplicá-las).
-- Rode-o no SQL Editor DEPOIS de executar o arquivo pending. Reexecutável; termina em RAISE EXCEPTION (nada persiste).
-- Como é feito pelo SQL Editor (não pela ferramenta), este teste usa DELETE direto em um ponto (D6: apagar o pagamento
-- de fatura para destravar a compra) — é dentro do bloco revertido.

create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok rows='||n;
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,70); end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; p1 uuid; p2 uuid; a1 uuid; ba uuid; c1 uuid; bc uuid; cat_exp uuid; cat_inc uuid; bcat uuid;
  r jsonb; ip uuid; ids uuid[]; inv1 uuid; inv2 uuid; pay uuid; tx uuid; tx2 uuid; due date; today date; d0 date;
  out text := ''; v bigint; v2 bigint; s text; b boolean; n1 bigint; n2 bigint; n3 bigint; inv_before uuid; inv_after uuid;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'b@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where kind='individual';
  select id into cat_exp from public.categories where name='Lazer' and parent_id is null;
  select id into cat_inc from public.categories where name='Salário' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Nubank',1000000) returning id into a1;
  insert into public.credit_cards (household_id, owner_profile_id, name, limit_cents, closing_day, due_day) values (h1,p1,'Cartao A',900000,28,5) returning id into c1;
  today := private.household_today(h1);
  d0 := today - 1;

  -- ================= delete_installments =================
  out := out || E'--- delete_installments ---\n';
  r := public.create_installment_purchase(c1, p1, cat_exp, 'TV', 100000, 5, d0);
  ip := (r->>'purchase_id')::uuid;
  select array_agg(x::uuid) into ids from jsonb_array_elements_text(r->'transaction_ids') x;
  r := public.delete_installments(ids[5], 'this');
  select count(*) into v from public.transactions where installment_purchase_id = ip;
  out := out || format('D1  "somente esta" (5/5): %s; restam %s (deleted=1,kept_paid=0; 4)', r, v) || E'\n';
  r := public.delete_installments(ids[3], 'future');
  select count(*) into v from public.transactions where installment_purchase_id = ip;
  out := out || format('D2  "esta e as proximas" a partir da 3: %s; restam %s (deleted=2; 2: parcelas 1 e 2)', r, v) || E'\n';
  -- quita a fatura da parcela 1
  select invoice_id into inv1 from public.transactions where id = ids[1];
  select due_month into due from public.card_invoices where id = inv1;
  select open_cents into v from public.v_card_invoice_totals where invoice_id = inv1;
  pay := public.pay_invoice(c1, due, a1, v, today);
  out := out || 'D3  "somente esta" em parcela de fatura PAGA: ' || pg_temp.try(format('select public.delete_installments(%L,%L)', ids[1], 'this')) || ' (ERR P0001 invoice_paid_locked)' || E'\n';
  select count(*) into v from public.transactions where id = ids[1];
  out := out || format('D3b parcela paga continua existindo: %s (1)', v) || E'\n';
  r := public.delete_installments(ids[2], 'all');
  select count(*) into v from public.transactions where installment_purchase_id = ip;
  select count(*) into v2 from public.installment_purchases where id = ip;
  out := out || format('D4  "compra inteira" NAO apaga a parcela paga em silencio: %s; restam %s parcela(s) (deleted=1,kept_paid=1; 1) e agrupador=%s (1)', r, v, v2) || E'\n';
  -- reabre a fatura (exclui o pagamento) e apaga o que restou
  delete from public.transactions where id = pay;
  r := public.delete_installments(ids[1], 'all');
  select count(*) into v from public.transactions where installment_purchase_id = ip;
  select count(*) into v2 from public.installment_purchases where id = ip;
  out := out || format('D6  apos reabrir a fatura, "compra inteira": %s; parcelas=%s (0) agrupador=%s (0: some junto)', r, v, v2) || E'\n';
  select count(*) into v from public.card_invoices where card_id = c1;
  out := out || format('D6b faturas vazias removidas: %s (0)', v) || E'\n';
  out := out || 'D8  escopo invalido:               ' || pg_temp.try(format('select public.delete_installments(%L,%L)', gen_random_uuid(), 'tudo')) || ' (ERR 22023 invalid_scope)' || E'\n';
  -- invariante: excluir compra abaixo do que ja foi pago e recusado
  r := public.create_installment_purchase(c1, p1, cat_exp, 'Geladeira', 90000, 3, d0);
  select array_agg(x::uuid) into ids from jsonb_array_elements_text(r->'transaction_ids') x;
  select invoice_id into inv2 from public.transactions where id = ids[1];
  select due_month into due from public.card_invoices where id = inv2;
  perform public.pay_invoice(c1, due, a1, 20000, today);
  set constraints all immediate;
  out := out || 'D9  excluir parcela deixando o pago acima do total: ' || pg_temp.try(format('select public.delete_installments(%L,%L)', ids[1], 'this')) || ' (ERR P0001 invoice_overpaid)' || E'\n';
  set constraints all deferred;
  select count(*) into v from public.transactions where id = ids[1];
  out := out || format('D9b a parcela continua la (a operacao foi desfeita): %s (1)', v) || E'\n';

  -- ================= set_transaction_tags =================
  out := out || E'\n--- set_transaction_tags ---\n';
  select id into cat_exp from public.categories where name='Mercado' and parent_id is null;
  tx := public.create_transaction('expense','Compra',10000,today,p1,'paid',a1,null,null,cat_exp,null,null,null,array['A','B']);
  perform public.set_transaction_tags(tx, array['#b','C']);
  select string_agg(g.name, ',' order by g.name) into s from public.transaction_tags tt join public.tags g on g.id = tt.tag_id where tt.transaction_id = tx;
  out := out || format('G1  substitui: %s (B,C)', s) || E'\n';
  select count(*) into v from public.tags;
  out := out || format('G2  tag "A" deixa de estar ligada mas continua cadastrada (nao apaga tags): tags=%s (3)', v) || E'\n';
  perform public.set_transaction_tags(tx, array['c','C','#c']);
  select count(*) into v from public.transaction_tags where transaction_id = tx;
  out := out || format('G3  normaliza/dedup: %s ligacao (1)', v) || E'\n';
  perform public.set_transaction_tags(tx, '{}');
  select count(*) into v from public.transaction_tags where transaction_id = tx;
  out := out || format('G4  array vazio remove todas as ligacoes: %s (0)', v) || E'\n';
  perform public.set_transaction_tags(tx, array['Viagem']);
  out := out || 'G5  transacao inexistente:        ' || pg_temp.try(format('select public.set_transaction_tags(%L,%L)', gen_random_uuid(), array['x']::text)) || ' (ERR P0002)' || E'\n';
  reset role;

  -- ================= update_transaction =================
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  out := out || E'\n--- update_transaction ---\n';
  tx2 := public.create_transaction('expense','Luz',20000,today,p1,'pending',a1,null,null,cat_exp,null,null,null,array['casa']);
  select balance_cents into v from public.v_account_balances where account_id = a1;
  perform public.update_transaction(tx2, '{"status":"paid"}');
  select (status = 'paid' and paid_at = today) into b from public.transactions where id = tx2;
  select balance_cents into v2 from public.v_account_balances where account_id = a1;
  out := out || format('U1  marcar como pago: paid_at=hoje %s (true); saldo %s -> %s (-20000)', b, v, v2) || E'\n';
  perform public.update_transaction(tx2, jsonb_build_object('description','Luz maio','amount_cents',25000,'notes','x'), array['conta','casa','Energia']);
  select (description = 'Luz maio' and amount_cents = 25000 and notes = 'x') into b from public.transactions where id = tx2;
  select string_agg(g.name, ',' order by g.name) into s from public.transaction_tags tt join public.tags g on g.id = tt.tag_id where tt.transaction_id = tx2;
  out := out || format('U2  campos + tags numa operacao: %s (true); tags=%s (casa,conta,Energia)', b, s) || E'\n';
  perform public.update_transaction(tx2, '{"description":"Luz junho"}');
  select string_agg(g.name, ',' order by g.name) into s from public.transaction_tags tt join public.tags g on g.id = tt.tag_id where tt.transaction_id = tx2;
  out := out || format('U3  p_tags nulo nao mexe nas tags: %s (casa,conta,Energia)', s) || E'\n';
  perform public.update_transaction(tx2, '{"status":"pending"}', '{}');
  select (paid_at is null) into b from public.transactions where id = tx2;
  select count(*) into v from public.transaction_tags where transaction_id = tx2;
  out := out || format('U4  voltar a pendente limpa paid_at: %s (true); array vazio remove tags: %s (0)', b, v) || E'\n';
  out := out || 'U5  trocar o tipo:                ' || pg_temp.try(format('select public.update_transaction(%L,%L)', tx2, '{"kind":"income"}')) || ' (ERR 22023 invalid_patch_key)' || E'\n';
  out := out || 'U6  paid_at sem status paid:      ' || pg_temp.try(format('select public.update_transaction(%L,%L)', tx2, jsonb_build_object('paid_at', today)::text)) || ' (ERR 22023 invalid_paid_at)' || E'\n';
  -- atomicidade: falha de categoria DEPOIS de preparar tags => nada muda (descricao e tags antigas preservadas)
  perform public.set_transaction_tags(tx2, array['original']);
  out := out || 'U7  categoria incompativel + tags novas: ' || pg_temp.try(format('select public.update_transaction(%L,%L,%L)', tx2, jsonb_build_object('description','NAO DEVE FICAR','category_id',cat_inc)::text, array['nova']::text)) || ' (ERR P0001 category_kind_mismatch)' || E'\n';
  select description into s from public.transactions where id = tx2;
  out := out || format('U7b descricao preservada: [%s] (Luz junho); tags preservadas: %s', s, (select string_agg(g.name, ',') from public.transaction_tags tt join public.tags g on g.id = tt.tag_id where tt.transaction_id = tx2)) || ' (original)' || E'\n';
  -- compra no cartao: nova data muda status e fatura
  tx := public.create_transaction('credit_card_purchase','Jantar',30000,today - 1,p1,null,null,null,c1,cat_exp);
  select invoice_id into inv_before from public.transactions where id = tx;
  perform public.update_transaction(tx, jsonb_build_object('date', (today + 70)::text));
  select invoice_id into inv_after from public.transactions where id = tx;
  select status::text into s from public.transactions where id = tx;
  out := out || format('U8  compra no cartao com data futura: status=%s (planned); fatura mudou=%s (true)', s, inv_before is distinct from inv_after) || E'\n';
  out := out || 'U9  update_transaction em parcela:    ' || pg_temp.try(format('select public.update_transaction(%L,%L)', ids[2], '{"description":"x"}')) || ' (ERR 22023 use_update_installments)' || E'\n';
  out := out || 'U10 update_transaction em pagamento de fatura: ' || pg_temp.try(format('select public.update_transaction(%L,%L)', (select id from public.transactions where kind = 'card_payment' limit 1), '{"description":"x"}')) || ' (ERR 22023 use_pay_invoice_flow)' || E'\n';
  r := public.update_installments(ids[2], 'future', '{"description":"Geladeira Pro","tags":["parcela","Pro"]}');
  select count(*) into v from public.transaction_tags tt join public.transactions t on t.id = tt.transaction_id where t.installment_purchase_id = (select installment_purchase_id from public.transactions where id = ids[2]);
  out := out || format('U11 update_installments com tags (a partir da parcela 2; a 1 tem fatura so parcialmente paga, mas fora do escopo): %s; ligacoes=%s (4 = 2 tags x parcelas 2 e 3)', r, v) || E'
';
  reset role;

  -- ================= usuario B =================
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  h2 := public.bootstrap_household('Casa B','Bia',false);
  select id into p2 from public.financial_profiles where kind='individual';
  select id into bcat from public.categories where name='Mercado' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name) values (h2,p2,'Conta B') returning id into ba;
  out := out || E'\n--- usuario B ---\n';
  out := out || 'X1  B apaga parcelas do A:            ' || pg_temp.try(format('select public.delete_installments(%L,%L)', ids[2], 'all')) || ' (ERR P0002 transaction_not_found)' || E'\n';
  out := out || 'X2  B troca tags de transacao do A:   ' || pg_temp.try(format('select public.set_transaction_tags(%L,%L)', tx2, array['HACK']::text)) || ' (ERR P0002 transaction_not_found)' || E'\n';
  out := out || 'X3  B edita transacao do A:           ' || pg_temp.try(format('select public.update_transaction(%L,%L,%L)', tx2, '{"description":"HACK"}', array['HACK']::text)) || ' (ERR P0002 transaction_not_found)' || E'\n';
  out := out || 'X4  B update_installments no A:       ' || pg_temp.try(format('select public.update_installments(%L,%L,%L)', ids[2], 'future', '{"tags":["HACK"]}')) || ' (ERR P0002)' || E'\n';
  tx := public.create_transaction('expense','Dele',1000,today,p2,'paid',ba,null,null,bcat,null,null,null,array['b1']);
  out := out || 'X5  B move a propria transacao p/ conta do A + troca tags: ' || pg_temp.try(format('select public.update_transaction(%L,%L,%L)', tx, jsonb_build_object('account_id', a1)::text, array['b2']::text)) || ' (ERR 23503)' || E'\n';
  select string_agg(g.name, ',') into s from public.transaction_tags tt join public.tags g on g.id = tt.tag_id where tt.transaction_id = tx;
  out := out || format('X6  tags dele preservadas apos a falha: %s (b1)', s) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v from public.transactions where description = 'HACK';
  select count(*) into v2 from public.tags where name = 'HACK';
  out := out || format('X7  A: nada adulterado: transacoes=%s (0) tags=%s (0)', v, v2) || E'\n';
  reset role;

  set local role anon;
  out := out || E'\n--- anon ---\n';
  out := out || 'N1  anon delete_installments:  ' || pg_temp.try(format('select public.delete_installments(%L,%L)', ids[2], 'all')) || ' (ERR 42501)' || E'\n';
  out := out || 'N2  anon set_transaction_tags: ' || pg_temp.try(format('select public.set_transaction_tags(%L,%L)', tx2, array['x']::text)) || ' (ERR 42501)' || E'\n';
  out := out || 'N3  anon update_transaction:   ' || pg_temp.try(format('select public.update_transaction(%L,%L)', tx2, '{}')) || ' (ERR 42501)' || E'\n';
  reset role;

  -- ================= rollback no MEIO: a substituicao de tags e atomica =================
  out := out || E'\n--- rollback no meio (por ultimo) ---\n';
  execute 'create function public.zz_boom() returns trigger language plpgsql as $f$ begin raise exception ''boom_tag_link''; end $f$';
  execute 'create trigger zz_boom before insert on public.transaction_tags for each row execute function public.zz_boom()';
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  select string_agg(g.name, ',' order by g.name) into s from public.transaction_tags tt join public.tags g on g.id = tt.tag_id where tt.transaction_id = tx2;
  out := out || 'R1  set_transaction_tags falha DEPOIS de remover as ligacoes antigas: ' || pg_temp.try(format('select public.set_transaction_tags(%L,%L)', tx2, array['nova1','nova2']::text)) || ' (ERR boom_tag_link)' || E'\n';
  out := out || format('R2  ligacoes antigas continuam la (a remocao foi desfeita): antes=%s depois=%s', s,
     (select string_agg(g.name, ',' order by g.name) from public.transaction_tags tt join public.tags g on g.id = tt.tag_id where tt.transaction_id = tx2)) || ' (iguais)' || E'\n';
  out := out || 'R3  update_transaction com tags novas falha no meio: ' || pg_temp.try(format('select public.update_transaction(%L,%L,%L)', tx2, '{"description":"NAO DEVE FICAR"}', array['zzz']::text)) || ' (ERR boom_tag_link)' || E'\n';
  select description into s from public.transactions where id = tx2;
  out := out || format('R4  descricao nao mudou: [%s] (Luz junho)', s) || E'\n';
  reset role;

  raise exception E'\n==== RELATORIO (pending) (tudo sera revertido) ====\n%', out;
end $$;
