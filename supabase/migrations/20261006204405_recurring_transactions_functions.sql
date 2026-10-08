-- Recorrências / migration 2: regra de datas (ÚNICA) + sincronização idempotente + RPCs.
-- Todas as RPCs são SECURITY INVOKER: RLS e FKs compostas valem; o household é derivado do perfil/da regra
-- (nunca informado pelo cliente). Nenhuma delas apaga linhas: "remover" ocorrência futura = CANCELAR (marcada
-- canceled_by_rule, reversível pela própria regra). Pagas, passadas e canceladas pelo usuário nunca são tocadas.

-- ============ recurrence_dates: datas da agenda dentro de [p_from, p_to] ============
-- weekly ..... âncora + 7*N*n dias
-- monthly .... mês da âncora + N*n, no dia da âncora limitado ao último dia do mês (31/10 -> 30/11 -> 31/12;
--              fev: 28 ou 29). SEMPRE calculado a partir da âncora (nunca encadeado: 31/01 -> 28/02 -> 31/03).
-- yearly ..... idem com 12*N*n meses (29/02 -> 28/02 em ano comum).
-- Nunca devolve datas anteriores à âncora. Espelho de domain/recurrence.ts (occurrenceDates).
create or replace function public.recurrence_dates(
  p_frequency public.recurrence_frequency,
  p_interval integer,
  p_anchor date,
  p_from date,
  p_to date
)
returns setof date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n integer;
  v_d date;
  v_step integer;
  v_anchor_day integer;
  v_anchor_idx integer;
  v_idx integer;
  v_year integer;
  v_month integer;
  v_guard integer := 0;
begin
  if p_interval is null or p_interval < 1 then
    raise exception 'invalid_interval' using errcode = '22023';
  end if;
  if p_anchor is null or p_from is null or p_to is null or p_to < p_from then
    return;
  end if;

  if p_frequency = 'weekly' then
    v_n := greatest(0, ceil((p_from - p_anchor)::numeric / (7 * p_interval))::integer);
    loop
      v_d := p_anchor + 7 * p_interval * v_n;
      exit when v_d > p_to or v_guard > 5000;
      return next v_d;
      v_n := v_n + 1;
      v_guard := v_guard + 1;
    end loop;
  else
    v_step := p_interval * (case p_frequency when 'monthly' then 1 else 12 end);
    v_anchor_day := extract(day from p_anchor)::integer;
    v_anchor_idx := extract(year from p_anchor)::integer * 12 + extract(month from p_anchor)::integer - 1;
    v_idx := extract(year from p_from)::integer * 12 + extract(month from p_from)::integer - 1;
    v_n := greatest(0, floor((v_idx - v_anchor_idx)::numeric / v_step)::integer);
    loop
      v_year := (v_anchor_idx + v_n * v_step) / 12;
      v_month := (v_anchor_idx + v_n * v_step) % 12 + 1;
      v_d := make_date(
        v_year, v_month,
        least(v_anchor_day, extract(day from (make_date(v_year, v_month, 1) + interval '1 month' - interval '1 day'))::integer)
      );
      exit when v_d > p_to or v_guard > 5000;
      if v_d >= p_from then
        return next v_d;
      end if;
      v_n := v_n + 1;
      v_guard := v_guard + 1;
    end loop;
  end if;
end;
$$;
revoke all on function public.recurrence_dates(public.recurrence_frequency, integer, date, date, date) from public, anon;
grant execute on function public.recurrence_dates(public.recurrence_frequency, integer, date, date, date) to authenticated;

-- ============ sync de UMA regra (idempotente) ============
-- Horizonte: 12 meses à frente de "hoje" (fuso do household). Passos, todos seguros para repetir:
--  1. REATIVA ocorrências futuras que a regra cancelou e que voltaram à agenda;
--  2. CANCELA (pela regra) ocorrências futuras PLANNED fora da agenda (regra pausada, encerrada ou alterada);
--  3. CRIA as que faltam (ON CONFLICT DO NOTHING no índice único; respeita os "skips");
--  4. PROMOVE planned -> pending quando a data chegou.
-- Não toca em pagas nem em canceladas pelo usuário.
create or replace function private.sync_recurring(p_id uuid, p_today date)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r record;
  v_desired date[];
  v_to date;
  v_ids uuid[];
  v_created integer := 0;
  v_revived integer := 0;
  v_canceled integer := 0;
  v_promoted integer := 0;
