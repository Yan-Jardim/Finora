-- Bloco 3 / migration 15: views financeiras (valores DERIVADOS, nunca gravados).
-- security_invoker = true: as views respeitam o RLS de quem consulta.

-- Saldo atual = saldo inicial + movimentações PAGAS (compra no cartão nunca move saldo).
create view public.v_account_balances with (security_invoker = true) as
select
  a.id as account_id,
  a.household_id,
  a.initial_balance_cents,
  (a.initial_balance_cents + coalesce(o.cents, 0) + coalesce(i.cents, 0))::bigint as balance_cents
from public.accounts a
left join lateral (
  -- saída da conta (ou entrada, se for receita)
  select sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end) as cents
  from public.transactions t
  where t.household_id = a.household_id and t.account_id = a.id
    and t.status = 'paid' and t.kind <> 'credit_card_purchase'
) o on true
left join lateral (
  -- entrada por transferência / resgate / investimento
  select sum(t.amount_cents) as cents
  from public.transactions t
  where t.household_id = a.household_id and t.to_account_id = a.id and t.status = 'paid'
) i on true;
comment on view public.v_account_balances is 'Saldo atual por conta, derivado. Paridade com accountBalance (domain/calculations.ts).';

-- Totais da fatura: compras (não canceladas), pagamentos e valor em aberto.
create view public.v_card_invoice_totals with (security_invoker = true) as
select
  i.id as invoice_id,
  i.household_id,
  i.card_id,
  i.due_month,
  i.closing_date,
  i.due_date,
  coalesce(p.cents, 0)::bigint as total_cents,
  coalesce(pay.cents, 0)::bigint as paid_cents,
  greatest(coalesce(p.cents, 0) - coalesce(pay.cents, 0), 0)::bigint as open_cents,
  (coalesce(p.cents, 0) > 0 and coalesce(p.cents, 0) - coalesce(pay.cents, 0) <= 0) as is_paid
from public.card_invoices i
left join lateral (
  select sum(t.amount_cents) as cents
  from public.transactions t
  where t.household_id = i.household_id and t.invoice_id = i.id
    and t.kind = 'credit_card_purchase' and t.status <> 'canceled'
) p on true
left join lateral (
  select sum(t.amount_cents) as cents
  from public.transactions t
  where t.household_id = i.household_id and t.invoice_id = i.id
    and t.kind = 'card_payment' and t.status = 'paid'
) pay on true;
comment on view public.v_card_invoice_totals is 'Totais derivados por fatura. Paridade com cardInvoices (domain/calculations.ts).';

-- Limite usado = compras já realizadas (parcelas incluídas, mesmo as futuras) menos pagamentos de fatura.
-- "Hoje" usa o fuso do household. Compra apenas prevista não consome limite.
create view public.v_card_usage with (security_invoker = true) as
select
  c.id as card_id,
  c.household_id,
  c.limit_cents,
  greatest(coalesce(pu.cents, 0) - coalesce(pa.cents, 0), 0)::bigint as used_cents,
  (c.limit_cents - greatest(coalesce(pu.cents, 0) - coalesce(pa.cents, 0), 0))::bigint as available_cents
from public.credit_cards c
join public.households h on h.id = c.household_id
left join lateral (
  select sum(t.amount_cents) as cents
  from public.transactions t
  left join public.installment_purchases ip
    on ip.household_id = t.household_id and ip.id = t.installment_purchase_id
  where t.household_id = c.household_id and t.card_id = c.id
    and t.kind = 'credit_card_purchase' and t.status <> 'canceled'
    and coalesce(ip.purchase_date, t.date) <= (now() at time zone h.timezone)::date
) pu on true
left join lateral (
  select sum(t.amount_cents) as cents
  from public.transactions t
  where t.household_id = c.household_id and t.card_id = c.id
    and t.kind = 'card_payment' and t.status = 'paid'
) pa on true;
comment on view public.v_card_usage is 'Limite usado/disponível por cartão, derivado. Paridade com cardUsedLimit (domain/calculations.ts).';

revoke all on public.v_account_balances, public.v_card_invoice_totals, public.v_card_usage from anon, authenticated;
grant select on public.v_account_balances, public.v_card_invoice_totals, public.v_card_usage to authenticated;
