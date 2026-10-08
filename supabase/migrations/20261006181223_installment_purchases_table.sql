-- Bloco 3 / migration 12: installment_purchases = SOMENTE agrupador das parcelas.
-- Parcela é Transaction; esta tabela NUNCA entra em somas (evita contar compra + parcelas).
create table public.installment_purchases (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  card_id             uuid not null,
  profile_id          uuid not null,
  category_id         uuid,
  description         text not null check (char_length(btrim(description)) between 1 and 80),
  total_cents         bigint not null check (total_cents > 0 and total_cents <= 100000000000000),
  installments_count  smallint not null check (installments_count between 2 and 48),
  purchase_date       date not null,
  notes               text check (notes is null or char_length(notes) <= 300),
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint installment_purchases_household_id_id_key unique (household_id, id),
  constraint installment_purchases_card_fk foreign key (household_id, card_id)
    references public.credit_cards (household_id, id),
  constraint installment_purchases_profile_fk foreign key (household_id, profile_id)
    references public.financial_profiles (household_id, id),
  constraint installment_purchases_category_fk foreign key (household_id, category_id)
    references public.categories (household_id, id)
);
comment on table public.installment_purchases is
  'Agrupador de parcelas. Valores contábeis ficam nas parcelas (transactions). NUNCA somar esta tabela.';

create index installment_purchases_household_card_idx on public.installment_purchases (household_id, card_id);
create index installment_purchases_household_profile_idx on public.installment_purchases (household_id, profile_id);
create index installment_purchases_household_category_idx on public.installment_purchases (household_id, category_id);
create index installment_purchases_created_by_idx on public.installment_purchases (created_by);

create trigger set_updated_at before update on public.installment_purchases
  for each row execute function private.set_updated_at();
create trigger prevent_tenant_change before update on public.installment_purchases
  for each row execute function private.prevent_tenant_change();

alter table public.installment_purchases enable row level security;
revoke all on public.installment_purchases from anon, authenticated;
grant select, insert, update, delete on public.installment_purchases to authenticated;

create policy installment_purchases_select on public.installment_purchases
  for select to authenticated using ((select private.is_member(household_id)));
create policy installment_purchases_insert on public.installment_purchases
  for insert to authenticated with check ((select private.can_write(household_id)));
create policy installment_purchases_update on public.installment_purchases
  for update to authenticated
  using ((select private.can_write(household_id)))
  with check ((select private.can_write(household_id)));
create policy installment_purchases_delete on public.installment_purchases
  for delete to authenticated using ((select private.can_write(household_id)));
