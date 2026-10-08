-- Correção: a trava de fatura paga não deve impedir a exclusão em CASCATA do household inteiro
-- (nesse caso o household já não existe quando o trigger dispara, como em guard_last_owner).
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
  if old.kind = 'credit_card_purchase' and old.status <> 'canceled' and old.invoice_id is not null
     and exists (select 1 from public.households h where h.id = old.household_id) then
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
