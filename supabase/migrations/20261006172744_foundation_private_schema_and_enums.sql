-- Migration 1/3 (bloco 1: identidade e household)
-- Fundação: schema privado (não exposto pela API), enums e funções-base de trigger.
-- Extensões: nenhuma nova é necessária neste bloco (gen_random_uuid é nativo do Postgres;
-- citext será habilitada junto com household_invites, em bloco futuro).

create schema if not exists private;
comment on schema private is 'Funções internas (RLS, triggers). Não exposto pela Data API.';

-- Ninguém além do dono (postgres) usa o schema por padrão; o acesso é concedido explicitamente.
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

-- Enums do bloco 1. (Os demais enums entram junto com suas tabelas, nos próximos blocos.)
create type public.household_role as enum ('owner', 'member');
create type public.profile_kind   as enum ('individual', 'shared');

-- Mantém updated_at coerente.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- household_id e created_by nunca mudam depois de gravados (impede "mover" linhas entre households).
create or replace function private.prevent_tenant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if to_jsonb(new) ? 'household_id' and (to_jsonb(new)->>'household_id') is distinct from (to_jsonb(old)->>'household_id') then
    raise exception 'household_id é imutável' using errcode = '42501';
  end if;
  if to_jsonb(new) ? 'created_by' and (to_jsonb(new)->>'created_by') is distinct from (to_jsonb(old)->>'created_by') then
    raise exception 'created_by é imutável' using errcode = '42501';
  end if;
  return new;
end;
$$;
