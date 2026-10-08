-- Bloco 3 / migration 13: transactions + invariantes financeiras.
-- Única fonte de verdade para somas. Dinheiro em centavos (bigint). Sem coluna de saldo.
-- Parcela É transaction. Compra no cartão não mexe no saldo. card_payment e transfer não são despesa.

create type public.transaction_kind as enum (
  'income', 'expense', 'credit_card_purchase', 'transfer', 'card_payment', 'debt_payment', 'investment', 'redemption'
);
create type public.transaction_status as enum ('planned', 'pending', 'paid', 'canceled');

create table public.transactions (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references public.households (id) on delete cascade,
  kind                     public.transaction_kind not null,
  status                   public.transaction_status not null default 'pending',
  description              text not null check (char_length(btrim(description)) between 1 and 80),
  amount_cents             bigint not null check (amount_cents > 0 and amount_cents <= 100000000000000),
  -- data de competência (compra no cartão = data da compra)
  date                     date not null,
  due_date                 date,
  paid_at                  date,
  profile_id               uuid not null,
  -- receita: conta creditada | despesa/pagamento: conta debitada | transferência: ORIGEM
  account_id               uuid,
  -- destino de transferência / investimento / resgate
  to_account_id            uuid,
  card_id                  uuid,
  -- compra: preenchido PELO BANCO (ignora o cliente) | pagamento: fatura quitada
  invoice_id               uuid,
  category_id              uuid,
  installment_purchase_id  uuid,
  installment_number       smallint check (installment_number between 1 and 48),
  notes                    text check (notes is null or char_length(notes) <= 300),
  created_by               uuid default auth.uid() references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint transactions_household_id_id_key unique (household_id, id),

  -- FKs compostas: toda referência precisa ser do MESMO household
  constraint transactions_profile_fk foreign key (household_id, profile_id)
    references public.financial_profiles (household_id, id),
  constraint transactions_account_fk foreign key (household_id, account_id)
    references public.accounts (household_id, id),
  constraint transactions_to_account_fk foreign key (household_id, to_account_id)
    references public.accounts (household_id, id),
  constraint transactions_card_fk foreign key (household_id, card_id)
    references public.credit_cards (household_id, id),
  constraint transactions_invoice_fk foreign key (household_id, invoice_id)
    references public.card_invoices (household_id, id),
  constraint transactions_category_fk foreign key (household_id, category_id)
    references public.categories (household_id, id),
  constraint transactions_installment_purchase_fk foreign key (household_id, installment_purchase_id)
    references public.installment_purchases (household_id, id),

  -- Formato por tipo (o que cada tipo exige/proíbe)
  constraint transactions_kind_shape check (
    case kind
      when 'income' then
        account_id is not null and to_account_id is null and card_id is null and invoice_id is null and category_id is not null
      when 'expense' then
        account_id is not null and to_account_id is null and card_id is null and invoice_id is null and category_id is not null
      when 'credit_card_purchase' then
        account_id is null and to_account_id is null and card_id is not null and invoice_id is not null and category_id is not null
      when 'transfer' then
        account_id is not null and to_account_id is not null and account_id <> to_account_id
        and card_id is null and invoice_id is null and category_id is null
      when 'card_payment' then
        account_id is not null and to_account_id is null and card_id is not null and invoice_id is not null and category_id is null
      when 'debt_payment' then
        account_id is not null and to_account_id is null and card_id is null and invoice_id is null
      when 'investment' then
        account_id is not null and to_account_id is not null and account_id <> to_account_id and card_id is null and invoice_id is null
      when 'redemption' then
        account_id is not null and to_account_id is not null and account_id <> to_account_id and card_id is null and invoice_id is null
      else false
    end
  ),
  -- Status x paid_at. Compra no cartão NUNCA é "paid" (quem quita é o pagamento da fatura);
  -- pagamento de fatura é sempre "paid".
  constraint transactions_paid_consistency check (
    case
      when kind = 'credit_card_purchase' then status <> 'paid' and paid_at is null
      when kind = 'card_payment' then status = 'paid' and paid_at is not null
      else (status = 'paid') = (paid_at is not null)
    end
  ),
  constraint transactions_installment_pair check ((installment_purchase_id is null) = (installment_number is null)),
  constraint transactions_installment_only_card_purchase check (installment_purchase_id is null or kind = 'credit_card_purchase')
);
comment on table public.transactions is
  'Movimentações. Únicas a entrar em somas. Parcela = linha com installment_purchase_id. Saldo/fatura/limite são derivados em views.';

-- Índices (FKs compostas começam por household_id; também servem às views e à RLS)
create unique index transactions_installment_key on public.transactions (installment_purchase_id, installment_number)
  where installment_purchase_id is not null;
