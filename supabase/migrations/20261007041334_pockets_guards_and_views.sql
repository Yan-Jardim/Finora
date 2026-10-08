-- Cofrinhos e Objetivos / migration 2: funções, views, trava de contas, guardas de lastro e de histórico.
-- Aditiva: CREATE de funções/views/triggers NOVOS e um CREATE OR REPLACE de private.validate_pocket (criada na migration 1;
-- só acrescenta a regra "arquivar exige saldo 0"). Não altera tabela existente, dado nem função existente das fases anteriores.
-- Os triggers novos em transactions/accounts são ADITIVOS (nomes novos) e não substituem nenhum trigger atual.
--
-- ORDEM GLOBAL DE LOCKS (todo caminho respeita; evita deadlock):
--   linhas já travadas pelos fluxos existentes (debts, card_invoices, recurring) -> linha da transação (UPDATE/DELETE)
--   -> accounts (em ordem de id) -> pockets (em ordem de id).
-- Os locks de conta/cofrinho usam FOR NO KEY UPDATE: serializam quem altera saldo/reserva, mas NÃO bloqueiam as checagens de
-- FK (FOR KEY SHARE) de lançamentos não pagos nem de outras tabelas.

-- ============================================================================================================
-- 1) Funções derivadas (INVOKER: o RLS de quem consulta vale; nos triggers DEFINER enxergam tudo, como deve ser)
-- ============================================================================================================
create or replace function private.pocket_balance(p_pocket_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when m.kind in ('reserve', 'transfer_in', 'use_reversal') then m.amount_cents else -m.amount_cents end), 0)::bigint
  from public.pocket_movements m
  where m.pocket_id = p_pocket_id;
$$;

create or replace function private.account_reserved(p_account_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when m.kind in ('reserve', 'transfer_in', 'use_reversal') then m.amount_cents else -m.amount_cents end), 0)::bigint
  from public.pocket_movements m
  join public.pockets p on p.household_id = m.household_id and p.id = m.pocket_id
  where p.account_id = p_account_id;
$$;

-- Efeito de uma transação no saldo de uma conta: MESMA regra da view v_account_balances.
create or replace function private.tx_effect(t public.transactions, a uuid)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when t.status <> 'paid' then 0::bigint else
           (case when t.account_id = a and t.kind <> 'credit_card_purchase'
                 then (case when t.kind = 'income' then t.amount_cents else -t.amount_cents end) else 0 end)
         + (case when t.to_account_id = a then t.amount_cents else 0 end)
         end;
$$;

revoke all on function private.pocket_balance(uuid), private.account_reserved(uuid), private.tx_effect(public.transactions, uuid) from public, anon;
grant execute on function private.pocket_balance(uuid), private.account_reserved(uuid), private.tx_effect(public.transactions, uuid) to authenticated;

-- ============================================================================================================
-- 2) Views derivadas (security_invoker = true, como as demais)
-- ============================================================================================================
create view public.v_pocket_balances with (security_invoker = true) as
select p.id as pocket_id, p.household_id, p.account_id, p.profile_id, p.status,
       private.pocket_balance(p.id) as balance_cents
from public.pockets p;
comment on view public.v_pocket_balances is 'Saldo reservado por cofrinho, derivado do histórico (nunca gravado).';

create view public.v_account_reserves with (security_invoker = true) as
select b.account_id, b.household_id, b.balance_cents,
       private.account_reserved(b.account_id) as reserved_cents,
       (b.balance_cents - private.account_reserved(b.account_id))::bigint as free_cents
from public.v_account_balances b;
comment on view public.v_account_reserves is 'Saldo bancário, reservado em cofrinhos e livre (saldo - reservado) por conta. Derivado.';

revoke all on public.v_pocket_balances, public.v_account_reserves from public, anon, authenticated;
grant select on public.v_pocket_balances, public.v_account_reserves to authenticated;

