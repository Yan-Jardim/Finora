/**
 * PARIDADE DE RELATÓRIOS: o mesmo roteiro roda no motor LOCAL e no SUPABASE REAL (views + RPCs) e o MESMO motor de
 * relatórios (domain/reports) precisa devolver números IGUAIS: visão geral, receitas, consumo por categoria, fluxo de
 * caixa, cartões, dívidas, patrimônio, cofrinhos e a comparação pessoa/Casal/consolidado. Também prova que a janela
 * `paidBetween` do Supabase traz o que foi pago no período com competência anterior (conta velha paga hoje).
 * Integração: só com o usuário descartável (veja tests/support/parity-harness.ts); sem ele, é pulado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMonths, monthEnd, monthStart } from "@/domain/dates";
import { periodFor, previousPeriod, type Period } from "@/domain/report-periods";
import { buildReport, defaultFilters, type Report, type ReportFilters } from "@/domain/reports";
import { loadWorkspace } from "@/repositories/load-workspace";
import { addDays, ENABLED, input, makeLocal, makeSupabase, today, type Side, type SupabaseSide } from "./support/parity-harness";

/** Reduz o relatório ao que o usuário vê, sem ids (que diferem entre os lados). */
function view(r: Report) {
  const nodes = (list: Report["expenses"]["byCategory"]) =>
    list.map((n) => ({ name: n.name, total: n.totalCents, count: n.count, percent: n.percent, children: n.children.map((c) => [c.name, c.totalCents]) }));
  return {
    overview: r.overview,
    income: { received: r.income.receivedCents, expected: r.income.expectedCents, recurring: r.income.recurringCents, oneOff: r.income.oneOffCents, byCategory: nodes(r.income.byCategory), byProfile: r.income.byProfile.map((p) => [p.name, p.totalCents]) },
    expenses: { consumption: r.expenses.consumptionCents, open: r.expenses.openCents, byCategory: nodes(r.expenses.byCategory), debt: { total: r.expenses.debtPayments.totalCents, count: r.expenses.debtPayments.count, byDebt: r.expenses.debtPayments.byDebt.map((d) => [d.name, d.totalCents]) }, rows: r.expenses.rows.map((t) => [t.description, t.amountCents]).sort() },
    cashFlow: { in: r.cashFlow.inCents, out: r.cashFlow.outCents, net: r.cashFlow.netCents, outBreakdown: r.cashFlow.outBreakdown, tIn: r.cashFlow.transfersInCents, tOut: r.cashFlow.transfersOutCents, months: r.cashFlow.months, rows: r.cashFlow.rows.map((x) => [x.tx.description, x.direction, x.tx.amountCents, x.date]).sort() },
    cards: r.cards.map((c) => ({ name: c.card.name, spent: c.spentCents, used: c.usedCents, available: c.availableCents, installments: [c.installmentCount, c.installmentPurchasesCents], upcoming: c.upcomingInstallmentsCents, byCategory: nodes(c.byCategory), invoices: c.invoices })),
    debts: { ...r.debts, rows: r.debts.rows.map((d) => ({ name: d.debt.name, p: d.principalCents, t: d.totalCents, paid: d.paidCents, rem: d.remainingCents, cost: d.financialCostCents, pct: d.progressPercent, status: d.status, inPeriod: [d.paymentsInPeriodCents, d.paymentsInPeriodCount], future: [d.futureInstallmentsCents, d.futureInstallmentsCount] })) },
    netWorth: { ...r.netWorth, assets: r.netWorth.assets.map((a) => [a.name, a.type, a.balanceCents]).sort() },
    pockets: { reserved: r.pockets.reservedCents, months: r.pockets.months, moved: r.pockets.periodMovementCents, byPocket: r.pockets.byPocket.map((b) => [b.pocket.name, b.balanceCents, b.percent]), goals: r.pockets.goals.map((g) => [g.goal.name, g.state, g.progress.source, g.progress.currentCents]) },
    movements: r.movements.map((t) => [t.date, t.kind, t.description, t.amountCents]).sort(),
    profiles: r.profiles.map((p) => ({ ...p, profileId: p.profileId === "all" ? "all" : p.name })),
  };
}

