-- Bloco 3 / migration 14: transaction_tags (N:N entre movimentações e tags, sempre do mesmo household).
create table public.transaction_tags (
  household_id    uuid not null references public.households (id) on delete cascade,
  transaction_id  uuid not null,
  tag_id          uuid not null,
  created_at      timestamptz not null default now(),
  primary key (transaction_id, tag_id),
  constraint transaction_tags_transaction_fk foreign key (household_id, transaction_id)
    references public.transactions (household_id, id) on delete cascade,
  constraint transaction_tags_tag_fk foreign key (household_id, tag_id)
    references public.tags (household_id, id) on delete cascade
);
comment on table public.transaction_tags is 'Tags de cada movimentação (estruturadas, nunca uma string única).';

create index transaction_tags_household_transaction_idx on public.transaction_tags (household_id, transaction_id);
create index transaction_tags_household_tag_idx on public.transaction_tags (household_id, tag_id);

alter table public.transaction_tags enable row level security;
revoke all on public.transaction_tags from anon, authenticated;
grant select, insert, delete on public.transaction_tags to authenticated;

create policy transaction_tags_select on public.transaction_tags
  for select to authenticated using ((select private.is_member(household_id)));
create policy transaction_tags_insert on public.transaction_tags
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy transaction_tags_delete on public.transaction_tags
  for delete to authenticated using ((select private.can_write(household_id)));
