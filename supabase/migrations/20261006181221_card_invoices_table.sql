-- Bloco 3 / migration 11: card_invoices = SOMENTE o ciclo da fatura.
-- NÃO guarda total, valor pago nem em aberto: tudo isso é derivado (view v_card_invoice_totals).
-- Escrita só pelo banco (função/trigger SECURITY DEFINER): clientes têm apenas SELECT.
create table public.card_invoices (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  card_id       uuid not null,
  -- 1º dia do mês de vencimento: identifica a fatura do cartão
  due_month     date not null check (due_month = date_trunc('month', due_month::timestamp)::date),
  closing_date  date not null,
  due_date      date not null,
  created_at    timestamptz not null default now(),
  constraint card_invoices_household_id_id_key unique (household_id, id),
  constraint card_invoices_card_month_key unique (card_id, due_month),
  -- fatura some junto com o cartão (se não houver movimentações; elas bloqueiam a exclusão)
  constraint card_invoices_card_fk foreign key (household_id, card_id)
    references public.credit_cards (household_id, id) on delete cascade,
  constraint card_invoices_dates_check check (
    closing_date <= due_date and date_trunc('month', due_date::timestamp)::date = due_month
  )
);
comment on table public.card_invoices is
  'Ciclo da fatura (fechamento/vencimento). Datas são um retrato do cartão na criação. Valores são DERIVADOS (v_card_invoice_totals).';

create index card_invoices_household_card_idx on public.card_invoices (household_id, card_id);

alter table public.card_invoices enable row level security;
revoke all on public.card_invoices from anon, authenticated;
grant select on public.card_invoices to authenticated;

-- Somente leitura para membros. Sem policies de escrita: nenhum cliente cria/edita/apaga faturas.
create policy card_invoices_select on public.card_invoices
  for select to authenticated using ((select private.is_member(household_id)));
