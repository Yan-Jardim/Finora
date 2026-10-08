-- Teste do bloco 3 (parte 2): RPCs create_installment_purchase, pay_invoice, update_installments.
-- (delete_installments / set_transaction_tags: pendentes de aprovação, ver supabase/pending/transaction_rpcs.sql.)
-- Reexecutável. Tudo roda num bloco que termina em RAISE EXCEPTION: NADA persiste.

create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok rows='||n;
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,70); end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; p1 uuid; p2 uuid; a1 uuid; ba uuid; c1 uuid; c2 uuid; bc uuid; cat_exp uuid; cat_inc uuid; bcat uuid;
  r jsonb; ip uuid; ids uuid[]; inv1 uuid; inv2 uuid; pay uuid; ex uuid;
  today date; d0 date;
  out text := ''; v bigint; v2 bigint; v3 bigint; s text; b boolean; n1 bigint; n2 bigint; amounts text;
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
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Nubank',100000) returning id into a1;
  insert into public.credit_cards (household_id, owner_profile_id, name, limit_cents, closing_day, due_day) values (h1,p1,'Cartao A',500000,28,5) returning id into c1;
  insert into public.credit_cards (household_id, owner_profile_id, name, limit_cents, closing_day, due_day) values (h1,p1,'Cartao A2',900000,10,20) returning id into c2;
  today := private.household_today(h1);
  d0 := today - 1;

  out := out || E'--- create_installment_purchase (A) ---\n';
  -- R$ 1.000,00 em 3x, com tags
  r := public.create_installment_purchase(c1, p1, cat_exp, '  Notebook  ', 100000, 3, d0, 'garantia 1 ano', array['#Londres','Viagem','londres']);
  ip := (r->>'purchase_id')::uuid;
  select array_agg(x::uuid) into ids from jsonb_array_elements_text(r->'transaction_ids') x;
  out := out || format('R1  numero de parcelas geradas: %s (3)', cardinality(ids)) || E'\n';
  select string_agg(amount_cents::text, ',' order by installment_number) into amounts from public.transactions where installment_purchase_id = ip;
  out := out || format('R2  valores das parcelas: %s (33334,33333,33333)', amounts) || E'\n';
  select sum(amount_cents) into v from public.transactions where installment_purchase_id = ip;
  out := out || format('R3  soma das parcelas == R$ 1.000,00: %s (100000)', v) || E'\n';
  select string_agg(installment_number::text||':'||status::text, ',' order by installment_number) into s from public.transactions where installment_purchase_id = ip;
  out := out || format('R4  numeracao/status (1ª ja ocorreu, demais futuras): %s (1:pending,2:planned,3:planned)', s) || E'\n';
  select string_agg(to_char(date,'YYYY-MM-DD'), ',' order by installment_number) into s from public.transactions where installment_purchase_id = ip;
  out := out || format('R5  datas (mes a mes, mesmo dia): %s (%s,%s,%s)', s, d0, (d0 + interval '1 month')::date, (d0 + interval '2 months')::date) || E'\n';
  select count(*) into v from public.transactions where installment_purchase_id = ip and kind='credit_card_purchase' and installment_number is not null and account_id is null;
  out := out || format('R6  todas sao compra no cartao, sem conta: %s (3)', v) || E'\n';
  select (description = 'Notebook' and notes = 'garantia 1 ano') into b from public.transactions where id = ids[1];
  out := out || format('R7  descricao/observacao normalizadas: %s (true)', b) || E'\n';
  select count(distinct invoice_id) into v from public.transactions where installment_purchase_id = ip;
  out := out || format('R8  cada parcela em sua fatura: %s faturas distintas (3)', v) || E'\n';
  select count(*) into v from public.transactions t join public.card_invoices i on i.id = t.invoice_id
   where t.installment_purchase_id = ip and i.due_month = (select due_month from public.invoice_cycle(28,5,t.date));
  out := out || format('R9  fatura de cada parcela == invoice_cycle(data): %s (3)', v) || E'\n';
  select sum(total_cents) into v from public.v_card_invoice_totals where card_id = c1;
  out := out || format('R10 faturas somam so as parcelas (agrupador NAO entra): %s (100000)', v) || E'\n';
  select used_cents into v from public.v_card_usage where card_id = c1;
  out := out || format('R11 limite usado (compra ja feita: parcelas futuras incluidas): %s (100000)', v) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('R12 saldo da conta NAO muda: %s (100000)', v) || E'\n';
  select count(*) into v from public.tags;
  select count(*) into v2 from public.transaction_tags;
  out := out || format('R13 tags: %s distintas (2: Londres, Viagem) / %s ligacoes (6 = 2 x 3 parcelas)', v, v2) || E'\n';
  select total_cents into v from public.installment_purchases where id = ip;
  out := out || format('R14 agrupador guarda o total original: %s (100000)', v) || E'\n';

  -- atomicidade: se QUALQUER passo falha, nada fica (nem o agrupador)
  select count(*) into n1 from public.installment_purchases;
  out := out || 'R15 perfil inexistente:       ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,90000,3,%L)', c1, gen_random_uuid(), cat_exp, 'X', d0)) || ' (ERR 23503)' || E'\n';
  out := out || 'R16 categoria de receita:     ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,90000,3,%L)', c1, p1, cat_inc, 'X', d0)) || ' (ERR P0001 category_kind_mismatch)' || E'\n';
  out := out || 'R17 R$ 0,01 em 2x (parcela 0):' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,1,2,%L)', c1, p1, cat_exp, 'X', d0)) || ' (ERR 23514)' || E'\n';
  select count(*) into n2 from public.installment_purchases;
  out := out || format('R18 apos 3 falhas, agrupadores: %s -> %s (inalterado: nada de agrupador sem parcelas)', n1, n2) || E'\n';
  select count(*) into v from public.transactions where installment_purchase_id is null and kind = 'credit_card_purchase';
  out := out || format('R19 nenhuma parcela solta ficou: %s (0)', v) || E'\n';
  out := out || 'R20 1 parcela:               ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,90000,1,%L)', c1, p1, cat_exp, 'X', d0)) || ' (ERR 22023)' || E'\n';
  out := out || 'R21 49 parcelas:              ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,90000,49,%L)', c1, p1, cat_exp, 'X', d0)) || ' (ERR 22023)' || E'\n';
  out := out || 'R22 valor zero:               ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,0,3,%L)', c1, p1, cat_exp, 'X', d0)) || ' (ERR 22023)' || E'\n';
  out := out || 'R23 sem descricao:            ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,90000,3,%L)', c1, p1, cat_exp, '   ', d0)) || ' (ERR 23514)' || E'\n';
  out := out || 'R24 R$ 1.000,01 em 7x:        ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,100001,7,%L)', c2, p1, cat_exp, 'Sete', d0)) || ' (ok)' || E'\n';
  select sum(amount_cents) into v from public.transactions where description = 'Sete';
  out := out || format('R25 soma de 7 parcelas == 100001: %s (100001)', v) || E'\n';

  out := out || E'\n--- pay_invoice (A) ---\n';
  select invoice_id into inv1 from public.transactions where installment_purchase_id = ip and installment_number = 1;
  select due_month into d0 from public.card_invoices where id = inv1;   -- reaproveita d0 como due_month
  pay := public.pay_invoice(c1, d0, a1, 10000, today);
  select kind::text || '/' || status::text into s from public.transactions where id = pay;
  out := out || format('P1  pagamento parcial registrado: %s (card_payment/paid)', s) || E'\n';
  select open_cents, paid_cents into v, v2 from public.v_card_invoice_totals where invoice_id = inv1;
  out := out || format('P2  em aberto=%s (23334) pago=%s (10000)', v, v2) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('P3  saldo da conta reduz: %s (90000)', v) || E'\n';
  select used_cents into v from public.v_card_usage where card_id = c1;
  out := out || format('P4  limite liberado: usado=%s (90000 = 100000 - 10000)', v) || E'\n';
  select description into s from public.transactions where id = pay;
  out := out || format('P5  descricao: %s', s) || E'\n';
  out := out || 'P6  pagar acima do em aberto:  ' || pg_temp.try(format('select public.pay_invoice(%L,%L,%L,30000,%L)', c1, d0, a1, today)) || ' (ERR P0001 payment_exceeds_open)' || E'\n';
  out := out || 'P7  fatura inexistente:        ' || pg_temp.try(format('select public.pay_invoice(%L,%L,%L,1000,%L)', c1, '2031-01-01'::date, a1, today)) || ' (ERR P0002 invoice_not_found)' || E'\n';
  out := out || 'P8  valor zero:                ' || pg_temp.try(format('select public.pay_invoice(%L,%L,%L,0,%L)', c1, d0, a1, today)) || ' (ERR 22023)' || E'\n';
  out := out || 'P9  qualquer dia do mes serve: ' || pg_temp.try(format('select public.pay_invoice(%L,%L,%L,1000,%L)', c1, (d0 + 14), a1, today)) || ' (ok)' || E'\n';
  select open_cents into v from public.v_card_invoice_totals where invoice_id = inv1;
  pay := public.pay_invoice(c1, d0, a1, v::bigint, today);
  select open_cents, is_paid into v, b from public.v_card_invoice_totals where invoice_id = inv1;
  out := out || format('P10 quitada: em aberto=%s (0) paga=%s (true)', v, b) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('P11 saldo apos quitar (100000 - 33334): %s (66666)', v) || E'\n';
  select count(*) into v from public.transactions where kind = 'card_payment' and category_id is not null;
  out := out || format('P12 pagamento nao tem categoria (nao e despesa): %s (0)', v) || E'\n';

  out := out || E'\n--- update_installments (A) ---\n';
  out := out || 'U1  parcela de fatura paga (this): ' || pg_temp.try(format('select public.update_installments(%L,%L,%L)', ids[1], 'this', '{"description":"X"}')) || ' (ERR P0001 invoice_paid_locked)' || E'\n';
  r := public.update_installments(ids[1], 'future', '{"description":"Notebook Pro","notes":"nota nova"}');
  out := out || format('U2  "esta e as proximas" a partir da 1ª: %s (updated=2, kept_paid=1: a da fatura paga e preservada)', r) || E'\n';
  select string_agg(description, '|' order by installment_number) into s from public.transactions where installment_purchase_id = ip;
  out := out || format('U3  descricoes: %s (Notebook|Notebook Pro|Notebook Pro)', s) || E'\n';
  select string_agg(amount_cents::text, ',' order by installment_number) into amounts from public.transactions where installment_purchase_id = ip;
  out := out || format('U4  valores NAO propagam: %s (33334,33333,33333)', amounts) || E'\n';
  out := out || 'U5  amount_cents em "future":     ' || pg_temp.try(format('select public.update_installments(%L,%L,%L)', ids[2], 'future', '{"amount_cents":1}')) || ' (ERR 22023 invalid_patch_key)' || E'\n';
  out := out || 'U6  escopo invalido:              ' || pg_temp.try(format('select public.update_installments(%L,%L,%L)', ids[2], 'all', '{}')) || ' (ERR 22023 invalid_scope)' || E'\n';
  r := public.update_installments(ids[3], 'this', jsonb_build_object('amount_cents', 40000, 'date', (today + 90)::text));
  select amount_cents::text || '/' || status::text into s from public.transactions where id = ids[3];
  out := out || format('U7  "somente esta": valor e data (futura -> planned): %s (40000/planned); retorno %s', s, r) || E'\n';
  r := public.update_installments(ids[3], 'this', jsonb_build_object('date', (today - 2)::text));
  select status::text into s from public.transactions where id = ids[3];
  out := out || format('U8  data que ja chegou -> pending: %s (pending)', s) || E'\n';
  insert into public.transactions (household_id,kind,status,description,amount_cents,date,paid_at,profile_id,account_id,category_id) values (h1,'expense','paid','Avulsa',1000,today,today,p1,a1,cat_exp) returning id into ex;
  out := out || 'U9  movimentacao sem parcelamento:  ' || pg_temp.try(format('select public.update_installments(%L,%L,%L)', ex, 'this', '{}')) || ' (ERR 22023 not_an_installment)' || E'\n';
  out := out || 'U10 trocar perfil p/ inexistente:  ' || pg_temp.try(format('select public.update_installments(%L,%L,%L)', ids[2], 'this', jsonb_build_object('profile_id', gen_random_uuid()))) || ' (ERR 23503)' || E'\n';
  reset role;

  -- ===== usuario B =====
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  h2 := public.bootstrap_household('Casa B','Bia',false);
  select id into p2 from public.financial_profiles where kind='individual';
  select id into bcat from public.categories where name='Lazer' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name) values (h2,p2,'Conta B') returning id into ba;
  insert into public.credit_cards (household_id, owner_profile_id, name, limit_cents, closing_day, due_day) values (h2,p2,'Cartao B',100000,5,15) returning id into bc;
  out := out || E'\n--- usuario B tenta atacar o A pelas RPCs ---\n';
  out := out || 'X1  B parcela usando CARTAO do A:      ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,90000,3,%L)', c1, p2, bcat, 'X', today)) || ' (ERR P0002 card_not_found)' || E'\n';
  out := out || 'X2  B parcela no cartao dele com PERFIL do A:    ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,90000,3,%L)', bc, p1, bcat, 'X', today)) || ' (ERR 23503)' || E'\n';
  out := out || 'X3  B parcela no cartao dele com CATEGORIA do A: ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,90000,3,%L)', bc, p2, cat_exp, 'X', today)) || ' (ERR 23503)' || E'\n';
  select count(*) into v from public.installment_purchases;
  out := out || format('X4  B nao ficou com agrupador de tentativas falhas: %s (0)', v) || E'\n';
  out := out || 'X5  B paga FATURA do A (cartao do A):   ' || pg_temp.try(format('select public.pay_invoice(%L,%L,%L,1000,%L)', c1, d0, ba, today)) || ' (ERR P0002 card_not_found)' || E'\n';
  out := out || 'X6  B atualiza PARCELA do A:             ' || pg_temp.try(format('select public.update_installments(%L,%L,%L)', ids[2], 'this', '{"description":"HACK"}')) || ' (ERR P0002 transaction_not_found)' || E'\n';
  out := out || 'X7  B atualiza "future" no agrupador do A: ' || pg_temp.try(format('select public.update_installments(%L,%L,%L)', ids[2], 'future', '{"description":"HACK"}')) || ' (ERR P0002)' || E'\n';
  -- B com cartao proprio, mas pagando com conta do A
  r := public.create_installment_purchase(bc, p2, bcat, 'Compra B', 30000, 3, today - 1);
  out := out || 'X8  B paga a propria fatura com CONTA do A: ' || pg_temp.try(format('select public.pay_invoice(%L,%L,%L,1000,%L)', bc, (select due_month from public.card_invoices where card_id = bc order by due_month limit 1), a1, today)) || ' (ERR 23503)' || E'\n';
  select count(*) into v from public.transactions where description = 'HACK';
  out := out || format('X9  nada foi adulterado: %s (0)', v) || E'\n';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v from public.transactions where description = 'Compra B';
  out := out || format('X10 A ve a compra do B: %s (0)', v) || E'\n';
  reset role;

  set local role anon;
  out := out || E'\n--- anon ---\n';
  out := out || 'N1  anon create_installment_purchase: ' || pg_temp.try(format('select public.create_installment_purchase(%L,%L,%L,%L,90000,3,%L)', c1, p1, cat_exp, 'X', today)) || ' (ERR 42501)' || E'\n';
  out := out || 'N2  anon pay_invoice:                 ' || pg_temp.try(format('select public.pay_invoice(%L,%L,%L,1000,%L)', c1, d0, a1, today)) || ' (ERR 42501)' || E'\n';
  out := out || 'N3  anon update_installments:         ' || pg_temp.try(format('select public.update_installments(%L,%L,%L)', ids[1], 'this', '{}')) || ' (ERR 42501)' || E'\n';
  reset role;

  raise exception E'\n==== RELATORIO RPCs (tudo sera revertido) ====\n%', out;
end $$;
