-- Linhas inseridas na mesma instrução (seed das categorias) precisam manter a ordem de inserção.
-- now() é igual para toda a transação; clock_timestamp() avança por linha.
alter table public.categories alter column created_at set default clock_timestamp();