-- ============================================================================================================
-- 3) Travas (DEFINER, NUNCA expostas: sem EXECUTE para anon/authenticated; só triggers e funções DEFINER as chamam)
-- ============================================================================================================
create or replace function private.lock_accounts(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  for v in select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null order by x loop
    perform 1 from public.accounts a where a.id = v for no key update;
  end loop;
end;
$$;

create or replace function private.lock_pockets(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  for v in select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null order by x loop
    perform 1 from public.pockets p where p.id = v for no key update;
  end loop;
end;
$$;
revoke all on function private.lock_accounts(uuid[]), private.lock_pockets(uuid[]) from public, anon, authenticated;

-- Trava as contas que a escrita pode afetar (linha ANTIGA e NOVA, só se pagas: é o que move saldo) ANTES de escrever.
-- 'a0_' dispara antes de todos os triggers atuais de transactions (a_guard..., b_validate..., c_assign..., d_...).
create or replace function private.lock_reserve_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := '{}';
begin
  if tg_op <> 'INSERT' and old.status = 'paid' then
    v_ids := v_ids || array[old.account_id, old.to_account_id];
  end if;
  if tg_op <> 'DELETE' and new.status = 'paid' then
    v_ids := v_ids || array[new.account_id, new.to_account_id];
  end if;
  if cardinality(v_ids) > 0 then
    perform private.lock_accounts(v_ids);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.lock_reserve_accounts() from public, anon, authenticated;
create trigger a0_lock_reserve_accounts before insert or update or delete on public.transactions
  for each row execute function private.lock_reserve_accounts();

-- ============================================================================================================
-- 4) Guarda de lastro: reservado > 0  =>  saldo >= reservado.  (conta SEM reserva nunca é verificada)
-- ============================================================================================================
create or replace function private.assert_account_backed(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reserved bigint;
  v_balance bigint;
begin
  v_reserved := private.account_reserved(p_account_id);
  if v_reserved <= 0 then
    return;                                         -- sem reserva: saldo negativo continua permitido, como antes dos cofrinhos
  end if;
  select b.balance_cents into v_balance from public.v_account_balances b where b.account_id = p_account_id;
  if v_balance is null then
    return;                                         -- conta já removida (cascata do household)
  end if;
  if v_balance < v_reserved then
    raise exception 'reserve_shortfall' using errcode = 'P0001',
      detail = format('account_id=%s;shortfall_cents=%s;reserved_cents=%s;balance_cents=%s',
                      p_account_id, v_reserved - v_balance, v_reserved, v_balance);
  end if;
end;
$$;
revoke all on function private.assert_account_backed(uuid) from public, anon, authenticated;

-- transactions: só confere contas cuja FOLGA (saldo - reservado) DIMINUIU nesta operação.
create or replace function private.check_reserve_backing_tx()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := '{}';
  v_acc uuid;
  v_delta bigint;
begin
  if tg_op <> 'INSERT' and old.status = 'paid' then
    v_ids := v_ids || array[old.account_id, old.to_account_id];
  end if;
  if tg_op <> 'DELETE' and new.status = 'paid' then
    v_ids := v_ids || array[new.account_id, new.to_account_id];
  end if;
  if cardinality(v_ids) = 0 then
    return null;                                    -- nada pago: não move saldo
  end if;
  foreach v_acc in array (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(v_ids) x where x is not null) loop
    v_delta := (case when tg_op = 'DELETE' then 0 else private.tx_effect(new, v_acc) end)
             - (case when tg_op = 'INSERT' then 0 else private.tx_effect(old, v_acc) end);
    if v_delta < 0 then
      perform private.assert_account_backed(v_acc);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.check_reserve_backing_tx() from public, anon, authenticated;
create constraint trigger z_reserve_backing after insert or update or delete on public.transactions
  deferrable initially deferred for each row execute function private.check_reserve_backing_tx();

-- accounts: saldo inicial menor; desativar ou virar investimento com reserva.
create or replace function private.check_reserve_backing_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if ((old.is_active and not new.is_active) or (new.type = 'investment' and old.type <> 'investment'))
     and private.account_reserved(new.id) > 0 then
    raise exception 'account_has_reserve' using errcode = 'P0001', detail = format('account_id=%s', new.id);
  end if;
  if new.initial_balance_cents < old.initial_balance_cents then
    perform private.assert_account_backed(new.id);
  end if;
  return null;
end;
$$;
revoke all on function private.check_reserve_backing_account() from public, anon, authenticated;
create constraint trigger z_reserve_backing after update of initial_balance_cents, is_active, type on public.accounts
  deferrable initially deferred for each row execute function private.check_reserve_backing_account();

-- pocket_movements: reservar / transferir para dentro / estornar uso aumentam o reservado.
create or replace function private.check_reserve_backing_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
begin
  if new.kind in ('reserve', 'transfer_in', 'use_reversal') then
    select p.account_id into v_account from public.pockets p where p.household_id = new.household_id and p.id = new.pocket_id;
    if v_account is not null then
      perform private.assert_account_backed(v_account);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.check_reserve_backing_movement() from public, anon, authenticated;
create constraint trigger z_reserve_backing after insert on public.pocket_movements
  deferrable initially deferred for each row execute function private.check_reserve_backing_movement();

-- ============================================================================================================
-- 5) Invariantes dos movimentos
-- ============================================================================================================
-- 5a) BEFORE INSERT: valida e CARIMBA autor/instante (o cliente não escolhe).
create or replace function private.validate_pocket_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.pockets;
  t public.transactions;
  o public.pocket_movements;
