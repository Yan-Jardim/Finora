-- DRY-RUN da Migration 3 (rollback garantido): executa LITERALMENTE supabase/migrations/_pending_pockets_rpcs.sql
-- + testes das RPCs (pockets_rpcs_test.sql), tudo num UNICO bloco DO (uma instrucao => atomica) que termina em RAISE EXCEPTION.
-- NAO registra migration, NAO deixa funcoes/usuarios/dados. Sem DROP/TRUNCATE.
-- Como rodar: cole TUDO no SQL Editor do Supabase e execute. Resultado esperado: um ERRO cujo texto comeca com
-- ROLLBACK_PROPOSITAL, seguido do relatorio e da linha "== RESULTADO: 0 FAIL ==".
do $outer$
begin
execute $mig$
-- Cofrinhos e Objetivos / migration 3: RPCs públicas.
-- Somente ADITIVA: 9 funções novas em public. Não altera tabela, trigger, função nem dado existente.
--
-- Dependências EXATAS da migration 2 (e anteriores):
--   private.pocket_write(...)            única porta de escrita em pocket_movements (DEFINER; autoriza, trava, valida)
--   private.pocket_transfer_write(...)   transferência entre cofrinhos da mesma conta
--   private.household_today(uuid)        "hoje" no fuso do household (EXECUTE para authenticated)
--   private.can_write(uuid)              autorização de escrita (membro owner/member)
--   triggers de lastro/imutabilidade/uso (a0_lock_reserve_accounts, z_reserve_backing, d_guard_pocket_use, ...)
--   public.create_transaction(...)       despesa comum + tags (já existente)
--
-- Princípios (todas as funções):
--   * SECURITY INVOKER + search_path = '' : o RLS de quem chama vale; não há SECURITY DEFINER novo em schema exposto.
--   * NENHUMA recebe household_id: ele é DERIVADO do perfil/cofrinho/transação/objetivo (que o RLS só deixa ver a membros).
--   * "não existe" e "não é seu" dão o MESMO erro (P0002), sem vazar existência entre households.
--   * Toda escrita em pocket_movements passa por private.pocket_write (nenhuma RPC faz INSERT direto lá).
--   * EXECUTE só para authenticated; anon e PUBLIC revogados.
--
-- Ordem de locks (a mesma da migration 2): linha da transação -> contas (por id) -> cofrinhos (por id).
--   spend_from_pocket: create_transaction trava a conta (trigger a0) e depois pocket_write trava conta+cofrinho.
--   reverse_pocket_use: trava a LINHA DA TRANSAÇÃO primeiro (FOR UPDATE) e só depois chama pocket_write.

-- ============================================================================================================
-- create_pocket: cria o cofrinho (+ reserva inicial opcional). Idempotente por p_legacy_ref (importação dos antigos).
-- ============================================================================================================
create or replace function public.create_pocket(
  p_profile_id uuid,
  p_account_id uuid,
  p_name text,
  p_description text default null,
  p_icon text default 'piggy-bank',
  p_color text default '#4f46e5',
  p_initial_cents bigint default 0,
  p_date date default null,
  p_legacy_ref text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
  v_id uuid;
  v_date date;
begin
  select fp.household_id into v_household from public.financial_profiles fp where fp.id = p_profile_id;
  if v_household is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_household)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_initial_cents is null or p_initial_cents < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  v_date := coalesce(p_date, private.household_today(v_household));

  if p_legacy_ref is not null then
    insert into public.pockets (household_id, profile_id, account_id, name, description, icon, color, legacy_ref)
    values (v_household, p_profile_id, p_account_id, btrim(p_name), nullif(btrim(p_description), ''),
            coalesce(p_icon, 'piggy-bank'), coalesce(p_color, '#4f46e5'), p_legacy_ref)
    on conflict (household_id, legacy_ref) where legacy_ref is not null do nothing
    returning id into v_id;
    if v_id is null then
      -- já importado: devolve o existente e NÃO repete a reserva inicial (sem duplicar)
      select p.id into v_id from public.pockets p where p.household_id = v_household and p.legacy_ref = p_legacy_ref;
      return v_id;
    end if;
  else
    insert into public.pockets (household_id, profile_id, account_id, name, description, icon, color)
    values (v_household, p_profile_id, p_account_id, btrim(p_name), nullif(btrim(p_description), ''),
            coalesce(p_icon, 'piggy-bank'), coalesce(p_color, '#4f46e5'))
    returning id into v_id;
  end if;

  if p_initial_cents > 0 then
    perform private.pocket_write(v_id, 'reserve', p_initial_cents, v_date, 'Saldo inicial');
  end if;
  return v_id;
