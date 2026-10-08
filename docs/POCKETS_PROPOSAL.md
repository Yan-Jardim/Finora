> **Documento histórico do desenho.** O estado implementado está em [POCKETS.md](./POCKETS.md).

# Cofrinhos e Objetivos — proposta da fase 2 (Banco, RLS e RPCs) — revisão 2

**Status: PROPOSTA. Nenhuma migration foi aplicada nem versionada.** O SQL abaixo é rascunho para revisão; nada aqui faz DROP, reset ou exclusão.

## 0. O que mudou nesta revisão

| # | Ponto | Decisão |
|---|---|---|
| 1 | Histórico imutável × exclusão da despesa | Sem `ON DELETE CASCADE`. Despesa paga com reserva **não pode ser excluída nem alterada**; o fluxo é **estornar** (`reverse_pocket_use`): um movimento compensatório `use_reversal` + cancelamento da despesa, na mesma transação. Nada é apagado. |
| 2 | Escritas diretas inválidas | `pocket_movements` **sem nenhum privilégio de escrita** para `authenticated`/`anon` (só `SELECT`). Toda escrita passa por uma função `SECURITY DEFINER` em `private` que valida e trava; triggers repetem as invariantes (defesa em profundidade). |
| 3 | Saldo negativo | A guarda só age em conta **com reserva (> 0)** e **só em operações que reduzem a folga** (saldo − reservado). Conta sem reserva nunca é afetada, mesmo com saldo negativo. |
| 4 | Concorrência | Trava em **todo** caminho que altera saldo (trigger de tabela) + testes com duas sessões reais, inclusive transferências cruzadas. |

Mudanças em relação à revisão 1: enum ganha `use_reversal`; `pocket_movements` ganha `reverses_id`; FK da despesa deixa de ser `CASCADE`; privilégios de escrita removidos; guarda de lastro passa a ser por **variação de folga**; nova RPC `reverse_pocket_use`; as escritas viram `SECURITY DEFINER` em `private` com `public` fino por cima. Continuam 3 migrations.

## 1. Schema proposto

### 1.1 Migration 1 — tabelas, enums, privilégios e RLS

```sql
create type public.pocket_status        as enum ('active', 'archived');
create type public.pocket_movement_kind as enum ('reserve', 'withdraw', 'transfer_in', 'transfer_out', 'use', 'use_reversal');
create type public.goal_status          as enum ('active', 'paused', 'completed', 'canceled');

-- Cofrinho: só cadastro. NÃO há coluna de saldo (o saldo é a soma do histórico).
create table public.pockets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  profile_id    uuid not null,
  account_id    uuid not null,                       -- onde o dinheiro está (lastro). Imutável.
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  description   text check (description is null or char_length(description) <= 300),
  icon          text not null default 'piggy-bank' check (char_length(icon) between 1 and 40),
  color         text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  status        public.pocket_status not null default 'active',
  legacy_ref    text,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint pockets_household_id_id_key unique (household_id, id),
  constraint pockets_profile_fk foreign key (household_id, profile_id) references public.financial_profiles (household_id, id),
  -- NO ACTION: o DELETE em cascata do household funciona; excluir só a conta é bloqueado.
  constraint pockets_account_fk foreign key (household_id, account_id) references public.accounts (household_id, id)
);
create unique index pockets_household_legacy_ref_key on public.pockets (household_id, legacy_ref) where legacy_ref is not null;
create index pockets_household_account_idx on public.pockets (household_id, account_id);
create index pockets_household_profile_idx on public.pockets (household_id, profile_id);
create index pockets_created_by_idx on public.pockets (created_by);

-- Histórico: IMUTÁVEL e append-only. Correção = novo movimento (nunca edição/exclusão).
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
  reverses_id        uuid,          -- 'use_reversal': o 'use' que está sendo estornado
  created_by         uuid references auth.users (id) on delete set null,   -- preenchido pelo banco
  created_at         timestamptz not null default clock_timestamp(),
  constraint pocket_movements_household_id_id_key unique (household_id, id),
  constraint pocket_movements_pocket_fk foreign key (household_id, pocket_id) references public.pockets (household_id, id),
  -- NO ACTION (SEM cascade): a despesa não some enquanto houver movimento ligado a ela (o histórico fica).
  constraint pocket_movements_tx_fk foreign key (household_id, transaction_id) references public.transactions (household_id, id),
  constraint pocket_movements_reverses_fk foreign key (household_id, reverses_id) references public.pocket_movements (household_id, id),
  constraint pocket_movements_shape check (
        ((kind in ('use', 'use_reversal')) = (transaction_id is not null))
    and ((kind = 'use_reversal') = (reverses_id is not null))
    and ((kind in ('transfer_in', 'transfer_out')) = (transfer_group_id is not null))
  )
);
create index pocket_movements_pocket_idx on public.pocket_movements (household_id, pocket_id, movement_date desc, created_at desc);
create unique index pocket_movements_use_once      on public.pocket_movements (transaction_id) where kind = 'use';
create unique index pocket_movements_reversal_once on public.pocket_movements (reverses_id) where reverses_id is not null;
create unique index pocket_movements_transfer_side on public.pocket_movements (transfer_group_id, kind) where transfer_group_id is not null;
create index pocket_movements_tx_idx on public.pocket_movements (household_id, transaction_id) where transaction_id is not null;
create index pocket_movements_created_by_idx on public.pocket_movements (created_by);

-- Objetivo (sem alterações em relação à revisão 1)
create table public.goals ( /* id, household_id, profile_id, name, description, kind, target_cents, deadline, icon, color,
                               status, pocket_id, manual_amount_cents, created_by, created_at, updated_at,
                               FKs compostas, CHECK goals_manual_xor_pocket, índice único parcial em pocket_id */ );
```

