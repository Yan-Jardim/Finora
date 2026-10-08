-- Cofrinhos e Objetivos / migration 1: tabelas, enums, privilégios e RLS.
-- Somente ADITIVA (CREATE). Não altera nenhuma tabela, função, trigger ou dado existente.
-- Depende apenas do que já existe: households, financial_profiles, accounts, transactions, auth.users,
-- private.set_updated_at, private.prevent_tenant_change, private.is_member, private.can_write.
--
-- Modelo:
--   pockets           cofrinho (cadastro; NUNCA guarda saldo — o saldo é a soma do histórico)
--   pocket_movements  histórico append-only (imutável). Esta migration NÃO dá nenhum privilégio de escrita a ninguém:
--                     a única porta de escrita (private.pocket_write) e as guardas chegam nas migrations 2 e 3.
--   goals             objetivo financeiro (vinculado a cofrinho OU com progresso informado manualmente)

create type public.pocket_status        as enum ('active', 'archived');
create type public.pocket_movement_kind as enum ('reserve', 'withdraw', 'transfer_in', 'transfer_out', 'use', 'use_reversal');
create type public.goal_status          as enum ('active', 'paused', 'completed', 'canceled');

-- ============ pockets ============
create table public.pockets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  profile_id    uuid not null,                       -- responsável (pessoa ou Casal)
  account_id    uuid not null,                       -- onde o dinheiro está (lastro). Imutável.
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  description   text check (description is null or char_length(description) <= 300),
  icon          text not null default 'piggy-bank' check (char_length(icon) between 1 and 40),
  color         text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  status        public.pocket_status not null default 'active',
  legacy_ref    text check (legacy_ref is null or char_length(legacy_ref) between 1 and 120),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint pockets_household_id_id_key unique (household_id, id),
  constraint pockets_profile_fk foreign key (household_id, profile_id)
    references public.financial_profiles (household_id, id),
  -- NO ACTION (não CASCADE/RESTRICT): o DELETE em cascata do household continua funcionando; excluir só a conta é bloqueado.
  constraint pockets_account_fk foreign key (household_id, account_id)
    references public.accounts (household_id, id)
);
comment on table public.pockets is 'Cofrinhos: reserva VIRTUAL sobre uma conta real. Sem coluna de saldo (derivado de pocket_movements).';

create unique index pockets_household_legacy_ref_key on public.pockets (household_id, legacy_ref) where legacy_ref is not null;
create index pockets_household_account_idx on public.pockets (household_id, account_id);
create index pockets_household_profile_idx on public.pockets (household_id, profile_id);
create index pockets_created_by_idx on public.pockets (created_by);

-- ============ pocket_movements (histórico imutável) ============
create table public.pocket_movements (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households (id) on delete cascade,
  pocket_id          uuid not null,
  kind               public.pocket_movement_kind not null,
  amount_cents       bigint not null check (amount_cents > 0 and amount_cents <= 100000000000000),
  movement_date      date not null,
  note               text check (note is null or char_length(note) <= 300),
  transaction_id     uuid,          -- 'use' e 'use_reversal': a despesa
  transfer_group_id  uuid,          -- transfer_in/out: liga as duas pontas
  reverses_id        uuid,          -- 'use_reversal': o 'use' estornado
  created_by         uuid references auth.users (id) on delete set null,   -- carimbado pelo banco (migration 2)
  created_at         timestamptz not null default clock_timestamp(),
  constraint pocket_movements_household_id_id_key unique (household_id, id),
  constraint pocket_movements_pocket_fk foreign key (household_id, pocket_id)
    references public.pockets (household_id, id),
  -- NO ACTION (SEM cascade): a despesa não some enquanto houver movimento ligado a ela (o histórico fica).
  constraint pocket_movements_tx_fk foreign key (household_id, transaction_id)
    references public.transactions (household_id, id),
  constraint pocket_movements_reverses_fk foreign key (household_id, reverses_id)
    references public.pocket_movements (household_id, id),
  constraint pocket_movements_shape check (
        ((kind in ('use', 'use_reversal')) = (transaction_id is not null))
    and ((kind = 'use_reversal') = (reverses_id is not null))
    and ((kind in ('transfer_in', 'transfer_out')) = (transfer_group_id is not null))
  )
);
comment on table public.pocket_movements is 'Histórico append-only dos cofrinhos. Saldo do cofrinho = soma com sinal. Nunca editado nem excluído.';

