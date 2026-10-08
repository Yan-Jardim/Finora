-- Correção: o trigger que remove faturas vazias usava "UPDATE OF invoice_id", que só dispara quando a coluna
-- aparece no SET do comando. Quem troca a fatura é o trigger assign_invoice (BEFORE), então precisa disparar em
-- qualquer UPDATE (a função já ignora quando invoice_id não mudou). Substituição no lugar, sem DROP.
create or replace trigger z_cleanup_empty_invoice after delete or update on public.transactions
  for each row execute function private.cleanup_empty_invoice();