**Privilégios e RLS (a mudança central do ponto 2):**

```sql
alter table public.pockets          enable row level security;
alter table public.pocket_movements enable row level security;
alter table public.goals            enable row level security;

revoke all on public.pockets, public.pocket_movements, public.goals from public, anon, authenticated;

-- pockets: cadastro com RLS + triggers (não guarda dinheiro; as invariantes estão em triggers e nas RPCs)
grant select, insert, update on public.pockets to authenticated;
-- movimentos: SOMENTE leitura. Nenhum INSERT/UPDATE/DELETE/TRUNCATE para nenhum papel de API.
grant select on public.pocket_movements to authenticated;
-- objetivos: não movimentam dinheiro
grant select, insert, update, delete on public.goals to authenticated;

create policy pockets_select on public.pockets for select to authenticated using ((select private.is_member(household_id)));
create policy pockets_insert on public.pockets for insert to authenticated with check ((select private.can_write(household_id)));
create policy pockets_update on public.pockets for update to authenticated
  using ((select private.can_write(household_id))) with check ((select private.can_write(household_id)));
create policy pocket_movements_select on public.pocket_movements for select to authenticated using ((select private.is_member(household_id)));
-- (nenhuma policy de insert/update/delete em pocket_movements; goals: select/insert/update/delete como accounts)
```

Triggers de higiene: `set_updated_at` e `prevent_tenant_change` em `pockets` e `goals`. Validação de `pockets` (BEFORE INSERT/UPDATE): conta ativa e de tipo ≠ `investment`; `account_id` imutável; arquivar exige saldo 0; reativar exige conta ativa.

### 1.2 Migration 2 — funções privadas, views e guardas

Funções e views como na revisão 1 (`private.pocket_balance`, `private.account_reserved`, `private.lock_accounts`, `v_pocket_balances`, `v_account_reserves`), com o sinal atualizado: `reserve`, `transfer_in` e `use_reversal` somam; `withdraw`, `transfer_out` e `use` subtraem.

```sql
-- Efeito de uma movimentação no saldo de uma conta (MESMA regra da view v_account_balances).
create function private.tx_effect(t public.transactions, a uuid) returns bigint language sql immutable set search_path = '' as $$
  select case when t.id is null or t.status <> 'paid' then 0 else
           (case when t.account_id = a and t.kind <> 'credit_card_purchase'
                 then (case when t.kind = 'income' then t.amount_cents else -t.amount_cents end) else 0 end)
         + (case when t.to_account_id = a then t.amount_cents else 0 end) end $$;
```

**(A) Guarda de lastro com a regra do saldo negativo (ponto 3).** Regra explícita:

> Para cada conta com **reservado > 0**, o saldo bancário deve ser **≥ reservado**. Conta com reservado = 0 **não é verificada**, e portanto pode ter saldo negativo como sempre teve. A verificação só roda quando a operação **reduz a folga** (`saldo − reservado`) da conta; operações neutras ou que melhoram a folga (receitas, retiradas, estornos) nunca são bloqueadas.

