-- Bloco 3 / migration 10: tags (por household, nome único ignorando maiúsculas). RLS desde a criação.
create table public.tags (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 30 and name !~ '^#'),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint tags_household_id_id_key unique (household_id, id)
);
comment on table public.tags is 'Tags livres por household. A ligação com movimentações é transaction_tags.';

create unique index tags_household_name_key on public.tags (household_id, lower(name));
create index tags_created_by_idx on public.tags (created_by);

create trigger set_updated_at before update on public.tags
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_change before update on public.tags
  for each row execute function private.prevent_tenant_change();

alter table public.tags enable row level security;
revoke all on public.tags from anon, authenticated;
grant select, insert, update, delete on public.tags to authenticated;

create policy tags_select on public.tags
  for select to authenticated using ((select private.is_member(household_id)));
create policy tags_insert on public.tags
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy tags_update on public.tags
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));
create policy tags_delete on public.tags
  for delete to authenticated using ((select private.can_write(household_id)));