begin
  select * into v_r from public.recurring_transactions r where r.id = p_id;
  if not found then
    raise exception 'recurring_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_r.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_r.is_active then
    v_to := least(coalesce(v_r.end_date, 'infinity'::date), (p_today + interval '12 months')::date);
    v_desired := array(
      select d from public.recurrence_dates(
        v_r.frequency, v_r.interval_count, v_r.start_date, greatest(v_r.start_date, v_r.materialize_from), v_to
      ) d
    );
  else
    v_desired := '{}';
  end if;

  update public.transactions t
     set status = 'planned', canceled_by_rule = false
   where t.recurring_transaction_id = p_id and t.status = 'canceled' and t.canceled_by_rule
     and t.occurrence_date > p_today and t.occurrence_date = any (v_desired);
  get diagnostics v_revived = row_count;

  update public.transactions t
     set status = 'canceled', canceled_by_rule = true
   where t.recurring_transaction_id = p_id and t.status = 'planned'
     and t.occurrence_date > p_today and t.occurrence_date <> all (v_desired);
  get diagnostics v_canceled = row_count;

  with ins as (
    insert into public.transactions
      (household_id, kind, status, description, amount_cents, date, profile_id, account_id, card_id, category_id, notes,
       recurring_transaction_id, occurrence_date)
    select v_r.household_id, v_r.kind,
           (case when d <= p_today then 'pending' else 'planned' end)::public.transaction_status,
           v_r.description, v_r.amount_cents, d, v_r.profile_id, v_r.account_id, v_r.card_id, v_r.category_id, v_r.notes,
           v_r.id, d
      from unnest(v_desired) as d
     where not exists (
       select 1 from public.recurring_skips s
        where s.recurring_transaction_id = v_r.id and s.occurrence_date = d
     )
    on conflict (recurring_transaction_id, occurrence_date) where recurring_transaction_id is not null do nothing
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from ins;
  v_created := cardinality(v_ids);
  if v_created > 0 and cardinality(v_r.tags) > 0 then
    perform private.add_tags(v_ids, v_r.household_id, v_r.tags);
  end if;

  update public.transactions t
     set status = 'pending'
   where t.recurring_transaction_id = p_id and t.status = 'planned' and t.date <= p_today;
  get diagnostics v_promoted = row_count;

  return jsonb_build_object('created', v_created, 'revived', v_revived, 'canceled', v_canceled, 'promoted', v_promoted);
end;
$$;
revoke all on function private.sync_recurring(uuid, date) from public, anon;
grant execute on function private.sync_recurring(uuid, date) to authenticated;

-- ============ sync_recurring_transactions ============
-- p_recurring_id nulo = todas as regras que o usuário pode alterar. Idempotente: pode rodar a qualquer momento.
create or replace function public.sync_recurring_transactions(p_recurring_id uuid default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_one jsonb;
  v_found boolean := false;
  v_created integer := 0;
  v_revived integer := 0;
  v_canceled integer := 0;
  v_promoted integer := 0;
begin
  for r in
    select rt.id, rt.household_id from public.recurring_transactions rt
     where (p_recurring_id is null or rt.id = p_recurring_id)
       and private.can_write(rt.household_id)
     order by rt.created_at, rt.id
  loop
    v_found := true;
    v_one := private.sync_recurring(r.id, private.household_today(r.household_id));
    v_created := v_created + (v_one ->> 'created')::integer;
    v_revived := v_revived + (v_one ->> 'revived')::integer;
    v_canceled := v_canceled + (v_one ->> 'canceled')::integer;
    v_promoted := v_promoted + (v_one ->> 'promoted')::integer;
  end loop;

  if p_recurring_id is not null and not v_found then
    raise exception 'recurring_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('created', v_created, 'revived', v_revived, 'canceled', v_canceled, 'promoted', v_promoted);
end;
$$;

-- ============ create_recurring_transaction ============
create or replace function public.create_recurring_transaction(
  p_kind public.transaction_kind,
  p_description text,
  p_amount_cents bigint,
  p_profile_id uuid,
  p_frequency public.recurrence_frequency,
  p_start_date date,
  p_category_id uuid,
  p_interval integer default 1,
  p_end_date date default null,
  p_account_id uuid default null,
  p_card_id uuid default null,
  p_notes text default null,
  p_tags text[] default '{}'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
  v_today date;
  v_id uuid;
  v_sync jsonb;
begin
  if p_kind not in ('income', 'expense', 'credit_card_purchase') then
    raise exception 'invalid_recurring_kind' using errcode = '22023';
  end if;
  if p_start_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  if p_interval is null or p_interval < 1 or p_interval > 24 then
    raise exception 'invalid_interval' using errcode = '22023';
  end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'invalid_date_range' using errcode = '22023';
  end if;

  select f.household_id into v_household from public.financial_profiles f where f.id = p_profile_id;
  if v_household is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_household)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_today := private.household_today(v_household);

  insert into public.recurring_transactions
    (household_id, kind, description, amount_cents, profile_id, account_id, card_id, category_id, notes, tags,
     frequency, interval_count, start_date, end_date, materialize_from)
  values
    (v_household, p_kind, btrim(p_description), p_amount_cents, p_profile_id, p_account_id, p_card_id, p_category_id,
     nullif(btrim(p_notes), ''), private.normalize_tags(p_tags),
     p_frequency, p_interval, p_start_date, p_end_date, greatest(p_start_date, v_today))
  returning id into v_id;

  v_sync := private.sync_recurring(v_id, v_today);
  return jsonb_build_object('id', v_id) || v_sync;
end;
$$;

-- ============ update_recurring_transaction ============
-- Altera a REGRA daqui para frente. O passado nunca é reescrito:
--   * ocorrências pagas, canceladas e passadas (data da ocorrência < hoje) ficam EXATAMENTE como estão;
--   * com p_apply_to_future (padrão), as ocorrências FUTURAS ainda NÃO pagas (planned/pending, a partir de hoje)
--     recebem os novos campos (e tags); com false, só ocorrências geradas depois usam a nova regra;
--   * mudou a agenda (frequência/intervalo/início)? as futuras planned fora da nova agenda são canceladas pela regra
--     e as novas são criadas (a geração recomeça de hoje: materialize_from).
-- p_patch aceita: description, amount_cents, profile_id, account_id, card_id, category_id, notes, frequency,
-- interval_count, start_date, end_date. (O tipo nunca muda; pausar é set_recurring_transaction_active.)
create or replace function public.update_recurring_transaction(
  p_id uuid,
  p_patch jsonb,
  p_tags text[] default null,
  p_apply_to_future boolean default true
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r record;
  v_today date;
  v_allowed text[] := array['description','amount_cents','profile_id','account_id','card_id','category_id','notes',
                            'frequency','interval_count','start_date','end_date'];
  v_schedule_changed boolean;
  v_new_start date;
  v_tx_ids uuid[] := '{}';
  v_updated integer := 0;
  v_sync jsonb;
begin
  select * into v_r from public.recurring_transactions r where r.id = p_id for update;
  if not found then
    raise exception 'recurring_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_r.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k where k <> all (v_allowed)) then
    raise exception 'invalid_patch_key' using errcode = '22023';
  end if;

  v_today := private.household_today(v_r.household_id);
  v_schedule_changed := coalesce(p_patch, '{}'::jsonb) ?| array['frequency', 'interval_count', 'start_date'];
  v_new_start := case when p_patch ? 'start_date' then (p_patch ->> 'start_date')::date else v_r.start_date end;

  update public.recurring_transactions r set
    description    = case when p_patch ? 'description' then btrim(p_patch ->> 'description') else r.description end,
    amount_cents   = case when p_patch ? 'amount_cents' then (p_patch ->> 'amount_cents')::bigint else r.amount_cents end,
    profile_id     = case when p_patch ? 'profile_id' then (p_patch ->> 'profile_id')::uuid else r.profile_id end,
    account_id     = case when p_patch ? 'account_id' then nullif(p_patch ->> 'account_id', '')::uuid else r.account_id end,
    card_id        = case when p_patch ? 'card_id' then nullif(p_patch ->> 'card_id', '')::uuid else r.card_id end,
    category_id    = case when p_patch ? 'category_id' then (p_patch ->> 'category_id')::uuid else r.category_id end,
    notes          = case when p_patch ? 'notes' then nullif(btrim(p_patch ->> 'notes'), '') else r.notes end,
    frequency      = case when p_patch ? 'frequency' then (p_patch ->> 'frequency')::public.recurrence_frequency else r.frequency end,
    interval_count = case when p_patch ? 'interval_count' then (p_patch ->> 'interval_count')::smallint else r.interval_count end,
    start_date     = v_new_start,
    end_date       = case when p_patch ? 'end_date' then nullif(p_patch ->> 'end_date', '')::date else r.end_date end,
    tags           = case when p_tags is not null then private.normalize_tags(p_tags) else r.tags end,
    materialize_from = case when v_schedule_changed then greatest(v_new_start, v_today) else r.materialize_from end
  where r.id = p_id;

  if p_apply_to_future then
    with upd as (
      update public.transactions t set
        description  = r.description,
        amount_cents = r.amount_cents,
        profile_id   = r.profile_id,
        account_id   = r.account_id,
        card_id      = r.card_id,
        category_id  = r.category_id,
        notes        = r.notes
      from public.recurring_transactions r
      where r.id = p_id and t.recurring_transaction_id = r.id
        and t.status in ('planned', 'pending') and t.occurrence_date >= v_today
      returning t.id
    )
    select coalesce(array_agg(id), '{}') into v_tx_ids from upd;
    v_updated := cardinality(v_tx_ids);
    if p_tags is not null and v_updated > 0 then
      perform private.apply_tags(v_tx_ids, v_r.household_id, p_tags);
    end if;
  end if;

  v_sync := private.sync_recurring(p_id, v_today);
  return jsonb_build_object('updated', v_updated) || v_sync;
end;
$$;

-- ============ set_recurring_transaction_active ============
-- Pausar: nada novo é gerado e as ocorrências FUTURAS ainda planned são canceladas (pela regra, reversível).
-- Pagas, pendentes, passadas e canceladas pelo usuário ficam intactas. Reativar: volta a gerar a partir de hoje
-- (sem preencher o intervalo pausado) e reativa as futuras que a pausa cancelou.
create or replace function public.set_recurring_transaction_active(p_id uuid, p_active boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_r record;
  v_today date;
begin
  select * into v_r from public.recurring_transactions r where r.id = p_id for update;
  if not found then
    raise exception 'recurring_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_r.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_today := private.household_today(v_r.household_id);

  update public.recurring_transactions r set
    is_active = p_active,
    materialize_from = case when p_active then greatest(r.materialize_from, v_today) else r.materialize_from end
  where r.id = p_id;

  return private.sync_recurring(p_id, v_today);
end;
$$;

revoke all on function public.sync_recurring_transactions(uuid) from public, anon;
revoke all on function public.create_recurring_transaction(public.transaction_kind, text, bigint, uuid, public.recurrence_frequency, date, uuid, integer, date, uuid, uuid, text, text[]) from public, anon;
revoke all on function public.update_recurring_transaction(uuid, jsonb, text[], boolean) from public, anon;
revoke all on function public.set_recurring_transaction_active(uuid, boolean) from public, anon;
grant execute on function public.sync_recurring_transactions(uuid) to authenticated;
grant execute on function public.create_recurring_transaction(public.transaction_kind, text, bigint, uuid, public.recurrence_frequency, date, uuid, integer, date, uuid, uuid, text, text[]) to authenticated;
grant execute on function public.update_recurring_transaction(uuid, jsonb, text[], boolean) to authenticated;
grant execute on function public.set_recurring_transaction_active(uuid, boolean) to authenticated;