```sql
create function private.check_reserve_backing() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_acc uuid; v_delta bigint; v_res bigint; v_bal bigint; v_ids uuid[] := '{}';
begin
  if tg_table_name = 'transactions' then
    if tg_op <> 'INSERT' then v_ids := v_ids || array[old.account_id, old.to_account_id]; end if;
    if tg_op <> 'DELETE' then v_ids := v_ids || array[new.account_id, new.to_account_id]; end if;
  elsif tg_table_name = 'accounts' then
    v_ids := array[new.id];
    if tg_op = 'UPDATE' and ((old.is_active and not new.is_active) or (new.type = 'investment' and old.type <> 'investment'))
       and private.account_reserved(new.id) > 0 then
      raise exception 'account_has_reserve' using errcode = 'P0001', detail = format('account_id=%s', new.id);
    end if;
  else -- pocket_movements (só INSERT)
    select array[p.account_id] into v_ids from public.pockets p where p.household_id = new.household_id and p.id = new.pocket_id;
  end if;

  foreach v_acc in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_ids) x where x is not null) loop
    if not exists (select 1 from public.accounts a where a.id = v_acc) then continue; end if;   -- cascata do household
    v_delta := case tg_table_name
      when 'transactions' then (case when tg_op = 'DELETE' then 0 else private.tx_effect(new, v_acc) end)
                             - (case when tg_op = 'INSERT' then 0 else private.tx_effect(old, v_acc) end)
      when 'accounts'     then (case when tg_op = 'UPDATE' then new.initial_balance_cents - old.initial_balance_cents else 0 end)
      else (case when new.kind in ('reserve','transfer_in','use_reversal') then -new.amount_cents else new.amount_cents end)
    end;
    continue when v_delta >= 0;                    -- folga não diminuiu: nada a conferir
    v_res := private.account_reserved(v_acc);
    continue when v_res <= 0;                      -- sem reserva: saldo negativo é permitido, como antes
    select balance_cents into v_bal from public.v_account_balances where account_id = v_acc;
    if v_bal < v_res then
      raise exception 'reserve_shortfall' using errcode = 'P0001',
        detail = format('account_id=%s;shortfall_cents=%s;reserved_cents=%s;balance_cents=%s', v_acc, v_res - v_bal, v_res, v_bal);
    end if;
  end loop;
  return null;
end $$;

create constraint trigger z_reserve_backing after insert or update or delete on public.transactions
  deferrable initially deferred for each row execute function private.check_reserve_backing();
create constraint trigger z_reserve_backing after update of initial_balance_cents, is_active, type on public.accounts
  deferrable initially deferred for each row execute function private.check_reserve_backing();
create constraint trigger z_reserve_backing after insert on public.pocket_movements
  deferrable initially deferred for each row execute function private.check_reserve_backing();
```

**(B) Trava em todo caminho que altera saldo (ponto 4):**

```sql
create function private.lock_reserve_accounts() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[] := '{}';
begin
  if tg_op <> 'INSERT' and old.status = 'paid' then v_ids := v_ids || array[old.account_id, old.to_account_id]; end if;
  if tg_op <> 'DELETE' and new.status = 'paid' then v_ids := v_ids || array[new.account_id, new.to_account_id]; end if;
  perform private.lock_accounts(v_ids);             -- ordem de id; ignora nulos
  return coalesce(new, old);
end $$;
create trigger a0_lock_reserve_accounts before insert or update or delete on public.transactions
  for each row execute function private.lock_reserve_accounts();
-- accounts: o UPDATE/DELETE já trava a própria linha; pocket_movements: travado em private.pocket_write.
```

**(C) Invariantes dos movimentos (ponto 2), todas no banco:**

```sql
-- BEFORE INSERT: valida e CARIMBA created_by/created_at (o cliente não escolhe)
create function private.validate_pocket_movement() returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.pockets; t public.transactions; o public.pocket_movements;
begin
  select * into p from public.pockets where household_id = new.household_id and id = new.pocket_id;      -- FK composta: mesmo household
  if not found then raise exception 'pocket_not_found' using errcode = 'P0002'; end if;
  if p.status = 'archived' then raise exception 'pocket_archived' using errcode = 'P0001'; end if;
  if new.movement_date > private.household_today(new.household_id) then
    raise exception 'future_date' using errcode = '22023'; end if;

  if new.kind = 'use' then                                         -- despesa válida, PAGA, da MESMA conta, valor coberto
    select * into t from public.transactions where household_id = new.household_id and id = new.transaction_id;
    if not found or t.kind <> 'expense' or t.status <> 'paid'
       or t.account_id is distinct from p.account_id or new.amount_cents > t.amount_cents then
      raise exception 'use_invalid_expense' using errcode = '22023'; end if;
  elsif new.kind = 'use_reversal' then                             -- estorno do mesmo cofrinho, mesma despesa, valor integral
    select * into o from public.pocket_movements where household_id = new.household_id and id = new.reverses_id;
    if not found or o.kind <> 'use' or o.pocket_id <> new.pocket_id or o.transaction_id <> new.transaction_id
       or o.amount_cents <> new.amount_cents then
      raise exception 'reversal_invalid' using errcode = '22023'; end if;
  end if;
  new.created_by := (select auth.uid());
  new.created_at := clock_timestamp();
  return new;
end $$;
create trigger b_validate before insert on public.pocket_movements for each row execute function private.validate_pocket_movement();

-- IMUTABILIDADE (mesmo para papéis com privilégio): nenhum UPDATE/DELETE/TRUNCATE, exceto a cascata do household
create function private.pocket_history_immutable() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.households h where h.id = old.household_id) then return old; end if;
  raise exception 'pocket_history_immutable' using errcode = 'P0001';
end $$;
create trigger a_immutable before update or delete on public.pocket_movements for each row execute function private.pocket_history_immutable();
create trigger a_no_truncate before truncate on public.pocket_movements for each statement execute function private.pocket_history_immutable();
```

