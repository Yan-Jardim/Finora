-- Teste de "excluir ocorrência gerada = pular" e de exclusão em cascata do household com recorrências.
-- Contém DELETE direto: a ferramenta do MCP recusa; rode no SQL Editor do Supabase. Reexecutável (termina em rollback).

create function pg_temp.try(q text) returns text language plpgsql as $f$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok rows='||n;
exception when others then return 'ERR '||sqlstate||' '||left(sqlerrm,80); end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); h1 uuid; p1 uuid; a1 uuid; cat_exp uuid; today date; r jsonb; rid uuid; tx uuid; od date;
  out text := ''; v bigint; v2 bigint;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  set local role authenticated;
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where kind='individual';
  select id into cat_exp from public.categories where name='Moradia' and parent_id is null;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Nubank',100000) returning id into a1;
  today := private.household_today(h1);

  r := public.create_recurring_transaction('expense','Internet',12000,p1,'monthly',today,cat_exp,1,null,a1);
  rid := (r->>'id')::uuid;
  select id, occurrence_date into tx, od from public.transactions where recurring_transaction_id = rid and occurrence_date > today order by occurrence_date limit 1;

  delete from public.transactions where id = tx;
  select count(*) into v from public.recurring_skips where recurring_transaction_id = rid and occurrence_date = od;
  out := out || format('K1  excluir a ocorrencia registra o skip: %s (1)', v) || E'\n';
  perform public.sync_recurring_transactions(rid);
  select count(*) into v from public.transactions where recurring_transaction_id = rid and occurrence_date = od;
  select count(*) into v2 from public.transactions where recurring_transaction_id = rid;
  out := out || format('K2  sync NAO recria a pulada: %s (0); total %s (12)', v, v2) || E'\n';
  perform public.update_recurring_transaction(rid, '{"amount_cents":13000}');
  select count(*) into v from public.transactions where recurring_transaction_id = rid and occurrence_date = od;
  out := out || format('K3  editar a regra tambem nao recria: %s (0)', v) || E'\n';
  perform public.set_recurring_transaction_active(rid, false);
  perform public.set_recurring_transaction_active(rid, true);
  select count(*) into v from public.transactions where recurring_transaction_id = rid and occurrence_date = od;
  out := out || format('K4  pausar/reativar nao recria: %s (0)', v) || E'\n';
  out := out || 'K5  cliente nao escreve skips: ' || pg_temp.try(format('insert into public.recurring_skips (household_id, recurring_transaction_id, occurrence_date) values (%L,%L,%L)', h1, rid, today + 1)) || ' (ERR 42501)' || E'\n';
  out := out || 'K6  vinculo imutavel: ' || pg_temp.try(format('update public.transactions set occurrence_date = occurrence_date + 1 where recurring_transaction_id = %L', rid)) || ' (ERR P0001 recurrence_link_immutable)' || E'\n';
  out := out || 'K7  regra nao e excluivel pelo cliente: ' || pg_temp.try(format('delete from public.recurring_transactions where id = %L', rid)) || ' (ERR 42501)' || E'\n';

  -- cascata: o dono apaga o household inteiro (regras, skips e ocorrencias vao juntos, sem erro)
  out := out || 'K8  owner apaga household com recorrencias: ' || pg_temp.try(format('delete from public.households where id = %L', h1)) || ' (ok rows=1)' || E'\n';
  reset role;
  select count(*) into v from public.recurring_transactions where household_id = h1;
  select count(*) into v2 from public.recurring_skips where household_id = h1;
  out := out || format('K9  restos: regras=%s skips=%s (0 / 0)', v, v2) || E'\n';
  select count(*) into v from public.transactions where household_id = h1;
  out := out || format('K10 ocorrencias restantes: %s (0)', v) || E'\n';

  raise exception E'\n==== RELATORIO SKIP (tudo sera revertido) ====\n%', out;
end $$;
