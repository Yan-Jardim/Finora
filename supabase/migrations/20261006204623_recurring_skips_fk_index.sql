-- Recorrências / migration 3: índice cobrindo a FK composta de recurring_skips (advisor: unindexed_foreign_keys).
create index recurring_skips_household_recurring_idx on public.recurring_skips (household_id, recurring_transaction_id);