create index transactions_household_date_idx on public.transactions (household_id, date desc);
create index transactions_household_profile_date_idx on public.transactions (household_id, profile_id, date desc);
create index transactions_household_open_idx on public.transactions (household_id, status, date)
  where status in ('planned', 'pending');
create index transactions_account_idx on public.transactions (household_id, account_id, date);
create index transactions_to_account_idx on public.transactions (household_id, to_account_id);
create index transactions_card_idx on public.transactions (household_id, card_id, date);
create index transactions_invoice_idx on public.transactions (household_id, invoice_id);
create index transactions_category_idx on public.transactions (household_id, category_id);
create index transactions_installment_purchase_idx on public.transactions (household_id, installment_purchase_id);
create index transactions_created_by_idx on public.transactions (created_by);

-- ================== helpers internos ==================

-- Total das compras e total pago de uma fatura. Interno (usado só por triggers SECURITY DEFINER).
create or replace function private.invoice_amounts(p_invoice_id uuid)
returns table (total_cents bigint, paid_cents bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(t.amount_cents) filter (where t.kind = 'credit_card_purchase' and t.status <> 'canceled'), 0)::bigint,
    coalesce(sum(t.amount_cents) filter (where t.kind = 'card_payment' and t.status = 'paid'), 0)::bigint
  from public.transactions t
  where t.invoice_id = p_invoice_id;
$$;
revoke all on function private.invoice_amounts(uuid) from public, anon, authenticated;

-- A fatura está totalmente paga? (com checagem de membro: usada pelas RPCs como invoker)
create or replace function private.invoice_is_paid(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select a.total_cents > 0 and a.paid_cents >= a.total_cents
    from public.card_invoices i
    cross join lateral private.invoice_amounts(i.id) a
    where i.id = p_invoice_id and private.is_member(i.household_id)
  ), false);
$$;
revoke all on function private.invoice_is_paid(uuid) from public, anon;
grant execute on function private.invoice_is_paid(uuid) to authenticated;

-- ================== triggers ==================

-- (a) Validações de domínio. Também trava a fatura (FOR UPDATE) antes de conferir o pagamento.
create or replace function private.validate_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat_kind public.category_kind;
  v_inv record;
  v_total bigint;
  v_paid bigint;
  v_ip record;
