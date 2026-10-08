-- Teste de dívidas COM DELETE direto (a ferramenta do MCP recusa DELETE): rode no SQL Editor. Termina em rollback.
create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok rows='||n;
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,80); end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); h1 uuid; p1 uuid; a1 uuid; today date; d uuid; pay uuid; pay2 uuid;
  out text := ''; v bigint; s text;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where kind='individual';
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Nubank',1000000) returning id into a1;
  today := private.household_today(h1);

  d := public.create_debt('Familiar', 150000, 150000, p1);
  pay := public.pay_debt(d, a1, 50000, today);
  pay2 := public.pay_debt(d, a1, 30000, today);

  delete from public.transactions where id = pay;
  select paid_cents, remaining_cents into v, s from public.v_debt_summary where debt_id = d;
  out := out || format('D1  excluir um pagamento reabre o saldo: pago=%s (30000)', v) || E'\n';
  select balance_cents into v from public.v_account_balances where account_id = a1;
  out := out || format('D2  o valor volta para a conta: %s (970000)', v) || E'\n';

  perform public.settle_debt(d, a1, 100000, today);
  out := out || 'D3  excluir pagamento de divida QUITADA: ' || pg_temp.try(format('delete from public.transactions where id = %L', pay2)) || ' (ERR P0001 debt_settled_locked)' || E'\n';
  perform public.reopen_debt(d);
  out := out || 'D4  apos reabrir, a exclusao volta a ser possivel: ' || pg_temp.try(format('delete from public.transactions where id = %L', pay2)) || ' (ok rows=1)' || E'\n';
  out := out || 'D5  cliente nao exclui divida: ' || pg_temp.try(format('delete from public.debts where id = %L', d)) || ' (ERR 42501)' || E'\n';

  perform public.settle_debt(d, a1, 100000, today);
  out := out || 'D6  owner apaga o household com divida QUITADA e pagamentos (cascata nao pode ser bloqueada pelo guard): ' || pg_temp.try(format('delete from public.households where id = %L', h1)) || ' (ok rows=1)' || E'\n';
  reset role;
  select count(*) into v from public.debts where household_id = h1;
  out := out || format('D7  dividas restantes: %s (0)', v) || E'\n';
  select count(*) into v from public.transactions where household_id = h1;
  out := out || format('D8  transacoes restantes: %s (0)', v) || E'\n';

  raise exception E'\n==== RELATORIO DIVIDAS (DELETE) (tudo sera revertido) ====\n%', out;
end $$;
