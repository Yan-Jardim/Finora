-- Higiene: funções de trigger não precisam de EXECUTE para anon/authenticated/PUBLIC.
revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.prevent_tenant_change() from public, anon, authenticated;
