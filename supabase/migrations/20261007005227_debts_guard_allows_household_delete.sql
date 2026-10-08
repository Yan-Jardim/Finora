-- Dívidas / migration 3: o dono precisa conseguir excluir o household inteiro (cascata) mesmo com dívida quitada.
-- (Descoberto no teste E2E: o guard de exclusão de pagamento de dívida quitada disparava na cascata.)
create or replace function private.guard_debt_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (old.debt_id is not null or new.debt_id is not null)
       and (new.amount_cents, new.date, new.status, new.paid_at, new.account_id, new.debt_id, new.kind)
           is distinct from (old.amount_cents, old.date, old.status, old.paid_at, old.account_id, old.debt_id, old.kind) then
      raise exception 'use_debt_flow' using errcode = '22023';
    end if;
    return new;
  end if;

  -- Excluir pagamento de dívida QUITADA é recusado, exceto na exclusão em CASCATA do household (o household já não
  -- existe nesse ponto): o dono precisa conseguir apagar o espaço inteiro.
  if old.debt_id is not null
     and exists (select 1 from public.households h where h.id = old.household_id)
     and exists (select 1 from public.debts d where d.id = old.debt_id and d.settled_at is not null) then
    raise exception 'debt_settled_locked' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_debt_payment() from public, anon, authenticated;
