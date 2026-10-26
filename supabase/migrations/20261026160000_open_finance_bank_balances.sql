-- Open Finance (validação) / migration 1: conexões bancárias e saldos lidos do banco.
-- Somente ADITIVA: 2 tabelas novas + 1 RPC. Não altera tabela, trigger, função nem dado existente.
--
-- Princípios:
--   * O saldo do banco é INFORMAÇÃO, nunca soma: não entra em v_account_balances, snapshot nem relatórios.
--     Fica ao lado do saldo derivado das movimentações, para comparar.
--   * Nenhuma credencial no banco: Client ID/Secret ficam em variáveis de ambiente do servidor. Aqui só fica
--     `credential_key` (qual par de variáveis usar) e o Item ID, que sozinho não dá acesso a nada.
--   * Leitura para membros; escrita com can_write. A sincronização roda no servidor COM A SESSÃO de quem pediu
--     (a service_role nunca é usada pelo app), e grava tudo numa única RPC SECURITY INVOKER.

-- ============ bank_connections ============
create table public.bank_connections (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  owner_profile_id uuid not null,
  provider         text not null default 'pluggy' check (provider in ('pluggy')),
  credential_key   text not null constraint bank_connections_credential_key_check check (credential_key ~ '^[a-z][a-z0-9_]{0,29}$'),
  item_id          text not null constraint bank_connections_item_id_check check (item_id ~ '^[A-Za-z0-9-]{1,100}$'),
  institution      text check (institution is null or char_length(institution) <= 80),
  status           text check (status is null or char_length(status) <= 40),
  last_synced_at   timestamptz,
  last_error       text check (last_error is null or char_length(last_error) <= 300),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint bank_connections_household_id_id_key unique (household_id, id),
  constraint bank_connections_item_key unique (household_id, provider, item_id),
  constraint bank_connections_owner_profile_fk foreign key (household_id, owner_profile_id)
    references public.financial_profiles (household_id, id) on delete cascade
);
comment on table public.bank_connections is 'Bancos conectados via agregador de Open Finance (Pluggy). Sem segredos: credential_key aponta para variáveis de ambiente do servidor.';

create index bank_connections_owner_idx on public.bank_connections (household_id, owner_profile_id);
create index bank_connections_created_by_idx on public.bank_connections (created_by);

create trigger set_updated_at before update on public.bank_connections
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_change before update on public.bank_connections
  for each row execute function private.prevent_tenant_change();

-- ============ bank_balances ============
create table public.bank_balances (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households (id) on delete cascade,
  connection_id          uuid not null,
  external_account_id    text not null check (char_length(external_account_id) between 1 and 100),
  name                   text not null check (char_length(name) between 1 and 120),
  type                   text not null check (type in ('BANK', 'CREDIT')),
  subtype                text check (subtype is null or char_length(subtype) <= 40),
  number                 text check (number is null or char_length(number) <= 40),
  balance_cents          bigint not null,
  credit_limit_cents     bigint,
  available_limit_cents  bigint,
  currency               char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  -- Conta do Finora para comparar (opcional). Some sozinho se a conta for excluída.
  account_id             uuid,
  synced_at              timestamptz not null default now(),
  constraint bank_balances_external_key unique (connection_id, external_account_id),
  constraint bank_balances_connection_fk foreign key (household_id, connection_id)
    references public.bank_connections (household_id, id) on delete cascade,
  constraint bank_balances_account_fk foreign key (household_id, account_id)
    references public.accounts (household_id, id) on delete set null (account_id)
);
comment on table public.bank_balances is 'Último saldo lido do banco por conta/cartão (informação; nunca entra em saldos, faturas ou relatórios).';

create index bank_balances_household_idx on public.bank_balances (household_id);
create index bank_balances_account_idx on public.bank_balances (household_id, account_id) where account_id is not null;

create trigger prevent_tenant_change before update on public.bank_balances
  for each row execute function private.prevent_tenant_change();

-- ============ RLS ============
alter table public.bank_connections enable row level security;
alter table public.bank_balances enable row level security;
revoke all on public.bank_connections, public.bank_balances from anon, authenticated;
grant select, insert, update, delete on public.bank_connections to authenticated;
grant select, insert, update, delete on public.bank_balances to authenticated;

create policy bank_connections_select on public.bank_connections
  for select to authenticated using ((select private.is_member(household_id)));
create policy bank_connections_insert on public.bank_connections
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy bank_connections_update on public.bank_connections
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));
create policy bank_connections_delete on public.bank_connections
  for delete to authenticated using ((select private.can_write(household_id)));

create policy bank_balances_select on public.bank_balances
  for select to authenticated using ((select private.is_member(household_id)));
create policy bank_balances_insert on public.bank_balances
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy bank_balances_update on public.bank_balances
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));
create policy bank_balances_delete on public.bank_balances
  for delete to authenticated using ((select private.can_write(household_id)));

-- ============================================================================================================
-- record_bank_sync: grava o resultado de UMA sincronização de uma conexão, atomicamente.
--   * Sucesso (p_error nulo): atualiza status/instituição/hora e substitui os saldos da conexão pelos de p_accounts
--     (upsert por conta externa; o que sumiu do banco é removido). O vínculo account_id é preservado.
--   * Falha (p_error preenchido): só registra status e erro; os últimos saldos bons continuam visíveis.
-- p_accounts: [{external_account_id, name, type, subtype, number, balance_cents, credit_limit_cents,
--               available_limit_cents, currency}]
-- ============================================================================================================
create or replace function public.record_bank_sync(
  p_connection_id uuid,
  p_status text,
  p_institution text default null,
  p_error text default null,
  p_accounts jsonb default '[]'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select c.household_id into v_household from public.bank_connections c where c.id = p_connection_id for update;
  if v_household is null then
    raise exception 'bank_connection_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_household)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' then
    raise exception 'invalid_bank_accounts' using errcode = '22023';
  end if;

  update public.bank_connections c
     set status = left(p_status, 40),
         institution = coalesce(left(nullif(btrim(p_institution), ''), 80), c.institution),
         last_error = left(p_error, 300),
         last_synced_at = case when p_error is null then now() else c.last_synced_at end
   where c.id = p_connection_id;

  if p_error is not null then
    return;
  end if;

  insert into public.bank_balances as b (
    household_id, connection_id, external_account_id, name, type, subtype, number,
    balance_cents, credit_limit_cents, available_limit_cents, currency, synced_at
  )
  select v_household, p_connection_id, a.external_account_id, a.name, a.type, a.subtype, a.number,
         a.balance_cents, a.credit_limit_cents, a.available_limit_cents, coalesce(a.currency, 'BRL'), now()
    from jsonb_to_recordset(p_accounts) as a(
      external_account_id text, name text, type text, subtype text, number text,
      balance_cents bigint, credit_limit_cents bigint, available_limit_cents bigint, currency text
    )
  on conflict (connection_id, external_account_id) do update
     set name = excluded.name,
         type = excluded.type,
         subtype = excluded.subtype,
         number = excluded.number,
         balance_cents = excluded.balance_cents,
         credit_limit_cents = excluded.credit_limit_cents,
         available_limit_cents = excluded.available_limit_cents,
         currency = excluded.currency,
         synced_at = excluded.synced_at;

  delete from public.bank_balances b
   where b.connection_id = p_connection_id
     and not exists (
       select 1 from jsonb_to_recordset(p_accounts) as a(external_account_id text)
        where a.external_account_id = b.external_account_id
     );
end;
$$;

revoke all on function public.record_bank_sync(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.record_bank_sync(uuid, text, text, text, jsonb) to authenticated;