end;
$$;

-- ============================================================================================================
-- update_pocket: nome, descrição, ícone, cor e responsável. A conta é IMUTÁVEL; o status tem RPC própria.
-- ============================================================================================================
create or replace function public.update_pocket(p_id uuid, p_patch jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_p public.pockets;
  v_allowed text[] := array['name', 'description', 'icon', 'color', 'profile_id'];
begin
  select * into v_p from public.pockets where id = p_id;
  if not found or not (select private.can_write(v_p.household_id)) then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k where k <> all (v_allowed)) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;
  update public.pockets p set
    name        = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else p.name end,
    description = case when p_patch ? 'description' then nullif(btrim(p_patch ->> 'description'), '') else p.description end,
    icon        = case when p_patch ? 'icon' then p_patch ->> 'icon' else p.icon end,
    color       = case when p_patch ? 'color' then p_patch ->> 'color' else p.color end,
    profile_id  = case when p_patch ? 'profile_id' then (p_patch ->> 'profile_id')::uuid else p.profile_id end
  where p.id = p_id;
end;
$$;

-- ============================================================================================================
-- set_pocket_archived: arquiva (exige saldo 0: guarda da migration 2) ou reativa (exige conta ativa).
-- ============================================================================================================
create or replace function public.set_pocket_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_p public.pockets;
begin
  select * into v_p from public.pockets where id = p_id;
  if not found or not (select private.can_write(v_p.household_id)) then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  update public.pockets set status = case when p_archived then 'archived'::public.pocket_status else 'active'::public.pocket_status end
   where id = p_id;
end;
$$;