describe.skipIf(!ENABLED)("paridade de relatórios: motor local x Supabase (usuário descartável)", { timeout: 240_000 }, () => {
  let local: Side;
  let remote: Side;
  let sb: SupabaseSide;
  const both = async <T,>(fn: (s: Side) => Promise<T>) => {
    const out = [await fn(local), await fn(remote)] as [T, T];
    await local.refresh();
    await remote.refresh();
    return out;
  };
  const find = (s: Side, desc: string) => s.data.transactions.find((t) => t.description === desc)!;

  /** Relatório de um lado. `window` opcional: no Supabase só esse recorte é carregado (como a tela faz). */
  const reportOf = async (s: Side, f: ReportFilters, window?: Parameters<typeof loadWorkspace>[1]) => {
    const data = s === remote && window ? await loadWorkspace(sb.source, window) : s.data;
    const pocketMovements = await s.movements();
    return buildReport({ data, pocketMovements, today }, f);
  };
  const filtersFor = (s: Side, period: Period, over: Partial<ReportFilters> = {}): ReportFilters => ({ ...defaultFilters(period), ...over });
  const same = async (period: Period, over: (s: Side) => Partial<ReportFilters> = () => ({}), window?: Parameters<typeof loadWorkspace>[1]) => {
    await local.refresh();
    await remote.refresh();
    const l = view(await reportOf(local, filtersFor(local, period, over(local)), undefined));
    const r = view(await reportOf(remote, filtersFor(remote, period, over(remote)), window));
    expect(r).toEqual(l);
    return l;
  };

  const WIDE: Period = { from: monthStart(addMonths(today, -2).slice(0, 7)), to: monthEnd(today.slice(0, 7)) };

  beforeAll(async () => {
    local = makeLocal();
    sb = await makeSupabase();
    remote = sb.side;
    await local.refresh();
  });
  afterAll(async () => {
    if (sb) await sb.cleanup();
  });

  it("roteiro: receita, despesas, conta velha paga hoje, transferências, cartão, parcelamento, fatura, dívida e cofrinhos", async () => {
    await both((s) => s.commands.create(input(s, { kind: "income", description: "Salário", amountCents: 500000, accountId: s.ids.accA, categoryId: s.ids.catSalario })));
    await both((s) => s.commands.create(input(s, { description: "Mercado", amountCents: 120000, accountId: s.ids.accA, categoryId: s.ids.catMercado, tags: ["Casa"] })));
    await both((s) => s.commands.create(input(s, { description: "Luz velha", amountCents: 45000, date: addDays(today, -40), dueDate: addDays(today, -38), status: "pending", paidAt: undefined, accountId: s.ids.accA, categoryId: s.ids.catMercado })));
    await both((s) => s.commands.setStatus(find(s, "Luz velha"), "paid")); // competência antiga, pago HOJE
    await both((s) => s.commands.create(input(s, { description: "Cinema previsto", amountCents: 8000, date: addDays(today, 15), status: "planned", paidAt: undefined, accountId: s.ids.accA, categoryId: s.ids.catLazer })));
    await both((s) => s.commands.create(input(s, { kind: "transfer", description: "A para B", amountCents: 100000, accountId: s.ids.accA, toAccountId: s.ids.accB })));
    await both((s) => s.commands.create(input(s, { kind: "transfer", description: "A para Invest", amountCents: 50000, accountId: s.ids.accA, toAccountId: s.ids.accInvest })));
    const card = (s: Side, over: object) => s.commands.create(input(s, { kind: "credit_card_purchase", status: "pending", paidAt: undefined, cardId: s.ids.card, categoryId: s.ids.catLazer, ...over }));
    await both((s) => card(s, { description: "Jantar", amountCents: 30000, date: addDays(today, -1) }));
    await both((s) => s.commands.createInstallmentPurchase({ description: "Notebook", totalCents: 90001, installments: 3, date: addDays(today, -1), cardId: s.ids.card, profileId: s.ids.profile, categoryId: s.ids.catMercado, tags: [] }));
    const local0 = (await reportOf(local, defaultFilters({ from: WIDE.from, to: monthEnd(addMonths(today, 3).slice(0, 7)) }))).cards[0];
    const dueMonth = local0.invoices.find((i) => i.openCents > 0)!.dueMonth;
    await both((s) => s.commands.payInvoice({ cardId: s.ids.card, dueMonth, accountId: s.ids.accB, amountCents: 10000, date: today }));
    await both((s) => s.debt.create({ name: "Empréstimo", creditor: "Banco", kind: "loan", profileId: s.ids.profile, principalCents: 150000, totalCents: 180000, installments: 6, firstDueDate: addDays(today, 10), paymentAccountId: s.ids.accA, categoryId: undefined }));
    await both((s) => s.debt.pay({ debtId: s.data.debts[0].id, accountId: s.ids.accA, amountCents: 30000, date: today }));
    // cofrinhos: reserva, uso parcial estornado, uso mantido, objetivo manual e ligado
    await both((s) => s.pocket.create({ name: "Viagem", profileId: s.ids.profile, accountId: s.ids.accA, initialCents: 30000 }));
    await both((s) => s.pocket.reserve({ pocketId: s.data.pockets[0].id, amountCents: 10000 }));
    const [u1] = await both((s) => s.pocket.spend({ pocketId: s.data.pockets[0].id, description: "Uso estornado", amountCents: 5000, categoryId: s.ids.catMercado }));
    await both((s) => s.pocket.reverseUse(s.data.transactions.find((t) => t.description === "Uso estornado")!.id));
    await both((s) => s.pocket.spend({ pocketId: s.data.pockets[0].id, description: "Uso mantido", amountCents: 2000, amountFromPocketCents: 1500, categoryId: s.ids.catMercado }));
    expect(u1.fromPocketCents).toBe(5000);
    await both(async (s) => {
      const base = { kind: "travel" as const, targetCents: 100000, profileId: s.ids.profile, icon: "target", color: "#4f46e5", status: "active" as const };
      const manual = await s.goals.create({ ...base, name: "Meta manual", manualAmountCents: 25000, deadline: addDays(today, 30) });
      const linked = await s.goals.create({ ...base, name: "Meta ligada", manualAmountCents: 0 });
      await s.pocket.linkGoal(linked.id, s.data.pockets[0].id);
      return manual.id;
    });

    const l = await same(WIDE);
    // sanidade do roteiro (cada regra crítica numa linha)
    expect(l.expenses.rows.some(([d]) => d === "Uso estornado")).toBe(false); // estornada: cancelada, sai de tudo
    expect(l.expenses.debt.total).toBe(30000); // dívida paga: fora do consumo
    expect(l.cashFlow.outBreakdown.cardPaymentsCents).toBe(10000);
    expect(l.cashFlow.tIn + l.cashFlow.tOut).toBe(0); // transferências neutras no consolidado
  });

  it("filtros: pessoa, conta, categoria, tipo, situação e cartão batem nos dois lados", async () => {
    await same(WIDE, (s) => ({ profileId: s.ids.profile }));
    await same(WIDE, (s) => ({ accountId: s.ids.accA }));
    await same(WIDE, (s) => ({ accountId: s.ids.accB }));
    await same(WIDE, (s) => ({ categoryId: s.ids.catMercado }));
    await same(WIDE, () => ({ kind: "expense" }));
    await same(WIDE, () => ({ kind: "credit_card_purchase" }));
    await same(WIDE, () => ({ status: "planned" }));
    await same(WIDE, () => ({ status: "open" }));
    await same(WIDE, (s) => ({ cardId: s.ids.card }));
  });

  it("períodos: mês atual, mês anterior e comparação com o período anterior", async () => {
    const month = periodFor("month", today);
    await same(month);
    await same(previousPeriod(month));
    await same(previousPeriod(WIDE));
  });

  it("janela por período (como a tela): conta de competência antiga PAGA no período entra no caixa via paidBetween", async () => {
    const month = periodFor("month", today);
    const narrow = { from: month.from, to: monthEnd(addMonths(today, 12).slice(0, 7)), paidBetween: true };
    const l = await same(month, () => ({}), narrow);
    expect(l.cashFlow.rows.some(([d]) => d === "Luz velha")).toBe(true); // paga hoje, competência de 40 dias atrás
    expect(l.expenses.rows.some(([d]) => d === "Luz velha")).toBe(false); // consumo é na competência (outro mês)
    // sem paidBetween o Supabase perderia essa saída de caixa: é por isso que a opção existe
    const without = buildReport({ data: await loadWorkspace(sb.source, { from: month.from, to: narrow.to }), pocketMovements: await remote.movements(), today }, defaultFilters(month));
    expect(without.cashFlow.rows.some((x) => x.tx.description === "Luz velha")).toBe(false);
  });
});