create index pocket_movements_pocket_idx on public.pocket_movements (household_id, pocket_id, movement_date desc, created_at desc);
create unique index pocket_movements_use_once      on public.pocket_movements (transaction_id) where kind = 'use';
create unique index pocket_movements_reversal_once on public.pocket_movements (reverses_id) where reverses_id is not null;
create unique index pocket_movements_transfer_side on public.pocket_movements (transfer_group_id, kind) where transfer_group_id is not null;
create index pocket_movements_tx_idx on public.pocket_movements (household_id, transaction_id) where transaction_id is not null;
create index pocket_movements_reverses_idx on public.pocket_movements (household_id, reverses_id) where reverses_id is not null;
create index pocket_movements_created_by_idx on public.pocket_movements (created_by);

-- ============ goals ============
create table public.goals (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households (id) on delete cascade,
  profile_id           uuid not null,                -- responsável financeiro
  name                 text not null check (char_length(btrim(name)) between 1 and 80),
  description          text check (description is null or char_length(description) <= 300),
  kind                 text not null default 'other'
                         check (kind in ('travel', 'emergency', 'purchase', 'education', 'housing', 'vehicle', 'retirement', 'other')),
  target_cents         bigint not null check (target_cents > 0 and target_cents <= 100000000000000),
  deadline             date,
  icon                 text not null default 'target' check (char_length(icon) between 1 and 40),
  color                text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  status               public.goal_status not null default 'active',
  pocket_id            uuid,
  manual_amount_cents  bigint not null default 0 check (manual_amount_cents >= 0 and manual_amount_cents <= 100000000000000),
  created_by           uuid default auth.uid() references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint goals_household_id_id_key unique (household_id, id),
  constraint goals_profile_fk foreign key (household_id, profile_id)
    references public.financial_profiles (household_id, id),
  constraint goals_pocket_fk foreign key (household_id, pocket_id)
    references public.pockets (household_id, id),
  -- progresso informado à mão e cofrinho nunca se misturam: vinculou, o valor manual deixa de existir
  constraint goals_manual_xor_pocket check (pocket_id is null or manual_amount_cents = 0)
);
comment on table public.goals is 'Objetivos. Vinculado a cofrinho: progresso REAL = saldo do cofrinho. Sem cofrinho: progresso INFORMADO (manual_amount_cents), nunca dinheiro reservado.';

create unique index goals_pocket_key on public.goals (pocket_id) where pocket_id is not null and status <> 'canceled';
create index goals_household_profile_idx on public.goals (household_id, profile_id);
create index goals_household_pocket_idx on public.goals (household_id, pocket_id);
create index goals_created_by_idx on public.goals (created_by);

-- ============ triggers de higiene ============
create trigger set_updated_at before update on public.pockets for each row execute function private.set_updated_at();
create trigger prevent_tenant_change before update on public.pockets for each row execute function private.prevent_tenant_change();
create trigger set_updated_at before update on public.goals for each row execute function private.set_updated_at();
create trigger prevent_tenant_change before update on public.goals for each row execute function private.prevent_tenant_change();

-- Validação do cofrinho (só o que não depende de objetos das próximas migrations; "arquivar exige saldo 0" chega na migration 2):
--   conta ATIVA e de CONSUMO (nunca investimento); conta imutável; reativar exige conta ativa.
create or replace function private.validate_pocket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account record;
begin
  if not (select private.can_write(new.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.account_id <> old.account_id then
    raise exception 'pocket_account_immutable' using errcode = 'P0001';
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
revoke all on function private.validate_pocket() from public, anon, authenticated;
create trigger b_validate_pocket before insert or update on public.pockets
  for each row execute function private.validate_pocket();

-- ============ privilégios e RLS (desde a criação) ============
alter table public.pockets          enable row level security;
alter table public.pocket_movements enable row level security;
alter table public.goals            enable row level security;

revoke all on public.pockets, public.pocket_movements, public.goals from public, anon, authenticated;

-- cofrinho e objetivo: cadastro com RLS (não guardam dinheiro; o saldo é derivado do histórico)
grant select, insert, update on public.pockets to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
-- histórico: SOMENTE leitura. Nenhum INSERT/UPDATE/DELETE/TRUNCATE para papéis de API.
grant select on public.pocket_movements to authenticated;

create policy pockets_select on public.pockets
  for select to authenticated using ((select private.is_member(household_id)));
create policy pockets_insert on public.pockets
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy pockets_update on public.pockets
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));
-- (sem policy de delete em pockets: só arquiva)

create policy pocket_movements_select on public.pocket_movements
  for select to authenticated using ((select private.is_member(household_id)));
-- (nenhuma policy de insert/update/delete em pocket_movements)

create policy goals_select on public.goals
  for select to authenticated using ((select private.is_member(household_id)));
create policy goals_insert on public.goals
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy goals_update on public.goals
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));
create policy goals_delete on public.goals
  for delete to authenticated using ((select private.can_write(household_id)));