begin
  select * into p from public.pockets where household_id = new.household_id and id = new.pocket_id;
  if not found then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  if p.status = 'archived' then
    raise exception 'pocket_archived' using errcode = 'P0001';
  end if;
  if new.movement_date > private.household_today(new.household_id) then
    raise exception 'future_date' using errcode = '22023';
  end if;

  if new.kind = 'use' then
    select * into t from public.transactions where household_id = new.household_id and id = new.transaction_id;
    if not found or t.kind <> 'expense' or t.status <> 'paid'
       or t.account_id is distinct from p.account_id or new.amount_cents > t.amount_cents then
      raise exception 'use_invalid_expense' using errcode = '22023';
    end if;
  elsif new.kind = 'use_reversal' then
    select * into o from public.pocket_movements where household_id = new.household_id and id = new.reverses_id;
    if not found or o.kind <> 'use' or o.pocket_id <> new.pocket_id or o.transaction_id <> new.transaction_id
       or o.amount_cents <> new.amount_cents then
      raise exception 'reversal_invalid' using errcode = '22023';
    end if;
  end if;

  new.created_by := (select auth.uid());
  new.created_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.validate_pocket_movement() from public, anon, authenticated;
create trigger b_validate before insert on public.pocket_movements
  for each row execute function private.validate_pocket_movement();

-- 5b) Imutabilidade: nenhum UPDATE/DELETE/TRUNCATE (inclusive para papéis privilegiados), exceto a cascata do household.
create or replace function private.pocket_history_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.households h where h.id = old.household_id) then
    return old;                                     -- exclusão do household inteiro
  end if;
  raise exception 'pocket_history_immutable' using errcode = 'P0001';
end;
$$;
revoke all on function private.pocket_history_immutable() from public, anon, authenticated;
create trigger a_immutable before update or delete on public.pocket_movements
  for each row execute function private.pocket_history_immutable();
create trigger a_no_truncate before truncate on public.pocket_movements
  for each statement execute function private.pocket_history_immutable();

-- 5c) Transferência: exatamente um transfer_out e um transfer_in (mesmo valor, data, conta, household; cofrinhos diferentes).
create or replace function private.check_transfer_pair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select count(*) filter (where m.kind = 'transfer_out') as outs,
         count(*) filter (where m.kind = 'transfer_in')  as ins,
         count(distinct m.amount_cents)   as amounts,
         count(distinct m.movement_date)  as dates,
         count(distinct m.pocket_id)      as pockets,
         count(distinct m.household_id)   as households,
         count(distinct p.account_id)     as accounts
    into v
    from public.pocket_movements m
    join public.pockets p on p.household_id = m.household_id and p.id = m.pocket_id
   where m.transfer_group_id = new.transfer_group_id;
  if v.outs <> 1 or v.ins <> 1 or v.amounts <> 1 or v.dates <> 1 or v.pockets <> 2 or v.households <> 1 or v.accounts <> 1 then
    raise exception 'transfer_unbalanced' using errcode = 'P0001', detail = format('transfer_group_id=%s', new.transfer_group_id);
  end if;
  return null;
end;
$$;
revoke all on function private.check_transfer_pair() from public, anon, authenticated;
create constraint trigger z_transfer_pair after insert on public.pocket_movements
  deferrable initially deferred for each row when (new.transfer_group_id is not null)
  execute function private.check_transfer_pair();

-- 5d) Saldo do cofrinho nunca negativo (retirada/transferência/uso acima do reservado falha no COMMIT).
create or replace function private.check_pocket_nonneg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  v_balance := private.pocket_balance(new.pocket_id);
  if v_balance < 0 then
    raise exception 'insufficient_pocket' using errcode = 'P0001',
      detail = format('pocket_id=%s;balance_cents=%s;shortfall_cents=%s', new.pocket_id, v_balance + new.amount_cents, -v_balance);
  end if;
  return null;
end;
$$;
revoke all on function private.check_pocket_nonneg() from public, anon, authenticated;
create constraint trigger z_pocket_nonneg after insert on public.pocket_movements
  deferrable initially deferred for each row when (new.kind in ('withdraw', 'transfer_out', 'use'))
  execute function private.check_pocket_nonneg();

