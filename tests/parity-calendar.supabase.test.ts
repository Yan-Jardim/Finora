/**
 * PARIDADE DO CALENDÁRIO: o mesmo cenário (receitas e contas recorrentes, parcelamento e recorrência no cartão, fatura com
 * pagamento parcial, dívida com parcela paga e atrasadas, conta atrasada, receita futura, transferência e despesa paga)
 * é montado no motor LOCAL e no SUPABASE REAL, e o calendário (`buildCalendar`) precisa ser IGUAL — no Supabase usando a
 * MESMA janela de consulta da tela (`calendarWindow`). Integração: só com o usuário descartável configurado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays as addDaysISO, buildCalendar, defaultCalendarFilters, type CalendarMonth } from "@/domain/calendar";
import { addMonths, yearMonth } from "@/domain/dates";
import { snapshotOf } from "@/domain/snapshot";
import { loadWorkspace } from "@/repositories/load-workspace";
import { calendarWindow } from "@/services/calendar-window";
import { addDays, ENABLED, input, makeLocal, makeSupabase, today, type Side, type SupabaseSide } from "./support/parity-harness";

const first = today.slice(0, 7);
const shift = (n: number) => yearMonth(addMonths(`${first}-01`, n));

/** Calendário sem ids (que diferem entre os lados). */
function normalize(c: CalendarMonth, range?: { from: string; to: string }) {
  const inRange = (date: string) => (range ? date >= range.from && date <= range.to : date.startsWith(c.month));
  const ev = (e: CalendarMonth["events"][number]) =>
    [e.type, e.direction, e.title, e.date, e.amountCents, e.status, e.recurring, e.installmentLabel ?? null, e.paidCents ?? null, e.totalCents ?? null, e.realizedExpense];
  const sort = (list: unknown[][]) => list.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    summary: c.summary,
    events: sort(c.events.map(ev)),
    carried: sort(c.carriedOverdue.map(ev)),
    upcoming: c.upcoming.map(ev),
    days: [...c.days.values()].filter((d) => inRange(d.date)).map((d) => [d.date, d.events.length, d.inCents, d.outCents, d.cardCents, d.overdue, d.open]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
}

describe.skipIf(!ENABLED)("paridade do calendário: motor local x Supabase (usuário descartável)", { timeout: 240_000 }, () => {
  let local: Side;
  let remote: Side;
  let sb: SupabaseSide;
  const both = async <T,>(fn: (s: Side) => Promise<T>) => {
    await fn(local);
    await fn(remote);
    await local.refresh();
    await remote.refresh();
  };
  const calOf = async (side: Side, month: string, profile = "all", week?: { from: string; to: string }) => {
    const data = side.name === "local" ? (await side.refresh(), side.data) : await loadWorkspace(sb.source, calendarWindow(month, today, week));
    return buildCalendar(data, month, { ...defaultCalendarFilters, profileId: profile === "all" ? "all" : side.ids.profile }, today);
  };

  beforeAll(async () => {
    local = makeLocal();
    sb = await makeSupabase();
    remote = sb.side;
    await local.refresh();

    const rec = { profileId: "", tags: [] as string[], frequency: "monthly" as const, interval: 1 };
    await both((s) => s.recurrence.create({ ...rec, profileId: s.ids.profile, kind: "income", description: "Salário", amountCents: 1000000, accountId: s.ids.accA, categoryId: s.ids.catSalario, startDate: addDays(today, 3) }));
    await both((s) => s.recurrence.create({ ...rec, profileId: s.ids.profile, kind: "expense", description: "Internet", amountCents: 12000, accountId: s.ids.accA, categoryId: s.ids.catMercado, startDate: addDays(today, 5) }));
    await both((s) => s.recurrence.create({ ...rec, profileId: s.ids.profile, kind: "credit_card_purchase", description: "Netflix", amountCents: 5590, cardId: s.ids.card, categoryId: s.ids.catLazer, startDate: today }));
    await both((s) => s.commands.create(input(s, { description: "IPTU", amountCents: 80000, date: addDays(today, 40), status: "planned", paidAt: undefined, accountId: s.ids.accA, categoryId: s.ids.catMercado })));
    await both((s) => s.commands.create(input(s, { description: "Conta atrasada", amountCents: 45000, date: addDays(today, -10), dueDate: addDays(today, -3), status: "pending", paidAt: undefined, accountId: s.ids.accA, categoryId: s.ids.catMercado })));
    await both((s) => s.commands.create(input(s, { kind: "income", description: "Bônus", amountCents: 300000, date: addDays(today, 40), status: "planned", paidAt: undefined, accountId: s.ids.accA, categoryId: s.ids.catSalario })));
    await both((s) => s.commands.create(input(s, { kind: "transfer", description: "Aporte", amountCents: 50000, date: addDays(today, 20), status: "planned", paidAt: undefined, accountId: s.ids.accA, toAccountId: s.ids.accInvest })));
    await both((s) => s.commands.create(input(s, { description: "Já paga", amountCents: 20000, accountId: s.ids.accA, categoryId: s.ids.catMercado })));
    await both((s) => s.commands.createInstallmentPurchase({ description: "TV", totalCents: 300001, installments: 6, date: addDays(today, -1), cardId: s.ids.card, profileId: s.ids.profile, categoryId: s.ids.catLazer, tags: [] }));
    await both(async (s) => {
      const id = await s.debt.create({ name: "Empréstimo", kind: "loan", profileId: s.ids.profile, principalCents: 800000, totalCents: 1030000, installments: 13, firstDueDate: addMonths(`${first}-12`, -3) });
      await s.debt.pay({ debtId: id, accountId: s.ids.accA, amountCents: 79231, date: today });
    });
    // pagamento PARCIAL da primeira fatura em aberto
    const open = snapshotOf(local.data, today).invoices.filter((i) => i.openCents > 20000).sort((a, b) => a.dueMonth.localeCompare(b.dueMonth))[0];
    await both((s) => s.commands.payInvoice({ cardId: s.ids.card, dueMonth: open.dueMonth, accountId: s.ids.accA, amountCents: 10000, date: today }));
  });
  afterAll(async () => {
    if (sb) await sb.cleanup();
  });

  it("mês anterior, atual, próximos e fim do horizonte: idênticos (todos e a pessoa)", async () => {
    for (const m of [-1, 0, 1, 2, 5]) {
      for (const profile of ["all", "me"]) {
        expect(normalize(await calOf(remote, shift(m), profile)), `mês ${shift(m)} perfil ${profile}`).toEqual(normalize(await calOf(local, shift(m), profile)));
      }
    }
  });

  it("semana que atravessa meses: mesma leitura nos dois lados", async () => {
    const start = addDaysISO(`${shift(1)}-01`, -3);
    const week = { from: start, to: addDaysISO(start, 6) };
    expect(normalize(await calOf(remote, shift(1), "all", week), week).days).toEqual(normalize(await calOf(local, shift(1), "all", week), week).days);
  });

  it("regras: fatura parcial, pagamento sem despesa, dívida sem duplicar, recorrência uma vez por mês", async () => {
    const c = await calOf(remote, first);
    const all = [...c.events, ...c.carriedOverdue];
    const months = await Promise.all([0, 1, 2, 3].map((n) => calOf(remote, shift(n))));
    expect(months.some((m) => m.events.some((e) => e.type === "invoice" && e.paidCents === 10000))).toBe(true);
    expect(c.events.find((e) => e.type === "card_payment")).toMatchObject({ direction: "neutral", realizedExpense: false });
    expect(all.filter((e) => e.type === "debt_payment")).toHaveLength(1);
    expect(all.filter((e) => e.title === "Internet")).toHaveLength(1);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    expect(c.events.find((e) => e.title === "Já paga")).toMatchObject({ status: "paid", realizedExpense: true });
  });
});