-- ============================================================================================================
-- pocket_reserve / pocket_withdraw: alocação virtual (NÃO cria despesa, receita nem transferência bancária).
-- ============================================================================================================
create or replace function public.pocket_reserve(p_pocket_id uuid, p_amount_cents bigint, p_date date default null, p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select p.household_id into v_household from public.pockets p where p.id = p_pocket_id;
  if v_household is null then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  return private.pocket_write(p_pocket_id, 'reserve', p_amount_cents, coalesce(p_date, private.household_today(v_household)), p_note);
end;
$$;

create or replace function public.pocket_withdraw(p_pocket_id uuid, p_amount_cents bigint, p_date date default null, p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select p.household_id into v_household from public.pockets p where p.id = p_pocket_id;
  if v_household is null then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  return private.pocket_write(p_pocket_id, 'withdraw', p_amount_cents, coalesce(p_date, private.household_today(v_household)), p_note);
end;
$$;

-- ============================================================================================================
-- pocket_transfer: entre cofrinhos da MESMA conta (devolve o transfer_group_id). Para outra conta: transferência real antes.
-- ============================================================================================================
create or replace function public.pocket_transfer(p_from_pocket_id uuid, p_to_pocket_id uuid, p_amount_cents bigint, p_date date default null, p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select p.household_id into v_household from public.pockets p where p.id = p_from_pocket_id;
  if v_household is null then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  return private.pocket_transfer_write(p_from_pocket_id, p_to_pocket_id, p_amount_cents, coalesce(p_date, private.household_today(v_household)), p_note);
end;
$$;

-- ============================================================================================================
-- spend_from_pocket: despesa PAGA na conta do cofrinho + uso da reserva (total ou PARCIAL), numa única transação.
--   p_amount_cents       = valor da despesa (sai inteiro do saldo bancário)
--   p_amount_from_pocket = quanto da reserva cobre (padrão = tudo; 0 < x <= p_amount_cents)
-- Se qualquer etapa falhar (categoria, saldo do cofrinho, lastro...), NADA persiste (nem a despesa).
-- ============================================================================================================
create or replace function public.spend_from_pocket(
  p_pocket_id uuid,
  p_description text,
  p_amount_cents bigint,
  p_amount_from_pocket bigint default null,
  p_date date default null,
  p_category_id uuid default null,
  p_profile_id uuid default null,
  p_notes text default null,
  p_tags text[] default '{}'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p public.pockets;
  v_today date;
  v_date date;
  v_from bigint;
  v_tx uuid;
  v_mv uuid;
begin
  select * into v_p from public.pockets where id = p_pocket_id;
  if not found or not (select private.can_write(v_p.household_id)) then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  v_from := coalesce(p_amount_from_pocket, p_amount_cents);
  if v_from <= 0 or v_from > p_amount_cents then
    raise exception 'amount_from_pocket_invalid' using errcode = '22023';
  end if;
  if p_category_id is null then
    raise exception 'category_required' using errcode = '22023';
  end if;
  v_today := private.household_today(v_p.household_id);
  v_date := coalesce(p_date, v_today);
  if v_date > v_today then
    raise exception 'future_date' using errcode = '22023';
  end if;

  -- a despesa PAGA (o trigger a0 trava a conta; o lastro é conferido no COMMIT, já com o uso da reserva abatido)
  v_tx := public.create_transaction('expense', p_description, p_amount_cents, v_date,
                                    coalesce(p_profile_id, v_p.profile_id), 'paid', v_p.account_id, null, null,
                                    p_category_id, null, v_date, p_notes, coalesce(p_tags, '{}'));
  v_mv := private.pocket_write(p_pocket_id, 'use', v_from, v_date, left(p_description, 300), v_tx);
  return jsonb_build_object('transaction_id', v_tx, 'movement_id', v_mv, 'from_pocket_cents', v_from, 'from_account_cents', p_amount_cents - v_from);
end;
$$;

-- ============================================================================================================
-- reverse_pocket_use: estorno INTEGRAL do valor efetivamente usado da reserva + cancelamento da despesa (histórico preservado).
--   * devolve ao cofrinho exatamente o que o 'use' tirou (uso parcial => estorno só dessa parte);
--   * o cancelamento devolve a despesa INTEIRA ao saldo bancário;
--   * os movimentos 'use' e 'use_reversal' e a despesa (cancelada) permanecem.
-- Trava a LINHA DA TRANSAÇÃO primeiro (ordem global de locks).
-- ============================================================================================================
create or replace function public.reverse_pocket_use(p_transaction_id uuid, p_note text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tx public.transactions;
  v_use public.pocket_movements;
  v_rev uuid;
begin
  select * into v_tx from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_tx.household_id)) then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;
  select * into v_use from public.pocket_movements where transaction_id = p_transaction_id and kind = 'use';
  if not found then
    raise exception 'no_pocket_use' using errcode = '22023';
  end if;
  if exists (select 1 from public.pocket_movements r where r.reverses_id = v_use.id) then
    raise exception 'already_reversed' using errcode = '22023';
  end if;

  v_rev := private.pocket_write(v_use.pocket_id, 'use_reversal', v_use.amount_cents, private.household_today(v_tx.household_id),
                                p_note, p_transaction_id, null, v_use.id);
  update public.transactions set status = 'canceled', paid_at = null where id = p_transaction_id;
  return v_rev;
end;
$$;

-- ============================================================================================================
-- link_goal_pocket: liga/desliga um objetivo a um cofrinho. Ligar ZERA o valor informado à mão (CHECK goals_manual_xor_pocket);
-- um cofrinho serve a um único objetivo. Cofrinho de outro household => pocket_not_found.
-- ============================================================================================================
create or replace function public.link_goal_pocket(p_goal_id uuid, p_pocket_id uuid default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_goal public.goals;
begin
  select * into v_goal from public.goals where id = p_goal_id;
  if not found or not (select private.can_write(v_goal.household_id)) then
    raise exception 'goal_not_found' using errcode = 'P0002';
  end if;
  if p_pocket_id is null then
    update public.goals set pocket_id = null where id = p_goal_id;
  else
    update public.goals set pocket_id = p_pocket_id, manual_amount_cents = 0 where id = p_goal_id;
  end if;
exception
  when unique_violation then
    raise exception 'pocket_already_linked' using errcode = 'P0001';
  when foreign_key_violation then
    raise exception 'pocket_not_found' using errcode = 'P0002';
end;
$$;

-- ============================================================================================================
-- Privilégios: só authenticated. anon e PUBLIC revogados (o default do Supabase concederia EXECUTE ao anon).
-- ============================================================================================================
revoke all on function public.create_pocket(uuid, uuid, text, text, text, text, bigint, date, text) from public, anon;
revoke all on function public.update_pocket(uuid, jsonb) from public, anon;
revoke all on function public.set_pocket_archived(uuid, boolean) from public, anon;
revoke all on function public.pocket_reserve(uuid, bigint, date, text) from public, anon;
revoke all on function public.pocket_withdraw(uuid, bigint, date, text) from public, anon;
revoke all on function public.pocket_transfer(uuid, uuid, bigint, date, text) from public, anon;
revoke all on function public.spend_from_pocket(uuid, text, bigint, bigint, date, uuid, uuid, text, text[]) from public, anon;
revoke all on function public.reverse_pocket_use(uuid, text) from public, anon;
revoke all on function public.link_goal_pocket(uuid, uuid) from public, anon;

grant execute on function public.create_pocket(uuid, uuid, text, text, text, text, bigint, date, text) to authenticated;
grant execute on function public.update_pocket(uuid, jsonb) to authenticated;
grant execute on function public.set_pocket_archived(uuid, boolean) to authenticated;
grant execute on function public.pocket_reserve(uuid, bigint, date, text) to authenticated;
grant execute on function public.pocket_withdraw(uuid, bigint, date, text) to authenticated;
grant execute on function public.pocket_transfer(uuid, uuid, bigint, date, text) to authenticated;
grant execute on function public.spend_from_pocket(uuid, text, bigint, bigint, date, uuid, uuid, text, text[]) to authenticated;
grant execute on function public.reverse_pocket_use(uuid, text) to authenticated;
grant execute on function public.link_goal_pocket(uuid, uuid) to authenticated;

$mig$;

execute $tst$
-- Teste das RPCs públicas dos cofrinhos (migration 3). Roda DEPOIS das migrations 1, 2 e 3.
-- SEM DELETE de dados do usuário (só o DELETE direto de despesa ligada, que DEVE ser bloqueado). Termina em RAISE EXCEPTION: NADA persiste.
-- Cada linha: PASS/FAIL + o que foi obtido. No fim: contagem de FAIL.

create function pg_temp.ex(q text, want text) returns text language plpgsql as $f$
begin
  execute q;
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
  return case when want = 'ok' then 'PASS ok' else 'FAIL esperava '||want||' mas executou' end;
exception when others then
  return case when want <> 'ok' and (sqlstate = want or sqlerrm like '%'||want||'%')
              then 'PASS '||sqlstate||' '||left(sqlerrm,36)
              else 'FAIL esperava '||want||' obtido '||sqlstate||' '||left(sqlerrm,60) end;
end $f$;

do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  h1 uuid; h2 uuid; p1 uuid; p2 uuid; cx uuid; cx2 uuid;
  a uuid; b uuid; inv uuid; bx uuid;
  pa uuid; pl uuid; pl2 uuid; pb uuid; pc uuid; pz uuid; pbx uuid;
  r jsonb; r2 jsonb; tx1 uuid; tx2 uuid; tx3 uuid; txz uuid; rv uuid;
  g1 uuid; g2 uuid; today date; out text := ''; v bigint; v2 bigint; v3 bigint; s text; n0 bigint; n1 bigint; st text;
  fns text[] := array['create_pocket','update_pocket','set_pocket_archived','pocket_reserve','pocket_withdraw','pocket_transfer','spend_from_pocket','reverse_pocket_use','link_goal_pocket'];
  f text; rec record; fails int;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (u1,'a@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (u2,'b@test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  -- família B (para os testes de isolamento)
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  set local role authenticated;
  h2 := public.bootstrap_household('Casa B','Beto',false);
  select id into p2 from public.financial_profiles where household_id = h2 and kind = 'individual';
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h2,p2,'Conta Beto',10000) returning id into bx;
  pbx := public.create_pocket(p2, bx, 'Pocket Beto');

  -- família A
  perform set_config('request.jwt.claims', json_build_object('sub',u1,'role','authenticated')::text, true);
  h1 := public.bootstrap_household('Casa A','Ana',false);
  select id into p1 from public.financial_profiles where household_id = h1 and kind = 'individual';
  today := private.household_today(h1);
  select id into cx from public.categories where household_id = h1 and kind in ('expense','both') limit 1;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Conta A',100000) returning id into a;
  insert into public.accounts (household_id, owner_profile_id, name, initial_balance_cents) values (h1,p1,'Conta B',50000) returning id into b;
  insert into public.accounts (household_id, owner_profile_id, name, type, initial_balance_cents) values (h1,p1,'Corretora','investment',900000) returning id into inv;

  out := out || E'== create_pocket ==\n';
  pa := public.create_pocket(p1, a, 'Viagem', 'Inglaterra', 'plane', '#112233', 30000);
  select balance_cents into v from public.v_pocket_balances where pocket_id = pa;
  select reserved_cents into v2 from public.v_account_reserves where account_id = a;
  select count(*) into n0 from public.transactions where household_id = h1;
  out := out || format('%s C1 cria cofrinho com reserva inicial: saldo=%s reservado=%s transacoes=%s (30000 / 30000 / 0)', case when v=30000 and v2=30000 and n0=0 then 'PASS' else 'FAIL' end, v, v2, n0) || E'\n';
  pl := public.create_pocket(p1, a, 'Legado', null, 'piggy-bank', '#4f46e5', 10000, null, 'legacy-1');
  pl2 := public.create_pocket(p1, a, 'Legado', null, 'piggy-bank', '#4f46e5', 10000, null, 'legacy-1');
  select count(*) into n1 from public.pocket_movements where pocket_id = pl;
  out := out || format('%s C2 importacao idempotente (legacy_ref): mesmo id=%s, movimentos=%s (true / 1)', case when pl=pl2 and n1=1 then 'PASS' else 'FAIL' end, pl=pl2, n1) || E'\n';
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L)', p1, inv, 'Inv'), 'account_not_allowed') || ' C3 conta de investimento' || E'\n';
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L)', p1, bx, 'Alheia'), 'account_not_allowed') || ' C4 conta de OUTRO household' || E'\n';
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L)', p2, a, 'x'), 'profile_not_found') || ' C5 perfil de OUTRO household' || E'\n';
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L,null,null,null,-1)', p1, a, 'x'), 'invalid_amount') || ' C6 valor inicial negativo' || E'\n';
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L,null,null,null,999999999)', p1, a, 'Estoura'), 'insufficient_free') || ' C7 reserva inicial acima do livre' || E'\n';

  out := out || E'\n== update_pocket / arquivar ==\n';
  out := out || pg_temp.ex(format('select public.update_pocket(%L, %L::jsonb)', pa, '{"name":"Viagem Inglaterra","color":"#223344"}'), 'ok') || ' U1 renomear' || E'\n';
  out := out || pg_temp.ex(format('select public.update_pocket(%L, %L::jsonb)', pa, '{"account_id":"00000000-0000-0000-0000-000000000000"}'), 'invalid_patch_key') || ' U2 conta imutavel (chave invalida)' || E'\n';
  out := out || pg_temp.ex(format('select public.set_pocket_archived(%L, true)', pa), 'pocket_has_balance') || ' U3 arquivar com saldo' || E'\n';

  out := out || E'\n== reservar / retirar / transferir ==\n';
  out := out || pg_temp.ex(format('select public.pocket_reserve(%L, 60001)', pa), 'insufficient_free') || ' R1 reservar acima do livre (livre=60000)' || E'\n';
  perform public.pocket_reserve(pa, 20000, null, 'extra');
  out := out || pg_temp.ex(format('select public.pocket_withdraw(%L, 50001)', pa), 'insufficient_pocket') || ' R2 retirar acima do reservado' || E'\n';
  pb := public.create_pocket(p1, a, 'IPVA');
  perform public.pocket_transfer(pa, pb, 10000, null, 'ajuste');
  pc := public.create_pocket(p1, b, 'Natal');
  out := out || pg_temp.ex(format('select public.pocket_transfer(%L,%L,100)', pa, pc), 'different_accounts') || ' R3 transferir entre contas diferentes' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_transfer(%L,%L,100)', pa, pa), 'same_pocket') || ' R4 mesmo cofrinho' || E'\n';
  select balance_cents into v from public.v_pocket_balances where pocket_id = pa;
  select balance_cents into v2 from public.v_pocket_balances where pocket_id = pb;
  out := out || format('%s R5 apos transferir 10000: pa=%s pb=%s (40000 / 10000)', case when v=40000 and v2=10000 then 'PASS' else 'FAIL' end, v, v2) || E'\n';

  out := out || E'\n== spend_from_pocket (total e parcial) ==\n';
  r := public.spend_from_pocket(pa, 'Mercado', 8000, null, null, cx);
  tx1 := (r ->> 'transaction_id')::uuid;
  select balance_cents into v from public.v_account_reserves where account_id = a;
  select free_cents into v2 from public.v_account_reserves where account_id = a;
  select balance_cents into v3 from public.v_pocket_balances where pocket_id = pa;
  out := out || format('%s S1 uso TOTAL 8000: saldo=%s livre=%s pa=%s (92000 / 40000 / 32000) livre nao muda', case when v=92000 and v2=40000 and v3=32000 then 'PASS' else 'FAIL' end, v, v2, v3) || E'\n';
  r2 := public.spend_from_pocket(pb, 'Padaria', 5000, 3000, null, cx);
  tx2 := (r2 ->> 'transaction_id')::uuid;
  select balance_cents into v from public.v_account_reserves where account_id = a;
  select free_cents into v2 from public.v_account_reserves where account_id = a;
  select balance_cents into v3 from public.v_pocket_balances where pocket_id = pb;
  out := out || format('%s S2 uso PARCIAL (3000 de 5000): saldo=%s livre=%s pb=%s (87000 / 38000 / 7000)', case when v=87000 and v2=38000 and v3=7000 then 'PASS' else 'FAIL' end, v, v2, v3) || E'\n';
  select count(*) into n0 from public.transactions where household_id = h1;
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,2000,5000,null,%L)', pb, 'x', cx), 'amount_from_pocket_invalid') || ' S3 reserva maior que a despesa' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,2000,0,null,%L)', pb, 'x', cx), 'amount_from_pocket_invalid') || ' S4 reserva zero' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,2000,null,null,null)', pb, 'x'), 'category_required') || ' S5 sem categoria' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,0,null,null,%L)', pb, 'x', cx), 'invalid_amount') || ' S6 valor zero' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,2000,null,%L,%L)', pb, 'x', today + 1, cx), 'future_date') || ' S7 data futura' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,20000,7001,null,%L)', pb, 'x', cx), 'insufficient_pocket') || ' S8 reserva insuficiente no cofrinho (7000)' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,200000,1000,null,%L)', pb, 'x', cx), 'reserve_shortfall') || ' S9 despesa que deixaria reserva sem lastro' || E'\n';
  select count(*) into n1 from public.transactions where household_id = h1;
  out := out || format('%s S10 atomicidade: nenhuma despesa ficou das tentativas que falharam (%s -> %s)', case when n0=n1 then 'PASS' else 'FAIL' end, n0, n1) || E'\n';
  out := out || pg_temp.ex(format('select public.update_transaction(%L, %L::jsonb)', tx1, '{"amount_cents":1}'), 'use_pocket_flow') || ' S11 editar valor da despesa ligada' || E'\n';
  out := out || pg_temp.ex(format('delete from public.transactions where id = %L', tx1), 'use_pocket_flow') || ' S12 excluir a despesa ligada' || E'\n';
  out := out || pg_temp.ex(format('select public.update_transaction(%L, %L::jsonb)', tx1, '{"description":"Mercado do mes"}'), 'ok') || ' S13 editar so a descricao' || E'\n';

  out := out || E'\n== reverse_pocket_use (estorno integral do valor efetivamente usado) ==\n';
  select free_cents into v from public.v_account_reserves where account_id = a;
  rv := public.reverse_pocket_use(tx2, 'desisti');
  select balance_cents into v2 from public.v_account_reserves where account_id = a;
  select free_cents into v3 from public.v_account_reserves where account_id = a;
  select balance_cents into n0 from public.v_pocket_balances where pocket_id = pb;
  select status::text into st from public.transactions where id = tx2;
  select count(*) into n1 from public.pocket_movements where transaction_id = tx2;
  out := out || format('%s V1 estorno do uso PARCIAL: pb=%s (10000: so os 3000 voltam) saldo=%s (92000: a despesa INTEIRA volta) livre=%s (era %s, volta a 40000) despesa=%s movimentos=%s (2)',
                       case when n0=10000 and v2=92000 and v3=40000 and st='canceled' and n1=2 then 'PASS' else 'FAIL' end, n0, v2, v3, v, st, n1) || E'\n';
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', tx2), 'already_reversed') || ' V2 estornar duas vezes' || E'\n';
  rv := public.reverse_pocket_use(tx1);
  select balance_cents into v2 from public.v_account_reserves where account_id = a;
  select balance_cents into n0 from public.v_pocket_balances where pocket_id = pa;
  out := out || format('%s V3 estorno do uso TOTAL: pa=%s (40000) saldo=%s (100000)', case when n0=40000 and v2=100000 then 'PASS' else 'FAIL' end, n0, v2) || E'\n';
  tx3 := public.create_transaction('expense','Sem reserva',1000,today,p1,'paid',a,null,null,cx);
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', tx3), 'no_pocket_use') || ' V4 despesa sem uso de reserva' || E'\n';
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', gen_random_uuid()), 'transaction_not_found') || ' V5 transacao inexistente' || E'\n';
  pz := public.create_pocket(p1, b, 'Zero', null, null, null, 5000);
  r := public.spend_from_pocket(pz, 'Zerou', 5000, null, null, cx);
  txz := (r ->> 'transaction_id')::uuid;
  perform public.set_pocket_archived(pz, true);
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', txz), 'pocket_archived') || ' V6 estornar para cofrinho arquivado (reative antes)' || E'\n';
  perform public.set_pocket_archived(pz, false);
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', txz), 'ok') || ' V7 depois de reativar, o estorno passa' || E'\n';

  out := out || E'\n== objetivos: link_goal_pocket ==\n';
  insert into public.goals (household_id, profile_id, name, target_cents, manual_amount_cents) values (h1,p1,'Meta 1',100000,5000) returning id into g1;
  insert into public.goals (household_id, profile_id, name, target_cents) values (h1,p1,'Meta 2',100000) returning id into g2;
  perform public.link_goal_pocket(g1, pa);
  select manual_amount_cents into v from public.goals where id = g1;
  out := out || format('%s G1 vincular zera o valor manual: %s (0)', case when v=0 then 'PASS' else 'FAIL' end, v) || E'\n';
  out := out || pg_temp.ex(format('select public.link_goal_pocket(%L,%L)', g2, pa), 'pocket_already_linked') || ' G2 cofrinho ja ligado a outro objetivo' || E'\n';
  out := out || pg_temp.ex(format('select public.link_goal_pocket(%L,%L)', g2, pbx), 'pocket_not_found') || ' G3 cofrinho de OUTRO household' || E'\n';
  out := out || pg_temp.ex(format('select public.link_goal_pocket(%L,null)', g1), 'ok') || ' G4 desvincular' || E'\n';

  out := out || E'\n== privilegios e contrato ==\n';
  foreach f in array fns loop
    select p.oid, p.prosecdef, p.proconfig::text cfg, pg_get_function_identity_arguments(p.oid) args,
           has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x,
           coalesce((select bool_or(g.grantee = 0) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g), false) public_x
      into rec from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname = f;
    out := out || format('%s %-20s invoker=%s search_path=%s anon=%s authenticated=%s public=%s sem_arg_household=%s',
       case when not rec.prosecdef and rec.cfg like '%search_path=%' and not rec.anon_x and rec.auth_x and not rec.public_x and rec.args not ilike '%household%' then 'PASS' else 'FAIL' end,
       f, not rec.prosecdef, rec.cfg is not null, rec.anon_x, rec.auth_x, rec.public_x, rec.args not ilike '%household%') || E'\n';
  end loop;
  out := out || pg_temp.ex(format('insert into public.pocket_movements (household_id,pocket_id,kind,amount_cents,movement_date) values (%L,%L,%L,1,%L)', h1, pa, 'reserve', today), '42501') || ' P1 escrita direta em pocket_movements' || E'\n';
  out := out || pg_temp.ex(format('select private.lock_accounts(array[%L]::uuid[])', a), '42501') || ' P2 funcao interna de lock' || E'\n';
  out := out || pg_temp.ex(format('select private.assert_account_backed(%L)', a), '42501') || ' P3 funcao interna de guarda' || E'\n';

  out := out || E'\n== isolamento (usuario B contra a familia A) ==\n';
  perform set_config('request.jwt.claims', json_build_object('sub',u2,'role','authenticated')::text, true);
  out := out || pg_temp.ex(format('select public.create_pocket(%L,%L,%L)', p1, a, 'x'), 'profile_not_found') || ' I1 create_pocket com perfil da A' || E'\n';
  out := out || pg_temp.ex(format('select public.update_pocket(%L, %L::jsonb)', pa, '{"name":"hack"}'), 'pocket_not_found') || ' I2 update_pocket' || E'\n';
  out := out || pg_temp.ex(format('select public.set_pocket_archived(%L, true)', pa), 'pocket_not_found') || ' I3 set_pocket_archived' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_reserve(%L, 100)', pa), 'pocket_not_found') || ' I4 pocket_reserve' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_withdraw(%L, 100)', pa), 'pocket_not_found') || ' I5 pocket_withdraw' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_transfer(%L,%L,100)', pa, pb), 'pocket_not_found') || ' I6 pocket_transfer' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_transfer(%L,%L,100)', pbx, pa), 'pocket_not_found') || ' I6b transferir do cofrinho B para o da A' || E'\n';
  out := out || pg_temp.ex(format('select public.spend_from_pocket(%L,%L,100,null,null,%L)', pa, 'x', cx), 'pocket_not_found') || ' I7 spend_from_pocket' || E'\n';
  out := out || pg_temp.ex(format('select public.reverse_pocket_use(%L)', tx1), 'transaction_not_found') || ' I8 reverse_pocket_use' || E'\n';
  out := out || pg_temp.ex(format('select public.link_goal_pocket(%L,%L)', g1, pa), 'goal_not_found') || ' I9 link_goal_pocket' || E'\n';
  out := out || pg_temp.ex(format('select public.pocket_reserve(%L, 1000)', pbx), 'ok') || ' I10 controle positivo: B reserva no proprio cofrinho' || E'\n';
  select count(*) into n0 from public.pocket_movements where household_id = h1 and kind = 'reserve' and movement_date = today and amount_cents = 100;
  out := out || format('%s I11 nenhuma escrita de B apareceu na familia A (%s)', case when n0=0 then 'PASS' else 'FAIL' end, n0) || E'\n';
  reset role;

  out := out || E'\n== anon nao executa nenhuma RPC de negocio ==\n';
  set local role anon;
  foreach f in array fns loop
    out := out || pg_temp.ex(format('select public.%I(%s)', f,
      case f when 'create_pocket' then format('%L,%L,%L', p1, a, 'x')
             when 'update_pocket' then format('%L,%L::jsonb', pa, '{}')
             when 'set_pocket_archived' then format('%L,true', pa)
             when 'pocket_reserve' then format('%L,100', pa)
             when 'pocket_withdraw' then format('%L,100', pa)
             when 'pocket_transfer' then format('%L,%L,100', pa, pb)
             when 'spend_from_pocket' then format('%L,%L,100', pa, 'x')
             when 'reverse_pocket_use' then format('%L', tx1)
             else format('%L,null', g1) end), '42501') || ' anon ' || f || E'\n';
  end loop;
  reset role;

  fails := (length(out) - length(replace(out, 'FAIL', ''))) / 4;
  out := out || E'\n== RESULTADO: ' || fails || E' FAIL ==\n';
  raise exception E'ROLLBACK_PROPOSITAL\n%', out;
end $$;

$tst$;
end
$outer$;