-- 5e) Uso x despesa: 'use' não estornado => despesa paga, da conta do cofrinho, valor coberto; estornado => despesa cancelada.
create or replace function private.assert_use_consistent(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.pocket_movements;
  t public.transactions;
  p public.pockets;
  v_reversed boolean;
begin
  select * into m from public.pocket_movements where transaction_id = p_transaction_id and kind = 'use';
  if not found then
    return;
  end if;
  select * into t from public.transactions where id = p_transaction_id;
  if not found then
    return;                                         -- cascata do household
  end if;
  select exists (select 1 from public.pocket_movements r where r.reverses_id = m.id) into v_reversed;
  select * into p from public.pockets where household_id = m.household_id and id = m.pocket_id;
  if v_reversed then
    if t.status <> 'canceled' then
      raise exception 'use_inconsistent' using errcode = 'P0001', detail = 'reversed_but_expense_not_canceled';
    end if;
  elsif t.kind <> 'expense' or t.status <> 'paid' or t.account_id is distinct from p.account_id or t.amount_cents < m.amount_cents then
    raise exception 'use_inconsistent' using errcode = 'P0001', detail = 'use_without_valid_paid_expense';
  end if;
end;
$$;
revoke all on function private.assert_use_consistent(uuid) from public, anon, authenticated;

create or replace function private.check_use_consistency_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_use_consistent(new.transaction_id);
  return null;
end;
$$;
create or replace function private.check_use_consistency_tx()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_use_consistent(new.id);
  return null;
end;
$$;
revoke all on function private.check_use_consistency_movement(), private.check_use_consistency_tx() from public, anon, authenticated;
create constraint trigger z_use_consistency after insert on public.pocket_movements
  deferrable initially deferred for each row when (new.kind in ('use', 'use_reversal'))
  execute function private.check_use_consistency_movement();
create constraint trigger z_use_consistency after update of status, amount_cents, account_id, kind on public.transactions
  deferrable initially deferred for each row execute function private.check_use_consistency_tx();

-- ============================================================================================================
-- 6) Despesa paga com reserva: não se exclui nem se altera (só estorna). Descrição, categoria, tags e notas seguem editáveis.
-- ============================================================================================================
create or replace function private.guard_pocket_use()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.pocket_movements;
begin
  select * into m from public.pocket_movements where transaction_id = old.id and kind = 'use';
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.households h where h.id = old.household_id) then
      return old;                                   -- exclusão do household inteiro
    end if;
    raise exception 'use_pocket_flow' using errcode = '22023', hint = 'reverse_pocket_use';
  end if;
  if (new.amount_cents, new.date, new.status, new.paid_at, new.account_id, new.to_account_id, new.kind)
     is distinct from (old.amount_cents, old.date, old.status, old.paid_at, old.account_id, old.to_account_id, old.kind) then
    -- única alteração permitida: paga -> cancelada, DEPOIS de existir o estorno (o resto continua igual)
    if old.status = 'paid' and new.status = 'canceled' and new.paid_at is null
       and (new.amount_cents, new.date, new.account_id, new.to_account_id, new.kind)
         is not distinct from (old.amount_cents, old.date, old.account_id, old.to_account_id, old.kind)
       and exists (select 1 from public.pocket_movements r where r.reverses_id = m.id) then
      return new;
    end if;
    raise exception 'use_pocket_flow' using errcode = '22023', hint = 'reverse_pocket_use';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_pocket_use() from public, anon, authenticated;
create trigger d_guard_pocket_use before update or delete on public.transactions
  for each row execute function private.guard_pocket_use();

-- ============================================================================================================
-- 7) Cofrinho: arquivar exige saldo 0 (acrescenta a regra à função da migration 1; o resto é idêntico)
-- ============================================================================================================
create or replace function private.validate_pocket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account record;
  v_balance bigint;