Invariantes **deferidas** (avaliam o resultado final da transação, e por isso aceitam as duas pontas inseridas em sequência):

| Constraint trigger | Garante | Erro |
|---|---|---|
| `z_transfer_pair` (após INSERT com `transfer_group_id`) | o grupo tem **exatamente** um `transfer_out` e um `transfer_in`, mesmo valor, mesma data, **mesma conta**, cofrinhos diferentes. Um `transfer_in` sem `transfer_out` falha no COMMIT; o índice único `(transfer_group_id, kind)` impede duplicar lados | `transfer_unbalanced` |
| `z_pocket_nonneg` (após INSERT) | saldo do cofrinho nunca fica negativo (**retirada acima do reservado** falha, mesmo sob concorrência, porque o cofrinho é travado antes) | `insufficient_pocket` (`DETAIL`: faltante) |
| `z_use_consistency` (após INSERT em movimentos `use`/`use_reversal` e após UPDATE em `transactions`) | `use` **não estornado** ⇒ despesa ainda `expense`, `paid`, mesma conta, valor ≥ uso; `use` **estornado** ⇒ despesa `canceled`. Fecha a brecha de cancelar sem estornar e de estornar sem cancelar | `use_inconsistent` |

**(D) Trava da despesa vinculada** (substitui o cascade; ponto 1):

```sql
create function private.guard_pocket_use() returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.pocket_movements;
begin
  select * into m from public.pocket_movements where transaction_id = old.id and kind = 'use';
  if not found then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.households h where h.id = old.household_id) then return old; end if;   -- cascata do household
    raise exception 'use_pocket_flow' using errcode = '22023', hint = 'reverse_pocket_use';
  end if;
  if (new.amount_cents, new.date, new.status, new.paid_at, new.account_id, new.to_account_id, new.kind)
     is distinct from (old.amount_cents, old.date, old.status, old.paid_at, old.account_id, old.to_account_id, old.kind) then
    -- única alteração permitida: paga -> cancelada, DEPOIS de existir o estorno
    if old.status = 'paid' and new.status = 'canceled' and new.paid_at is null
       and (new.amount_cents, new.date, new.account_id, new.to_account_id, new.kind) = (old.amount_cents, old.date, old.account_id, old.to_account_id, old.kind)
       and exists (select 1 from public.pocket_movements r where r.reverses_id = m.id) then
      return new;
    end if;
    raise exception 'use_pocket_flow' using errcode = '22023', hint = 'reverse_pocket_use';
  end if;
  return new;                                    -- descrição, categoria, tags e observações seguem editáveis
end $$;
create trigger d_guard_pocket_use before update or delete on public.transactions for each row execute function private.guard_pocket_use();
```

## 2. Estorno auditável (ponto 1)

**Fluxo `reverse_pocket_use(p_transaction_id, p_note)`** (uma transação):
1. trava a conta e o cofrinho;
2. insere `use_reversal` (+valor integral, `reverses_id` = o `use`, mesma despesa; o `use` original **permanece**);
3. cancela a despesa (`status = canceled`, `paid_at = null`).

Efeito: o cancelamento devolve o valor ao **saldo bancário** (despesa cancelada não é paga) e o estorno devolve o valor ao **reservado**; a folga fica igual. Não há exclusão em lugar nenhum: o histórico mostra `use` e `use_reversal`, e a despesa fica visível como cancelada. Sem duplicação: o índice `pocket_movements_reversal_once` permite **um** estorno por `use`; uma despesa estornada fica travada (não volta a `paid`); para lançar de novo, cria-se uma nova despesa.

Consequências (a aprovar): a despesa paga com reserva **não tem "Excluir"** nem edição de valor/data/status/conta (aparece "Estornar"); o estorno é **integral** (uso parcial continua permitido na criação). Estornar exige cofrinho ativo (`pocket_archived`: reative antes). Correções de reserva/retirada também são por novo movimento. Exclusão do **household** continua funcionando (as guardas ignoram a cascata).

