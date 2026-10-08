-- payment_account_id passa a ser OPCIONAL: é apenas a conta PADRÃO sugerida para pagar a fatura.
-- A conta que de fato pagou uma fatura é a account_id da movimentação card_payment (bloco 3).
-- A FK composta (household_id, payment_account_id) continua valendo quando preenchida (MATCH SIMPLE ignora NULL).
alter table public.credit_cards alter column payment_account_id drop not null;

comment on column public.credit_cards.payment_account_id is
  'Conta PADRÃO sugerida para pagar a fatura (opcional). Quem registra o pagamento real é transactions.account_id do card_payment.';