begin
  if not (select private.can_write(new.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.account_id <> old.account_id then
    raise exception 'pocket_account_immutable' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and old.status = 'active' and new.status = 'archived' then
    v_balance := private.pocket_balance(new.id);
    if v_balance <> 0 then
      raise exception 'pocket_has_balance' using errcode = 'P0001', detail = format('pocket_id=%s;balance_cents=%s', new.id, v_balance);
    end if;
  end if;

  if tg_op = 'INSERT' or (old.status = 'archived' and new.status = 'active') then
    select a.type, a.is_active into v_account
      from public.accounts a where a.household_id = new.household_id and a.id = new.account_id;
    if not found or not v_account.is_active or v_account.type = 'investment' then
      raise exception 'account_not_allowed' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================================================
-- 8) Única porta de escrita nos movimentos (DEFINER). Autoriza, trava, pré-confere (mensagens amigáveis) e insere;
--    os triggers acima validam de novo. EXECUTE só para authenticated (nunca anon/public). O schema private não é exposto pela API.
-- ============================================================================================================
create or replace function private.pocket_write(
  p_pocket_id uuid,
  p_kind public.pocket_movement_kind,
  p_amount_cents bigint,
  p_date date,
  p_note text default null,
  p_transaction_id uuid default null,
  p_transfer_group_id uuid default null,
  p_reverses_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.pockets;
  v_id uuid;
  v_balance bigint;
  v_free bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- DEFINER ignora o RLS: a autorização é EXPLÍCITA; "não existe" e "não é seu" dão o mesmo erro (sem vazar existência).
  select * into v_p from public.pockets where id = p_pocket_id;
  if not found or not (select private.can_write(v_p.household_id)) then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  perform private.lock_accounts(array[v_p.account_id]);   -- ordem global: conta ...
  perform private.lock_pockets(array[p_pocket_id]);       -- ... depois cofrinho
  select * into v_p from public.pockets where id = p_pocket_id;   -- relê após a trava (READ COMMITTED)
  if v_p.status = 'archived' then
    raise exception 'pocket_archived' using errcode = 'P0001';
  end if;

  if p_kind = 'reserve' then
    select b.balance_cents - private.account_reserved(v_p.account_id) into v_free
      from public.v_account_balances b where b.account_id = v_p.account_id;
    if p_amount_cents > coalesce(v_free, 0) then
      raise exception 'insufficient_free' using errcode = 'P0001',
        detail = format('account_id=%s;free_cents=%s;requested_cents=%s;shortfall_cents=%s',
                        v_p.account_id, coalesce(v_free, 0), p_amount_cents, p_amount_cents - coalesce(v_free, 0));
    end if;
  elsif p_kind in ('withdraw', 'transfer_out', 'use') then
    v_balance := private.pocket_balance(p_pocket_id);
    if v_balance < p_amount_cents then
      raise exception 'insufficient_pocket' using errcode = 'P0001',
        detail = format('pocket_id=%s;balance_cents=%s;requested_cents=%s;shortfall_cents=%s',
                        p_pocket_id, v_balance, p_amount_cents, p_amount_cents - v_balance);
    end if;
  end if;

  insert into public.pocket_movements
    (household_id, pocket_id, kind, amount_cents, movement_date, note, transaction_id, transfer_group_id, reverses_id)
  values
    (v_p.household_id, p_pocket_id, p_kind, p_amount_cents, p_date, nullif(btrim(p_note), ''), p_transaction_id, p_transfer_group_id, p_reverses_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Transferência entre cofrinhos da MESMA conta: trava os dois cofrinhos EM ORDEM de id antes de escrever (A->B e B->A não se bloqueiam).
create or replace function private.pocket_transfer_write(
  p_from_pocket_id uuid,
  p_to_pocket_id uuid,
  p_amount_cents bigint,
  p_date date,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.pockets;
  v_to public.pockets;
  v_group uuid := gen_random_uuid();
begin
  if (select auth.uid()) is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_from from public.pockets where id = p_from_pocket_id;
  select * into v_to   from public.pockets where id = p_to_pocket_id;
  if v_from.id is null or v_to.id is null
     or not (select private.can_write(v_from.household_id)) or v_from.household_id <> v_to.household_id then
    raise exception 'pocket_not_found' using errcode = 'P0002';
  end if;
  if v_from.id = v_to.id then
    raise exception 'same_pocket' using errcode = '22023';
  end if;
  if v_from.account_id <> v_to.account_id then
    raise exception 'different_accounts' using errcode = 'P0001';
  end if;

  perform private.lock_accounts(array[v_from.account_id]);
  perform private.lock_pockets(array[p_from_pocket_id, p_to_pocket_id]);   -- ordenado por id

  perform private.pocket_write(p_from_pocket_id, 'transfer_out', p_amount_cents, p_date, p_note, null, v_group, null);
  perform private.pocket_write(p_to_pocket_id,   'transfer_in',  p_amount_cents, p_date, p_note, null, v_group, null);
  return v_group;
end;
$$;

revoke all on function private.pocket_write(uuid, public.pocket_movement_kind, bigint, date, text, uuid, uuid, uuid) from public, anon;
revoke all on function private.pocket_transfer_write(uuid, uuid, bigint, date, text) from public, anon;
grant execute on function private.pocket_write(uuid, public.pocket_movement_kind, bigint, date, text, uuid, uuid, uuid) to authenticated;
grant execute on function private.pocket_transfer_write(uuid, uuid, bigint, date, text) to authenticated;