## 3. Segurança das escritas em `pocket_movements` (ponto 2)

**Camadas** (a falha de uma não deixa passar a escrita inválida):
1. **Privilégios:** `authenticated` e `anon` só têm `SELECT`. Não existe INSERT/UPDATE/DELETE/TRUNCATE por API ⇒ qualquer escrita direta falha com `permission denied (42501)`.
2. **RLS:** policy só de `SELECT` (membros do household); sem policies de escrita.
3. **Único caminho de escrita:** `private.pocket_write(...)`, `SECURITY DEFINER`, `search_path = ''`, que **autoriza explicitamente** (`private.can_write(household do cofrinho)`, cofrinho visto só se for do household do usuário), trava conta e cofrinho e faz o INSERT. O schema `private` não é exposto pela API.
4. **Triggers** (valem inclusive para o dono da função): `validate_pocket_movement` (BEFORE), imutabilidade (UPDATE/DELETE/TRUNCATE), e as constraints deferidas.
5. **Constraints declarativas:** FKs compostas (household), CHECKs de forma, índices únicos.

| Cenário | Barreira |
|---|---|
| `transfer_in` sem `transfer_out` | `z_transfer_pair` (COMMIT) + CHECK de forma; escrita direta nem chega (sem privilégio) |
| retirada acima do reservado | `insufficient_pocket` na RPC (mensagem amigável) **e** `z_pocket_nonneg` no COMMIT (concorrência) |
| `use` sem despesa válida | `validate_pocket_movement` (existe, `expense`, `paid`, mesma conta, valor ≤ despesa) + `z_use_consistency` |
| transação de outra conta | `use_invalid_expense` (conta ≠ conta do cofrinho) |
| transação/cofrinho de outro household | FK composta `(household_id, …)` + `pocket_not_found`; o RLS esconde o que não é do usuário |
| mesma despesa usada duas vezes | índice único `pocket_movements_use_once` |
| estornar duas vezes / estorno de outro cofrinho ou valor | `pocket_movements_reversal_once` + `reversal_invalid` |
| falsificar histórico (editar, apagar, alterar data/autor) | sem privilégio + trigger de imutabilidade; `created_by`/`created_at` são carimbados pelo banco; data futura é rejeitada (`future_date`) |
| cancelar/editar/excluir a despesa ligada por fora | `guard_pocket_use` + `z_use_consistency` |

Endurecimento adicional: funções `SECURITY DEFINER` com `search_path = ''`, `REVOKE ALL … FROM public, anon`, `GRANT EXECUTE` só ao necessário; as RPCs `public` são `SECURITY INVOKER` finas que chamam `private.pocket_write` (assim os advisors não ganham novos avisos de `SECURITY DEFINER` em schema exposto).

## 4. RPCs

| RPC (`public`, INVOKER) | Faz |
|---|---|
| `create_pocket(...)` | cria cofrinho (+ `reserve` inicial opcional, idempotente por `legacy_ref`) |
| `update_pocket(id, patch)` / `set_pocket_archived(id, bool)` | cadastro; arquivar exige saldo 0 |
| `pocket_reserve` / `pocket_withdraw` / `pocket_transfer` | via `private.pocket_write` (transfer = 2 linhas, mesmo grupo, mesma conta) |
| `spend_from_pocket(...)` | trava a conta; `create_transaction` (despesa paga) + `use` (valor ≤ despesa); uma transação |
| `reverse_pocket_use(transaction_id, note)` | estorno auditável (seção 2) |

`private.pocket_write(pocket, kind, amount, date, note, tx, group, reverses)` (DEFINER): autoriza → `lock_accounts(conta do cofrinho)` → pré-checagens amigáveis (`insufficient_free` com folga e faltante; `insufficient_pocket`) → INSERT (os triggers validam de novo).

## 5. Como a concorrência é coberta em todos os caminhos (ponto 4)

A trava está em **tabela** (`a0_lock_reserve_accounts` em `transactions`, linha da conta em `accounts`, `pocket_write` em movimentos), então cobre sem tocar as RPCs existentes:

| Caminho | Como trava |
|---|---|
| `create_transaction`, `update_transaction`, `update_installments`, `delete_installments` | trigger BEFORE ROW em `transactions` (linha nova **e** antiga, pagas) |
| `pay_invoice` (`card_payment` com `account_id`) | idem |
| `pay_debt`, `settle_debt`, `reopen_debt` (`debt_payment`) | idem |
| transferência / investimento / resgate (`account_id` **e** `to_account_id`) | as duas contas, travadas **em ordem de id** (transferências cruzadas A→B e B→A não geram deadlock) |
| exclusão / redução / mudança de status de receita ou despesa paga | trigger usa a linha **antiga** (`OLD`) |
| saldo inicial, arquivar, tipo da conta | `UPDATE` em `accounts` já trava a linha; a conferência deferida roda no COMMIT |
| reservar, retirar, transferir, usar, estornar | `private.pocket_write` / `spend_from_pocket` travam a conta antes de ler a folga |
| escrita direta (API) em `transactions`/`accounts` | mesmos triggers |
| lançamentos não pagos (planejado/pendente) | não alteram saldo ⇒ nem travam nem são verificados |

