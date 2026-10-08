-- Teste do bloco 2 (categories, accounts, credit_cards): isolamento entre households e regras de integridade.
-- Reexecutável. Tudo roda dentro de um bloco que termina em RAISE EXCEPTION: NADA persiste;
-- o relatório aparece na mensagem de erro. Compare cada linha com o "(esperado ...)".

create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok rows='||n;
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,100); end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; p1 uuid; p2 uuid; a1 uuid; a2 uuid; c1 uuid;
  moradia uuid; aluguel uuid; alimentacao uuid;
  out text := ''; v bigint; cols text;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'b@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  -- ===== estrutura (como dono) =====
  select string_agg(column_name, ',') into cols from information_schema.columns
   where table_schema='public' and table_name='accounts' and (column_name ilike '%balance%' or column_name ilike '%saldo%');
  out := out || format('S1  colunas de saldo em accounts: %s (esperado so initial_balance_cents)', cols) || E'\n';
  select count(*) into v from information_schema.columns
   where table_schema='public' and table_name='credit_cards' and (column_name ilike '%cvv%' or column_name ilike '%cvc%' or column_name ilike '%pan%' or column_name ilike '%number%' or column_name ilike '%numero%');
  out := out || format('S2  colunas de CVV/numero em credit_cards: %s (esperado 0)', v) || E'\n';
  select count(*) into v from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('categories','accounts','credit_cards') and c.relrowsecurity;
  out := out || format('S3  tabelas com RLS ativo: %s (esperado 3)', v) || E'\n';

  -- ===== usuario A =====
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa A','Ana',true,'Casal');
  select id into p1 from public.financial_profiles where kind='individual';
  select count(*) into v from public.categories;
  out := out || format('A1  A ve categorias: %s (esperado 23: 17 raizes + 6 subcategorias, semeadas no bootstrap)', v) || E'\n';
  select id into moradia from public.categories where name='Moradia' and parent_id is null;
  select id into aluguel from public.categories where name='Aluguel';
  select id into alimentacao from public.categories where name='Alimentação' and parent_id is null;
  out := out || 'A2  sub de sub:             ' || pg_temp.try(format('insert into public.categories (household_id,name,parent_id) values (%L,%L,%L)', h1,'X',aluguel)) || ' (ERR P0001 parent_must_be_root)' || E'\n';
  out := out || 'A3  tipo incompativel:      ' || pg_temp.try(format('insert into public.categories (household_id,name,parent_id,kind) values (%L,%L,%L,%L)', h1,'Bonus',moradia,'income')) || ' (ERR P0001 kind_incompatible)' || E'\n';
  out := out || 'A4  pai com filhos vira filho: ' || pg_temp.try(format('update public.categories set parent_id=%L where id=%L', alimentacao, moradia)) || ' (ERR P0001 has_children)' || E'\n';
  out := out || 'A5  nome duplicado (raiz):  ' || pg_temp.try(format('insert into public.categories (household_id,name) values (%L,%L)', h1,'moradia')) || ' (ERR 23505)' || E'\n';
  out := out || 'A6  mesmo nome em outro pai: ' || pg_temp.try(format('insert into public.categories (household_id,name,parent_id) values (%L,%L,%L)', h1,'Aluguel',alimentacao)) || ' (ok rows=1)' || E'\n';
  out := out || 'A7  cor invalida:           ' || pg_temp.try(format('insert into public.categories (household_id,name,color) values (%L,%L,%L)', h1,'Y','vermelho')) || ' (ERR 23514)' || E'\n';

  insert into public.accounts (household_id, owner_profile_id, name, type, initial_balance_cents)
    values (h1, p1, 'Nubank', 'digital', 123456) returning id into a1;
  insert into public.credit_cards (household_id, owner_profile_id, payment_account_id, name, brand, limit_cents, closing_day, due_day, last4)
    values (h1, p1, a1, 'Cartao A', 'visa', 800000, 3, 10, '4821') returning id into c1;
  select count(*) into v from public.accounts;     out := out || format('A8  A ve contas: %s (1)', v) || E'\n';
  select count(*) into v from public.credit_cards; out := out || format('A9  A ve cartoes: %s (1)', v) || E'\n';
  select count(*) into v from public.accounts where initial_balance_cents = 123456;
  out := out || format('A10 centavos preservados (bigint, sem float): %s (1)', v) || E'\n';
  out := out || 'A11 conta nome duplicado:   ' || pg_temp.try(format('insert into public.accounts (household_id,owner_profile_id,name) values (%L,%L,%L)', h1,p1,'NUBANK')) || ' (ERR 23505)' || E'\n';
  out := out || 'A12 saldo inicial negativo: ' || pg_temp.try(format('insert into public.accounts (household_id,owner_profile_id,name,initial_balance_cents) values (%L,%L,%L,%s)', h1,p1,'Cheque',-50000)) || ' (ok rows=1)' || E'\n';
  out := out || 'A13 conta sem nome:         ' || pg_temp.try(format('insert into public.accounts (household_id,owner_profile_id,name) values (%L,%L,%L)', h1,p1,'  ')) || ' (ERR 23514)' || E'\n';
  out := out || 'A14 limite zero:            ' || pg_temp.try(format('insert into public.credit_cards (household_id,owner_profile_id,payment_account_id,name,limit_cents,closing_day,due_day) values (%L,%L,%L,%L,0,3,10)', h1,p1,a1,'C0')) || ' (ERR 23514)' || E'\n';
  out := out || 'A15 dia de fechamento 32:  ' || pg_temp.try(format('insert into public.credit_cards (household_id,owner_profile_id,payment_account_id,name,limit_cents,closing_day,due_day) values (%L,%L,%L,%L,1000,32,10)', h1,p1,a1,'C1')) || ' (ERR 23514)' || E'\n';
  out := out || 'A16 vencimento 0:           ' || pg_temp.try(format('insert into public.credit_cards (household_id,owner_profile_id,payment_account_id,name,limit_cents,closing_day,due_day) values (%L,%L,%L,%L,1000,3,0)', h1,p1,a1,'C2')) || ' (ERR 23514)' || E'\n';
  out := out || 'A17 last4 invalido:         ' || pg_temp.try(format('insert into public.credit_cards (household_id,owner_profile_id,payment_account_id,name,limit_cents,closing_day,due_day,last4) values (%L,%L,%L,%L,1000,3,10,%L)', h1,p1,a1,'C3','12ab')) || ' (ERR 23514)' || E'\n';
  out := out || 'A18 PAN completo no last4:  ' || pg_temp.try(format('insert into public.credit_cards (household_id,owner_profile_id,payment_account_id,name,limit_cents,closing_day,due_day,last4) values (%L,%L,%L,%L,1000,3,10,%L)', h1,p1,a1,'C4','4111111111111111')) || ' (ERR 22001/23514)' || E'\n';
  out := out || 'A19 apagar perfil com contas: ' || pg_temp.try(format('delete from public.financial_profiles where id=%L', p1)) || ' (ERR 23503)' || E'\n';
  out := out || 'A20 apagar conta usada por cartao: ' || pg_temp.try(format('delete from public.accounts where id=%L', a1)) || ' (ERR 23503)' || E'\n';
  out := out || 'A21 apagar categoria com filhos: ' || pg_temp.try(format('delete from public.categories where id=%L', moradia)) || ' (ERR 23503)' || E'\n';
  reset role;

  -- ===== usuario B (outro household) =====
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  h2 := public.bootstrap_household('Casa B','Bia',false);
  select id into p2 from public.financial_profiles where kind='individual';
  insert into public.accounts (household_id, owner_profile_id, name) values (h2, p2, 'Conta B') returning id into a2;
  out := out || E'\n--- usuario B ---\n';
  select count(*) into v from public.categories;     out := out || format('B1  B ve categorias: %s (23, so as dele)', v) || E'\n';
  select count(*) into v from public.accounts;       out := out || format('B2  B ve contas: %s (1, so a dele)', v) || E'\n';
  select count(*) into v from public.credit_cards;   out := out || format('B3  B ve cartoes: %s (0)', v) || E'\n';
  select count(*) into v from public.accounts where id=a1;   out := out || format('B4  B busca conta de A por id: %s (0)', v) || E'\n';
  select count(*) into v from public.categories where id=moradia; out := out || format('B5  B busca categoria de A por id: %s (0)', v) || E'\n';
  out := out || 'B6  B insere conta no h1:   ' || pg_temp.try(format('insert into public.accounts (household_id,owner_profile_id,name) values (%L,%L,%L)', h1,p1,'Invasao')) || ' (ERR 42501 RLS)' || E'\n';
  out := out || 'B7  B insere categoria no h1: ' || pg_temp.try(format('insert into public.categories (household_id,name) values (%L,%L)', h1,'Invasao')) || ' (ERR 42501 RLS)' || E'\n';
  out := out || 'B8  B insere cartao no h1:  ' || pg_temp.try(format('insert into public.credit_cards (household_id,owner_profile_id,payment_account_id,name,limit_cents,closing_day,due_day) values (%L,%L,%L,%L,1000,3,10)', h1,p1,a1,'Invasao')) || ' (ERR 42501 RLS)' || E'\n';
  out := out || 'B9  B altera conta de A:    ' || pg_temp.try(format('update public.accounts set name=%L where id=%L','HACK',a1)) || ' (ok rows=0)' || E'\n';
  out := out || 'B10 B altera cartao de A:   ' || pg_temp.try(format('update public.credit_cards set limit_cents=1 where id=%L',c1)) || ' (ok rows=0)' || E'\n';
  out := out || 'B11 B altera categoria de A: ' || pg_temp.try(format('update public.categories set name=%L where id=%L','HACK',moradia)) || ' (ok rows=0)' || E'\n';
  out := out || 'B12 B apaga conta de A:     ' || pg_temp.try(format('delete from public.accounts where id=%L',a1)) || ' (ok rows=0)' || E'\n';
  out := out || 'B13 B apaga cartao de A:    ' || pg_temp.try(format('delete from public.credit_cards where id=%L',c1)) || ' (ok rows=0)' || E'\n';
  out := out || 'B14 B apaga categorias de A: ' || pg_temp.try(format('delete from public.categories where household_id=%L',h1)) || ' (ok rows=0)' || E'\n';
  out := out || 'B15 B move conta p/ seu household: ' || pg_temp.try(format('update public.accounts set household_id=%L where id=%L',h2,a1)) || ' (ok rows=0)' || E'\n';
  out := out || 'B16 conta no h2 com dono de A (FK composta): ' || pg_temp.try(format('insert into public.accounts (household_id,owner_profile_id,name) values (%L,%L,%L)', h2,p1,'Cruzada')) || ' (ERR 23503)' || E'\n';
  out := out || 'B17 cartao no h2 com conta de A (FK composta): ' || pg_temp.try(format('insert into public.credit_cards (household_id,owner_profile_id,payment_account_id,name,limit_cents,closing_day,due_day) values (%L,%L,%L,%L,1000,3,10)', h2,p2,a1,'Cruzado')) || ' (ERR 23503)' || E'\n';
  out := out || 'B18 cartao no h2 com dono de A (FK composta): ' || pg_temp.try(format('insert into public.credit_cards (household_id,owner_profile_id,payment_account_id,name,limit_cents,closing_day,due_day) values (%L,%L,%L,%L,1000,3,10)', h2,p1,a2,'Cruzado2')) || ' (ERR 23503)' || E'\n';
  out := out || 'B19 categoria no h2 com pai de A: ' || pg_temp.try(format('insert into public.categories (household_id,name,parent_id) values (%L,%L,%L)', h2,'Filha',moradia)) || ' (ERR 23503)' || E'\n';
  out := out || 'B20 seed no household de A:  ' || pg_temp.try(format('select public.seed_default_categories(%L)', h1)) || ' (ERR 42501 forbidden)' || E'\n';
  out := out || 'B21 seed no proprio (ja semeado): ' || pg_temp.try(format('select public.seed_default_categories(%L)', h2)) || ' (ok rows=1; retorna 0)' || E'\n';
  reset role;

  -- ===== anon =====
  set local role anon;
  out := out || E'\n--- anon ---\n';
  out := out || 'N1  anon le categorias:    ' || pg_temp.try('select count(*) from public.categories') || ' (ERR 42501)' || E'\n';
  out := out || 'N2  anon le contas:        ' || pg_temp.try('select count(*) from public.accounts') || ' (ERR 42501)' || E'\n';
  out := out || 'N3  anon le cartoes:       ' || pg_temp.try('select count(*) from public.credit_cards') || ' (ERR 42501)' || E'\n';
  out := out || 'N4  anon seed:             ' || pg_temp.try(format('select public.seed_default_categories(%L)', h1)) || ' (ERR 42501)' || E'\n';
  reset role;

  -- ===== A: propagacao de tipo e cascata =====
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  out := out || E'\n--- A de novo ---\n';
  out := out || 'P1  muda tipo da raiz:     ' || pg_temp.try(format('update public.categories set kind=%L where id=%L','income',moradia)) || ' (ok rows=1)' || E'\n';
  select count(*) into v from public.categories where parent_id=moradia and kind='income';
  out := out || format('P2  subcategorias acompanharam o tipo: %s (4)', v) || E'\n';
  out := out || 'P3  apagar cartao:         ' || pg_temp.try(format('delete from public.credit_cards where id=%L',c1)) || ' (ok rows=1)' || E'\n';
  out := out || 'P4  apagar household com contas/categorias (cascata): ' || pg_temp.try(format('delete from public.households where id=%L',h1)) || ' (ok rows=1)' || E'\n';
  reset role;
  select count(*) into v from public.categories  where household_id=h1; out := out || format('P5  categorias restantes de A: %s (0)', v) || E'\n';
  select count(*) into v from public.accounts    where household_id=h1; out := out || format('P6  contas restantes de A: %s (0)', v) || E'\n';
  select count(*) into v from public.categories  where household_id=h2; out := out || format('P7  categorias de B intactas: %s (23)', v) || E'\n';

  raise exception E'\n==== RELATORIO (tudo sera revertido) ====\n%', out;
end $$;