begin
  if not (select private.can_write(new.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.kind <> old.kind then
    raise exception 'transaction_kind_immutable' using errcode = 'P0001';
  end if;

  -- categoria compatível com o tipo (receita x despesa)
  if new.category_id is not null then
    select c.kind into v_cat_kind
      from public.categories c where c.household_id = new.household_id and c.id = new.category_id;
    if found and (
      (new.kind = 'income' and v_cat_kind = 'expense')
      or (new.kind in ('expense', 'credit_card_purchase', 'debt_payment') and v_cat_kind = 'income')
    ) then
      raise exception 'category_kind_mismatch' using errcode = 'P0001';
    end if;
  end if;

  -- pagamento de fatura: fatura do MESMO cartão e nunca acima do valor em aberto
  if new.kind = 'card_payment' then
    select i.* into v_inv
      from public.card_invoices i
     where i.household_id = new.household_id and i.id = new.invoice_id
       for update;
    if not found or v_inv.card_id is distinct from new.card_id then
      raise exception 'payment_invoice_mismatch' using errcode = 'P0001';
    end if;
    select a.total_cents, a.paid_cents into v_total, v_paid from private.invoice_amounts(new.invoice_id) a;
    if tg_op = 'UPDATE' and old.kind = 'card_payment' and old.status = 'paid' and old.invoice_id = new.invoice_id then
      v_paid := v_paid - old.amount_cents; -- o pagamento antigo já está somado
    end if;
    if new.amount_cents > v_total - v_paid then
      raise exception 'payment_exceeds_open' using errcode = 'P0001';
    end if;
  end if;

  -- parcela: mesmo cartão da compra e número dentro do total
  if new.installment_purchase_id is not null then
    select p.card_id, p.installments_count into v_ip
      from public.installment_purchases p
     where p.household_id = new.household_id and p.id = new.installment_purchase_id;
    if not found or v_ip.card_id is distinct from new.card_id then
      raise exception 'installment_card_mismatch' using errcode = 'P0001';
    end if;
    if new.installment_number > v_ip.installments_count then
      raise exception 'installment_number_out_of_range' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;
revoke all on function private.validate_transaction() from public, anon, authenticated;

-- (b) Compra no cartão: o BANCO decide a fatura (invoice_cycle). O invoice_id enviado pelo cliente é ignorado.
create or replace function private.assign_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card record;
  v_cycle record;
begin
  if new.kind <> 'credit_card_purchase' then
    return new;
  end if;

  -- edição que não muda data nem cartão mantém a fatura (e o retrato de datas dela)
  if tg_op = 'UPDATE' and old.invoice_id is not null
     and new.date is not distinct from old.date and new.card_id is not distinct from old.card_id then
    new.invoice_id := old.invoice_id;
    return new;
  end if;

  if not (select private.can_write(new.household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select c.closing_day, c.due_day into v_card
    from public.credit_cards c where c.household_id = new.household_id and c.id = new.card_id;
  if not found then
    raise exception 'card_not_found' using errcode = '23503';
  end if;

  select * into v_cycle from public.invoice_cycle(v_card.closing_day, v_card.due_day, new.date);

  insert into public.card_invoices (household_id, card_id, due_month, closing_date, due_date)
  values (new.household_id, new.card_id, v_cycle.due_month, v_cycle.closing_date, v_cycle.due_date)
  on conflict (card_id, due_month) do nothing;

  select i.id into new.invoice_id
    from public.card_invoices i where i.card_id = new.card_id and i.due_month = v_cycle.due_month;
  return new;
end;
$$;
revoke all on function private.assign_invoice() from public, anon, authenticated;

-- (c) Compra de fatura totalmente paga fica travada (editar/cancelar/excluir). Para mexer, exclua o pagamento.
-- (Versão final em 20261006181443: não bloqueia a exclusão em cascata do household.)
create or replace function private.guard_paid_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_paid bigint;
begin
  if old.kind = 'credit_card_purchase' and old.status <> 'canceled' and old.invoice_id is not null then
    perform 1 from public.card_invoices i where i.id = old.invoice_id for update;
    select a.total_cents, a.paid_cents into v_total, v_paid from private.invoice_amounts(old.invoice_id) a;
    if v_total > 0 and v_paid >= v_total then
      raise exception 'invoice_paid_locked' using errcode = 'P0001';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_paid_invoice() from public, anon, authenticated;

-- (d) Invariante final (adiada para o COMMIT): pagamentos nunca excedem as compras da fatura.
create or replace function private.check_invoice_not_overpaid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := '{}';
  v_id uuid;
  v_total bigint;
  v_paid bigint;
begin
  if tg_op <> 'DELETE' and new.invoice_id is not null then v_ids := array_append(v_ids, new.invoice_id); end if;
  if tg_op <> 'INSERT' and old.invoice_id is not null then v_ids := array_append(v_ids, old.invoice_id); end if;
  foreach v_id in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_ids) x) loop
    select a.total_cents, a.paid_cents into v_total, v_paid from private.invoice_amounts(v_id) a;
    if v_paid > v_total then
      raise exception 'invoice_overpaid' using errcode = 'P0001';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.check_invoice_not_overpaid() from public, anon, authenticated;

-- (e) Fatura sem nenhuma movimentação some (higiene; o ciclo é recriado quando preciso).
create or replace function private.cleanup_empty_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.invoice_id is not null and (tg_op = 'DELETE' or new.invoice_id is distinct from old.invoice_id) then
    begin
      delete from public.card_invoices i
       where i.id = old.invoice_id
         and not exists (select 1 from public.transactions t where t.invoice_id = i.id);
    exception when foreign_key_violation then
      null; -- outra transação acabou de usar a fatura: mantém
    end;
  end if;
  return null;
end;
$$;
revoke all on function private.cleanup_empty_invoice() from public, anon, authenticated;

-- Ordem (alfabética nos BEFORE): guard -> validate -> assign -> prevent_tenant_change -> set_updated_at
create trigger a_guard_paid_invoice before update or delete on public.transactions
  for each row execute function private.guard_paid_invoice();
create trigger b_validate_transaction before insert or update on public.transactions
  for each row execute function private.validate_transaction();
create trigger c_assign_invoice before insert or update on public.transactions
  for each row execute function private.assign_invoice();
create trigger prevent_tenant_change before update on public.transactions
  for each row execute function private.prevent_tenant_change();
create trigger set_updated_at before update on public.transactions
  for each row execute function private.set_updated_at();
-- (Versão final em 20261006181905: dispara em qualquer UPDATE, não só "UPDATE OF invoice_id".)
create trigger z_cleanup_empty_invoice after delete or update of invoice_id on public.transactions
  for each row execute function private.cleanup_empty_invoice();
create constraint trigger check_invoice_not_overpaid after insert or update or delete on public.transactions
  deferrable initially deferred
  for each row execute function private.check_invoice_not_overpaid();

-- ================== RLS ==================
alter table public.transactions enable row level security;
revoke all on public.transactions from anon, authenticated;
grant select, insert, update, delete on public.transactions to authenticated;

create policy transactions_select on public.transactions
  for select to authenticated using ((select private.is_member(household_id)));
create policy transactions_insert on public.transactions
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy transactions_update on public.transactions
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));
create policy transactions_delete on public.transactions
  for delete to authenticated using ((select private.can_write(household_id)));