**Por que funciona (READ COMMITTED):** a trava dura até o COMMIT; a segunda sessão espera, e a conferência (que roda no COMMIT, com snapshot novo) já enxerga o que a primeira comitou. Em caso raro de deadlock o PostgreSQL aborta uma transação (`40P01`) e o app pede para repetir. As RPCs que tocam várias contas chamam `lock_accounts` com todas as contas **antes** de escrever.

## 6. Regra do saldo negativo (ponto 3) — definição e teste

**Definição:** o invariante é `reservado(conta) > 0 ⇒ saldo(conta) ≥ reservado(conta)`. Não existe regra "saldo ≥ 0". Conta sem reserva se comporta exatamente como antes dos cofrinhos. Reservar numa conta com saldo negativo (ou folga insuficiente) é recusado com `insufficient_free` (folga mostrada, inclusive negativa).

**Regressão (cenários anteriores aos cofrinhos, com a migration aplicada):**
- conta com saldo negativo e **sem** cofrinhos: despesa paga, pagamento de fatura, pagamento/quitação de dívida, transferência de saída, exclusão de receita paga, saldo inicial mais negativo, arquivar a conta ⇒ **todos continuam funcionando**;
- conta B negativa e sem reserva enquanto a conta A tem reserva ⇒ operações em B não são afetadas;
- conta com reserva e saldo ≥ reservado que fica com folga menor mas ≥ 0 ⇒ passa; que ultrapassa a folga ⇒ `reserve_shortfall`;
- depois de retirar a reserva, a mesma operação passa;
- **todos os testes SQL já existentes** (`identity_security`, `financial_core_isolation`, `transactions_core`, `transactions_rpc*`, `create_transaction`, `recurring_*`, `debts*`) rodam **sem alteração** e devem continuar passando.

## 7. Migração dos cofrinhos antigos (inalterada)

Local: cofrinho legado → cofrinho + 1 `reserve` (idempotente, marcador, chave antiga preservada; sem lastro ⇒ criado vazio com aviso). Supabase: "Importar cofrinhos antigos" com revisão e `legacy_ref` (importar duas vezes não duplica). Seeds de demonstração geram cofrinho + movimento.

## 8. Operações existentes que precisam de ajuste

- **Banco:** nenhuma RPC existente reescrita. Novos triggers em `transactions` (`a0_lock_reserve_accounts`, `z_reserve_backing`, `d_guard_pocket_use`) e em `accounts` (`z_reserve_backing`). Mudança de comportamento: despesa paga com reserva não pode ser excluída/editada (só estornada); reduzir, excluir ou marcar como não paga uma receita pode ser bloqueado **apenas** em conta com reserva sem folga.
- **App:** `toFriendlyError` com `reserve_shortfall`, `insufficient_free`, `insufficient_pocket`, `use_pocket_flow`, `pocket_has_balance`, `pocket_archived`, `account_has_reserve`; mensagem com o valor e atalho "Retirar da reserva". Modo local: regra pura `reserveShortfall` (mesma definição: só conta com reserva, só operação que reduz a folga). Linha da despesa vinculada mostra "Estornar".

## 9. Disponível de verdade, Planejamento e Objetivos

Sem mudanças em relação à revisão 1: fórmula `saldo − contas − faturas − dívidas − reservado` (reservado vem dos movimentos); despesa com reserva reduz saldo e reservado igualmente; **estorno restaura ambos** (cancelamento devolve o saldo, `use_reversal` devolve o reservado); Planejamento no saldo real com "dinheiro comprometido" à parte; objetivo vinculado usa o saldo do cofrinho, sem cofrinho mostra "Informado manualmente", nunca somado a reservado, disponível ou patrimônio.

## 10. Testes necessários

