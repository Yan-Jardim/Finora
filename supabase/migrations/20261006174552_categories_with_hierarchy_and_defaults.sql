-- Bloco 2 / migration 4: categories (1 nível de subcategoria) + seed_default_categories.
-- RLS é ligado na criação. FK composta (household_id, parent_id) impede pai de outro household.

create type public.category_kind as enum ('income', 'expense', 'both');

create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  parent_id     uuid,
  name          text not null check (char_length(btrim(name)) between 1 and 40),
  kind          public.category_kind not null default 'expense',
  icon          text not null default 'more' check (char_length(icon) between 1 and 40),
  color         text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active     boolean not null default true,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- alvo das FKs compostas das próximas tabelas (impede referência entre households)
  constraint categories_household_id_id_key unique (household_id, id),
  -- o pai precisa existir no MESMO household (parent_id nulo = categoria principal)
  constraint categories_parent_fk foreign key (household_id, parent_id)
    references public.categories (household_id, id),
  constraint categories_not_own_parent check (parent_id is null or parent_id <> id)
);
comment on table public.categories is 'Categorias do household. Só 1 nível de subcategoria (parent_id aponta para uma categoria raiz).';

-- nome único por nível (raiz ou dentro do mesmo pai), ignorando maiúsculas
create unique index categories_household_parent_name_key
  on public.categories (household_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index categories_household_parent_idx on public.categories (household_id, parent_id);
create index categories_created_by_idx on public.categories (created_by);

create trigger set_updated_at before update on public.categories
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_change before update on public.categories
  for each row execute function private.prevent_tenant_change();

-- Regras de hierarquia: pai precisa ser raiz; tipo compatível com o pai; quem tem filhos não vira filho.
create or replace function private.validate_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent record;
begin
  if new.parent_id is not null then
    select c.parent_id, c.kind into v_parent
      from public.categories c
     where c.household_id = new.household_id and c.id = new.parent_id;
    if not found then
      raise exception 'category_parent_not_found' using errcode = '23503';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'category_parent_must_be_root' using errcode = 'P0001';
    end if;
    if v_parent.kind <> 'both' and new.kind <> v_parent.kind then
      raise exception 'category_kind_incompatible' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' and exists (
      select 1 from public.categories c where c.household_id = new.household_id and c.parent_id = new.id
    ) then
      raise exception 'category_has_children' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_category() from public, anon, authenticated;

create trigger validate_category before insert or update on public.categories
  for each row execute function private.validate_category();

-- Mudar o tipo de uma categoria raiz propaga o novo tipo às subcategorias (se não for 'both').
create or replace function private.propagate_category_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is null and new.kind <> 'both' and new.kind is distinct from old.kind then
    update public.categories c
       set kind = new.kind
     where c.household_id = new.household_id and c.parent_id = new.id and c.kind <> new.kind;
  end if;
  return null;
end;
$$;
revoke all on function private.propagate_category_kind() from public, anon, authenticated;

create trigger propagate_category_kind after update of kind on public.categories
  for each row execute function private.propagate_category_kind();

-- RLS + privilégios mínimos
alter table public.categories enable row level security;
revoke all on public.categories from anon, authenticated;
grant select, insert, update, delete on public.categories to authenticated;

create policy categories_select on public.categories
  for select to authenticated using ((select private.is_member(household_id)));
create policy categories_insert on public.categories
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy categories_update on public.categories
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));
create policy categories_delete on public.categories
  for delete to authenticated using ((select private.can_write(household_id)));

-- Categorias iniciais (as mesmas do app). Idempotente: só semeia household sem nenhuma categoria.
-- SECURITY INVOKER: respeita RLS; exige permissão de escrita no household.
create or replace function public.seed_default_categories(p_household_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (select private.can_write(p_household_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from public.categories c where c.household_id = p_household_id) then
    return 0;
  end if;

  insert into public.categories (household_id, name, kind, icon, color)
  select p_household_id, v.name, v.kind::public.category_kind, v.icon, v.color
  from (values
    ('Moradia',     'expense', 'home',           '#6366f1'),
    ('Alimentação', 'expense', 'utensils',       '#f97316'),
    ('Mercado',     'expense', 'shopping-cart',  '#16a34a'),
    ('Transporte',  'expense', 'car',            '#0ea5e9'),
    ('Saúde',       'expense', 'heart-pulse',    '#dc2626'),
    ('Educação',    'expense', 'graduation-cap', '#8a05be'),
    ('Lazer',       'expense', 'gamepad',        '#db2777'),
    ('Viagem',      'expense', 'plane',          '#0d9488'),
    ('Assinaturas', 'expense', 'repeat',         '#8a05be'),
    ('Dívidas',     'expense', 'landmark',       '#64748b'),
    ('Presentes',   'expense', 'gift',           '#db2777'),
    ('Roupas',      'expense', 'shirt',          '#8a05be'),
    ('Família',     'expense', 'users',          '#f59e0b'),
    ('Outros',      'both',    'more',           '#64748b'),
    ('Salário',     'income',  'briefcase',      '#16a34a'),
    ('Freelance',   'income',  'briefcase',      '#0d9488'),
    ('Rendimentos', 'income',  'trending-up',    '#0d9488')
  ) as v(name, kind, icon, color);

  insert into public.categories (household_id, parent_id, name, kind, icon, color)
  select p_household_id, p.id, s.name, 'expense', p.icon, p.color
  from (values
    ('Moradia', 'Aluguel'), ('Moradia', 'Energia'), ('Moradia', 'Água'), ('Moradia', 'Internet'),
    ('Alimentação', 'Restaurante'), ('Alimentação', 'Delivery')
  ) as s(parent_name, name)
  join public.categories p
    on p.household_id = p_household_id and p.parent_id is null and p.name = s.parent_name;

  select count(*) into v_count from public.categories c where c.household_id = p_household_id;
  return v_count;
end;
$$;
comment on function public.seed_default_categories(uuid) is 'Cria as categorias iniciais se o household ainda não tem nenhuma.';
revoke all on function public.seed_default_categories(uuid) from public, anon;
grant execute on function public.seed_default_categories(uuid) to authenticated;
