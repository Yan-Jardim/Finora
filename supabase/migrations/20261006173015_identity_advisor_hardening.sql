-- Hardening pós-advisors (bloco 1).
-- 1) rls_auto_enable() é uma função pré-existente do projeto (event trigger que liga RLS em tabelas novas).
--    Event triggers não dependem de EXECUTE de anon/authenticated; revogamos a exposição via /rest/v1/rpc.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

-- 2) Índices de cobertura para FKs created_by (evita varredura em ON DELETE SET NULL).
create index if not exists households_created_by_idx on public.households (created_by);
create index if not exists financial_profiles_created_by_idx on public.financial_profiles (created_by);