**SQL (transação com ROLLBACK):**
- *Privilégios e imutabilidade:* como `authenticated`, INSERT/UPDATE/DELETE/TRUNCATE direto em `pocket_movements` ⇒ `42501`; UPDATE/DELETE/TRUNCATE com papel privilegiado ⇒ `pocket_history_immutable`; `created_by`/`created_at` não são controláveis; data futura rejeitada.
- *Invariantes via caminho privilegiado:* `transfer_in` sozinho ⇒ `transfer_unbalanced`; dois `transfer_out`; transfer entre contas diferentes; retirada acima do saldo; `use` com despesa inexistente, não paga, de outra conta, de outro household, valor maior; `use` duplicado; estorno duplicado, de outro cofrinho/valor.
- *Estorno:* despesa com `use` não pode ser excluída nem editada (valor/status/conta); descrição editável; `reverse_pocket_use` restaura saldo **e** reservado, mantém os dois movimentos, bloqueia 2º estorno e reativação; cancelar sem estornar ⇒ `use_pocket_flow`.
- *Lastro e saldo negativo:* a matriz da seção 6; mais cada caminho (despesa, fatura, dívida, quitação, transferência, receita excluída/reduzida, saldo inicial, arquivar, tipo investimento).
- *RLS:* outro household não lê nem usa; leitor sem escrita não opera; FKs compostas; cascata do household apaga tudo (sem DELETE por API).

**Integração (Vitest, Supabase real, usuário descartável, duas sessões reais do mesmo usuário):**
- duas reservas simultâneas acima da folga (exatamente uma conclui), repetidas em várias rodadas;
- reservar × pagar despesa; reservar × `pay_invoice`; reservar × `pay_debt`/`settle_debt`; reservar × excluir/reduzir receita; reservar × alterar saldo inicial;
- **transferências entre contas:** A→B × reservar em A; A→B × B→A ao mesmo tempo (sem deadlock, ambas concluem); transferência × retirada;
- duas retiradas do mesmo cofrinho; estorno × retirada;
- invariante verificado ao fim de cada rodada: `saldo ≥ reservado` e nenhum cofrinho negativo.
- Observação: o PostgREST não permite forçar a intercalação exata, então os testes repetem rodadas com largada sincronizada e verificam o invariante; as travas em si são verificadas pelos testes SQL de caminho.

**Paridade local × Supabase, unitários e E2E:** como na revisão 1, incluindo estorno e a regra do saldo negativo.

## 11. O que NÃO muda

Regras de despesa, receita, fatura, dívida e planejamento; patrimônio; RPCs atuais; RLS existente. Nenhum DROP, reset ou exclusão em lote.

## 12. Revisão 3 — Migration 2 definitiva (preparada, NÃO aplicada)

SQL definitivo em `supabase/migrations/_pending_pockets_guards.sql` (sem versão; só ganha versão ao ser aplicada). Testes em `supabase/tests/pockets_guards_test.sql` (rollback), `pockets_cascade_delete_test.sql` (manual, com DELETE) e `pockets_concurrency_manual.md`.

Mudanças desde a revisão 2: locks `FOR NO KEY UPDATE` (não bloqueiam checagens de FK de lançamentos não pagos); ordem global de locks documentada; `guard_pocket_use` corrigida (`IS NOT DISTINCT FROM`: com `to_account_id` nulo, `=` entre tuplas dava NULL e recusava o cancelamento autorizado depois do estorno — bug achado no dry-run); guardas separadas por tabela; `private.pocket_balance`/`account_reserved` são INVOKER (RLS de quem consulta); `private.pocket_write` e `pocket_transfer_write` DEFINER com `search_path = ''`, autorização explícita e EXECUTE só para `authenticated`; `lock_*` e guardas sem EXECUTE para API.

## 13. Migration 3 — RPCs públicas (preparada, NÃO aplicada)

SQL em `supabase/migrations/_pending_pockets_rpcs.sql` (9 funções, todas `SECURITY INVOKER`, `search_path = ''`, EXECUTE só para `authenticated`, nenhuma recebe `household_id`). Testes: `supabase/tests/pockets_rpcs_test.sql`; dry-run manual atômico com rollback: `supabase/tests/pockets_m3_dryrun_manual.sql`.

| RPC | Faz | Erros estáveis |
|---|---|---|
| `create_pocket(profile, account, name, description, icon, color, initial_cents, date, legacy_ref)` | cria (+ reserva inicial); idempotente por `legacy_ref` | `profile_not_found`, `account_not_allowed`, `invalid_amount`, `insufficient_free`, `forbidden` |
| `update_pocket(id, patch)` | nome, descrição, ícone, cor, responsável | `pocket_not_found`, `invalid_patch_key` |
| `set_pocket_archived(id, bool)` | arquivar (saldo 0) / reativar | `pocket_not_found`, `pocket_has_balance`, `account_not_allowed` |
| `pocket_reserve` / `pocket_withdraw` | alocação virtual | `pocket_not_found`, `insufficient_free`, `insufficient_pocket`, `pocket_archived`, `invalid_amount`, `future_date` |
| `pocket_transfer` | entre cofrinhos da mesma conta | `different_accounts`, `same_pocket`, `insufficient_pocket`, `pocket_not_found` |
| `spend_from_pocket(pocket, description, amount, amount_from_pocket, date, category, profile, notes, tags)` | despesa paga + uso (parcial ou total), atômico | `category_required`, `amount_from_pocket_invalid`, `future_date`, `insufficient_pocket`, `reserve_shortfall` |
| `reverse_pocket_use(transaction, note)` | estorno integral do valor usado + cancela a despesa | `transaction_not_found`, `no_pocket_use`, `already_reversed`, `pocket_archived` |
| `link_goal_pocket(goal, pocket)` | liga/desliga objetivo (zera o valor manual) | `goal_not_found`, `pocket_already_linked`, `pocket_not_found` |

