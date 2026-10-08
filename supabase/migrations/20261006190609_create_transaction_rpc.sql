-- Bloco 3 / migration 17: create_transaction = movimentação comum + tags NOVAS numa única transação.
-- Atômica: se qualquer etapa falhar (movimentação ou tags), nada persiste.
-- SECURITY INVOKER: RLS e FKs compostas valem. O household é DERIVADO do perfil financeiro informado (que o RLS só
-- deixa ver se o usuário for membro); conta, cartão e categoria de outro household caem nas FKs compostas.
-- Reaproveita (sem duplicar): triggers de validação/fatura (assign_invoice usa invoice_cycle), CHECKs de formato
-- por tipo e private.add_tags (normalização e limite de tags).
-- Tipos: income, expense, credit_card_purchase (à vista), transfer, debt_payment, investment, redemption.
--   * card_payment  -> use pay_invoice
--   * compra parcelada -> use create_installment_purchase
-- Status: obrigatório, exceto em credit_card_purchase (se omitido: pending se a data já chegou, senão planned;
--   a compra no cartão nunca é "paid"). paid_at: só com status paid (padrão = a data da movimentação).
create or replace function public.create_transaction(
  p_kind public.transaction_kind,
  p_description text,
  p_amount_cents bigint,
  p_date date,
  p_profile_id uuid,
  p_status public.transaction_status default null,
  p_account_id uuid default null,
  p_to_account_id uuid default null,
  p_card_id uuid default null,
  p_category_id uuid default null,
  p_due_date date default null,
  p_paid_at date default null,
  p_notes text default null,
  p_tags text[] default '{}'
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_household uuid;
  v_today date;
  v_status public.transaction_status;
  v_paid_at date;
  v_id uuid;
begin
  if p_kind = 'card_payment' then
    raise exception 'use_pay_invoice' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  select f.household_id into v_household from public.financial_profiles f where f.id = p_profile_id;
  if v_household is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if not (select private.can_write(v_household)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_today := private.household_today(v_household);

  if p_kind = 'credit_card_purchase' then
    v_status := coalesce(p_status, case when p_date <= v_today then 'pending' else 'planned' end::public.transaction_status);
  elsif p_status is null then
    raise exception 'status_required' using errcode = '22023';
  else
    v_status := p_status;
  end if;

  if v_status = 'paid' then
    v_paid_at := coalesce(p_paid_at, p_date);
  elsif p_paid_at is not null then
    raise exception 'invalid_paid_at' using errcode = '22023';
  end if;

  insert into public.transactions
    (household_id, kind, status, description, amount_cents, date, due_date, paid_at, profile_id,
     account_id, to_account_id, card_id, category_id, notes)
  values
    (v_household, p_kind, v_status, btrim(p_description), p_amount_cents, p_date, p_due_date, v_paid_at, p_profile_id,
     p_account_id, p_to_account_id, p_card_id, p_category_id, nullif(btrim(p_notes), ''))
  returning id into v_id;

  if cardinality(coalesce(p_tags, '{}')) > 0 then
    perform private.add_tags(array[v_id], v_household, p_tags);
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_transaction(public.transaction_kind, text, bigint, date, uuid, public.transaction_status, uuid, uuid, uuid, uuid, date, date, text, text[]) from public, anon;
grant execute on function public.create_transaction(public.transaction_kind, text, bigint, date, uuid, public.transaction_status, uuid, uuid, uuid, uuid, date, date, text, text[]) to authenticated;
