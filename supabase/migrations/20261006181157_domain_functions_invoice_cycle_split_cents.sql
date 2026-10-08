-- Bloco 3 / migration 9: funções de domínio PURAS no banco (espelham o motor TypeScript).
-- invoice_cycle ........ qual fatura recebe uma compra (fechamento, vencimento, mês de vencimento)
-- split_cents .......... divide centavos sem perda (resto, 1 centavo por vez, para as primeiras parcelas)
-- normalize_tags ....... mesma normalização de lib/tags.ts (sem "#", sem duplicadas, máx. 10 de 30 caracteres)

-- Fatura de uma compra.
--  * compra até o dia de fechamento (inclusive) cai na fatura que fecha neste mês; depois, na do mês seguinte;
--  * vencimento: se due_day > closing_day, é no mesmo mês do fechamento; senão, no mês seguinte;
--  * dias maiores que o mês são limitados ao último dia (ex.: dia 31 em fevereiro).
create or replace function public.invoice_cycle(p_closing_day integer, p_due_day integer, p_purchase_date date)
returns table (closing_date date, due_date date, due_month date)
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select
    least(b.close_start + (p_closing_day - 1), (b.close_start + interval '1 month' - interval '1 day')::date) as closing_date,
    least(b.due_start   + (p_due_day - 1),     (b.due_start   + interval '1 month' - interval '1 day')::date) as due_date,
    b.due_start as due_month
  from (
    select
      (date_trunc('month', p_purchase_date::timestamp)
         + case when extract(day from p_purchase_date) > p_closing_day then interval '1 month' else interval '0' end)::date as close_start,
      (date_trunc('month', p_purchase_date::timestamp)
         + case when extract(day from p_purchase_date) > p_closing_day then interval '1 month' else interval '0' end
         + case when p_due_day <= p_closing_day then interval '1 month' else interval '0' end)::date as due_start
  ) b;
$$;
comment on function public.invoice_cycle(integer, integer, date) is
  'Ciclo da fatura de uma compra. Paridade com invoiceCycle (domain/calculations.ts).';

-- Divide um valor em centavos em N parcelas cuja soma é EXATAMENTE o total.
-- 100000 / 3 -> {33334,33333,33333}
create or replace function public.split_cents(p_total_cents bigint, p_parts integer)
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base bigint;
  v_rem bigint;
begin
  if p_total_cents is null or p_parts is null or p_total_cents < 0 or p_parts < 1 then
    raise exception 'invalid_split' using errcode = '22023';
  end if;
  v_base := p_total_cents / p_parts;
  v_rem := p_total_cents % p_parts;
  return array(
    select v_base + (case when g.i <= v_rem then 1 else 0 end)
    from generate_series(1, p_parts) as g(i)
    order by g.i
  );
end;
$$;
comment on function public.split_cents(bigint, integer) is
  'Divisão de centavos sem perda. Paridade com splitCents (domain/installments.ts).';

-- Tags: remove "#" inicial, normaliza espaços, limita a 30 caracteres, ignora vazias e duplicadas
-- (sem diferenciar maiúsculas; a 1ª grafia vence), máximo de 10, preservando a ordem.
create or replace function private.normalize_tags(p_tags text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(
    select d.tag
    from (
      select distinct on (lower(c.tag)) c.tag, c.ord
      from (
        select left(btrim(regexp_replace(regexp_replace(u.x, '^#+', ''), '\s+', ' ', 'g')), 30) as tag, u.ord
        from unnest(coalesce(p_tags, '{}'::text[])) with ordinality as u(x, ord)
      ) c
      where c.tag <> ''
      order by lower(c.tag), c.ord
    ) d
    order by d.ord
    limit 10
  ), '{}'::text[]);
$$;

revoke all on function public.invoice_cycle(integer, integer, date) from public, anon;
revoke all on function public.split_cents(bigint, integer) from public, anon;
grant execute on function public.invoice_cycle(integer, integer, date) to authenticated;
grant execute on function public.split_cents(bigint, integer) to authenticated;
revoke all on function private.normalize_tags(text[]) from public, anon;
grant execute on function private.normalize_tags(text[]) to authenticated;