Erros herdados da migration 2 (estáveis para o frontend): `reserve_shortfall`, `insufficient_pocket`, `use_pocket_flow` (hint `reverse_pocket_use`), `account_has_reserve`, `pocket_history_immutable`, `transfer_unbalanced`, `use_invalid_expense`, `reversal_invalid`, `use_inconsistent`. O texto vem na `message`; os números (faltante, livre, conta) vêm no `details` (`chave=valor;…`).

## 14. Repositories e Commands (implementado)

- **Leitura**: `repos.pockets` (`list/get/movements`), `repos.goals` (CRUD); saldo do cofrinho = `v_pocket_balances` (Supabase) ou derivado do histórico (local); reservado/livre por conta = `v_account_reserves` / `domain/pockets.ts`. Nenhum modelo guarda saldo.
- **Escrita de dinheiro**: porta `PocketCommands` (`LocalPocketCommands` / `SupabasePocketCommands`, 1 RPC atômica por operação). Objetivos: CRUD por repositório.
- **Erros**: `AppError(message, code, info)`; tradução central em `repositories/supabase/errors.ts` (o motor local usa `appError(code, info)`: mesma mensagem e código).
- **Objetivos**: ligado ⇒ progresso = saldo real do cofrinho; manual ⇒ `manual_amount_cents`. **Ligar zera o valor manual e desligar NÃO o restaura.**
- **Migração local** (`services/pocket-migration.ts`): chave antiga `finora:v1:pockets` nunca é apagada; idempotente por `legacyRef`; sem lastro ⇒ cofrinho vazio + aviso (`withoutReserve`).
- **Divergências conhecidas**: (1) no modo local, editar conta (saldo inicial/arquivar/tipo) ainda não é guardado pelo lastro — a guarda entra na etapa de UI; (2) no Supabase `WorkspaceData.pocketMovements` fica vazio (saldos vêm das views; histórico sob demanda); (3) precedência entre erros simultâneos pode diferir (ex.: `future_date`).

## 15. Interface de Cofrinhos e Objetivos (implementada)

- **Telas**: `/cofrinhos` (cards, reservar, retirar, transferir, histórico, editar, arquivar/reativar, aviso de importação) e `/objetivos` (criar, editar, excluir com confirmação, vincular/desvincular, progresso). Filtro por pessoa/Casal pela URL (`?perfil=`).
- **Usar reserva**: na criação de despesa PAGA há "Usar dinheiro de um cofrinho" (cofrinho da mesma conta; uso parcial). Envia **somente** `pocketCommands.spend` (RPC `spend_from_pocket`). Despesa ligada a cofrinho não tem "Excluir": só "Estornar" (`reverse_pocket_use`).
- **Histórico**: sempre `repos.pockets.movements({ pocketId })` (banco, sob demanda). `WorkspaceData.pocketMovements` no Supabase carrega **apenas** `use`/`use_reversal` (para marcar as despesas); o saldo vem das views.
- **Importação dos antigos**: nos dois modos é ação explícita ("Importar cofrinhos"); nada roda sozinho e a chave antiga nunca é apagada. No modo local, `prepare` só inicia o armazenamento novo vazio (não semeia a demonstração por cima).
- **Lastro no modo local**: a edição de conta (saldo inicial, desativar, tipo) passou a ter as mesmas guardas do banco (`LocalAccountRepository`) — divergência anterior resolvida.
- **Dashboard**: cartão "Cofrinhos e objetivos"; "Disponível de verdade" usa o reservado derivado. **Planejamento**: só informação do reservado (a projeção continua partindo do saldo real).
- **Demonstração**: as reservas dos cofrinhos de exemplo foram reduzidas para caberem no saldo da Conta conjunta (a regra de lastro vale também nos dados de exemplo).
- Ligar um objetivo a um cofrinho zera o valor manual e **não** o restaura ao desvincular (a tela avisa antes).
