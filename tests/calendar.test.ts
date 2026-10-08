import { describe, expect, it } from "vitest";
import { buildCalendar, CALENDAR_ALL, collectEvents, defaultCalendarFilters, filterEvents, monthGrid, moveMonth, upcomingEvents, weekday, weekOf, type CalendarFilters } from "@/domain/calendar";
import { buildPlanning } from "@/domain/planning";
import type { WorkspaceData } from "@/domain/types";
import { calendarWindow } from "@/services/calendar-window";
import { LocalDebtCommands } from "@/services/local-debt";
import { card, casal, createRepos, installFakeStorage, camila, nubank, santander, TODAY, tx, workspace, yan } from "./helpers";

const cal = (data: WorkspaceData, month = "2026-10", filters: Partial<CalendarFilters> = {}, today = TODAY) =>
  buildCalendar(data, month, { ...defaultCalendarFilters, ...filters }, today);

describe("receitas, despesas e transferências", () => {
  const data = workspace({
    transactions: [
      tx({ kind: "income", status: "paid", date: "2026-10-05", amountCents: 500000, accountId: nubank.id, description: "Salário" }),
      tx({ kind: "income", status: "planned", date: "2026-10-20", amountCents: 120000, accountId: nubank.id, description: "Freela" }),
      tx({ kind: "expense", status: "paid", date: "2026-10-02", amountCents: 30000, accountId: nubank.id }),
      tx({ kind: "expense", status: "pending", date: "2026-10-15", amountCents: 20000, accountId: nubank.id }),
      tx({ kind: "expense", status: "planned", date: "2026-10-28", amountCents: 10000, accountId: nubank.id }),
      tx({ kind: "expense", status: "canceled", date: "2026-10-10", amountCents: 99999, accountId: nubank.id }),
      tx({ kind: "transfer", status: "paid", date: "2026-10-04", amountCents: 70000, accountId: nubank.id, toAccountId: santander.id }),
    ],
  });

  it("cards do mês: receita recebida × a receber, despesas realizadas, pendentes e previstos (canceladas fora)", () => {
    const s = cal(data).summary;
    expect(s.incomeReceivedCents).toBe(500000);
    expect(s.incomeOpenCents).toBe(120000);
    expect(s.realizedExpensesCents).toBe(30000);
    expect(s.pendingCents).toBe(20000);
    expect(s.pendingCount).toBe(1);
    expect(s.plannedCents).toBe(10000);
    expect(s.totalForecastCents).toBe(30000);
  });

  it("transferência é neutra: não é receita nem despesa e não entra nos totais", () => {
    const c = cal(data);
    const t = c.events.find((e) => e.type === "transfer")!;
    expect(t.direction).toBe("neutral");
    expect(t.realizedExpense).toBe(false);
    expect(c.summary.incomeReceivedCents + c.summary.realizedExpensesCents).toBe(530000);
    expect(c.days.get("2026-10-04")).toMatchObject({ inCents: 0, outCents: 0 });
  });

  it("todo evento tem descrição, valor, data e status; cancelada não aparece", () => {
    const c = cal(data);
    expect(c.events).toHaveLength(6);
    for (const e of c.events) {
      expect(e.title).toBeTruthy();
      expect(e.amountCents).toBeGreaterThan(0);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["paid", "pending", "planned", "overdue"]).toContain(e.status);
    }
  });

  it("valores do mesmo dia são somados corretamente", () => {
    const d = workspace({
      transactions: [
        tx({ kind: "expense", status: "pending", date: "2026-10-15", amountCents: 1000, accountId: nubank.id }),
        tx({ kind: "expense", status: "planned", date: "2026-10-15", amountCents: 2500, accountId: nubank.id }),
        tx({ kind: "income", status: "planned", date: "2026-10-15", amountCents: 7000, accountId: nubank.id }),
      ],
    });
    expect(cal(d).days.get("2026-10-15")).toMatchObject({ inCents: 7000, outCents: 3500, cardCents: 0 });
    expect(cal(d).days.get("2026-10-15")?.events).toHaveLength(3);
  });
});

describe("recorrências e parcelamentos (sem duplicar)", () => {
  it("ocorrências materializadas aparecem uma vez cada, marcadas como recorrentes", () => {
    const d = workspace({
      transactions: [
        tx({ kind: "expense", status: "pending", date: "2026-10-10", dueDate: "2026-10-10", amountCents: 9000, accountId: nubank.id, recurringId: "r1", occurrenceDate: "2026-10-10", description: "Aluguel" }),
        tx({ kind: "expense", status: "planned", date: "2026-11-10", dueDate: "2026-11-10", amountCents: 9000, accountId: nubank.id, recurringId: "r1", occurrenceDate: "2026-11-10", description: "Aluguel" }),
      ],
      recurringTransactions: [],
    });
    expect(cal(d, "2026-10").events.filter((e) => e.recurring)).toHaveLength(1);
    expect(cal(d, "2026-11").events.filter((e) => e.recurring)).toHaveLength(1);
    expect(filterEvents(collectEvents(d, TODAY), { ...defaultCalendarFilters, group: "recurring" })).toHaveLength(2);
    expect(new Set(collectEvents(d, TODAY).map((e) => e.id)).size).toBe(2);
  });

  it("parcelas mostram 'n/total' e o filtro Parcelamentos as encontra", () => {
    const d = workspace({
      transactions: [
        tx({ kind: "expense", status: "pending", date: "2026-10-12", amountCents: 5000, accountId: nubank.id, installment: { purchaseId: "ip1", number: 2, total: 6 } }),
        tx({ kind: "expense", status: "pending", date: "2026-10-13", amountCents: 4000, accountId: nubank.id }),
      ],
    });
    const c = cal(d, "2026-10", { group: "installment" });
    expect(c.events).toHaveLength(1);
    expect(c.events[0].installmentLabel).toBe("2/6");
  });
});

describe("cartões e faturas", () => {
  const purchase = (date: string, amountCents: number, over = {}) => tx({ kind: "credit_card_purchase", status: "pending", date, amountCents, cardId: card.id, ...over });

  it("compra é informativa (não é pendente de caixa); a fatura em aberto é o evento de caixa, no vencimento", () => {
    const d = workspace({ transactions: [purchase("2026-10-03", 30000), purchase("2026-10-05", 20000)] });
    const c = cal(d);
    const invoice = c.events.find((e) => e.type === "invoice")!;
    expect(invoice).toMatchObject({ date: "2026-10-27", amountCents: 50000, direction: "out" });
    expect(invoice.status).toBe("planned"); // fecha dia 20: ainda recebendo compras
    expect(c.summary.invoicesDueCents).toBe(50000);
    expect(c.summary.pendingCents).toBe(0); // compras NÃO entram em pendentes; a fatura prevista fica em "previstos"
    expect(c.summary.plannedCents).toBe(50000);
    expect(c.summary.realizedExpensesCents).toBe(50000); // despesa realizada pelo motor existente (compra no cartão)
    expect(c.days.get("2026-10-03")).toMatchObject({ cardCents: 30000, outCents: 0 });
  });

  it("fatura fechada e em aberto fica pendente; vencida fica atrasada com a data original", () => {
    const d = workspace({ transactions: [purchase("2026-09-02", 10000), purchase("2026-08-02", 7000)] });
    const events = collectEvents(d, TODAY).filter((e) => e.type === "invoice");
    expect(events.find((e) => e.date === "2026-09-27")).toMatchObject({ status: "overdue", amountCents: 10000 });
    expect(events.find((e) => e.date === "2026-08-27")).toMatchObject({ status: "overdue", amountCents: 7000 });
  });

  it("pagamento parcial: a fatura mostra só o que falta; o pagamento é realizado e NÃO é despesa", () => {
    const d = workspace({
      transactions: [
        purchase("2026-09-02", 10000),
        tx({ kind: "card_payment", status: "paid", date: "2026-10-01", amountCents: 4000, cardId: card.id, accountId: nubank.id, invoiceMonth: "2026-09", description: "Pagamento de fatura" }),
      ],
    });
    const events = collectEvents(d, TODAY);
    const invoice = events.find((e) => e.type === "invoice")!;
    expect(invoice).toMatchObject({ amountCents: 6000, paidCents: 4000, totalCents: 10000 });
    const payment = events.find((e) => e.type === "card_payment")!;
    expect(payment).toMatchObject({ status: "paid", direction: "neutral", realizedExpense: false });
    // outubro: o pagamento não é despesa; a compra de setembro não é de outubro
    expect(cal(d, "2026-10").summary.realizedExpensesCents).toBe(0);
  });

  it("fatura totalmente paga não vira evento (só o pagamento aparece) — sem duplicar", () => {
    const d = workspace({
      transactions: [
        purchase("2026-09-02", 10000, { status: "paid" }),
        tx({ kind: "card_payment", status: "paid", date: "2026-09-27", amountCents: 10000, cardId: card.id, accountId: nubank.id, invoiceMonth: "2026-09" }),
      ],
    });
    const events = collectEvents(d, TODAY);
    expect(events.filter((e) => e.type === "invoice")).toHaveLength(0);
    expect(events.filter((e) => e.type === "card_payment")).toHaveLength(1);
  });

  it("filtro de cartão traz compras, fatura e pagamentos desse cartão", () => {
    const d = workspace({ transactions: [purchase("2026-10-03", 30000), tx({ kind: "expense", status: "pending", date: "2026-10-09", accountId: nubank.id })] });
    const c = cal(d, "2026-10", { cardId: card.id });
    expect(c.events.map((e) => e.type).sort()).toEqual(["card_purchase", "invoice"]);
  });
});

describe("dívidas", () => {
  it("parcelas em aberto entram uma vez; pagamento vira realizado e reduz a parcela; pausada some", async () => {
    installFakeStorage();
    const repos = createRepos();
    const debts = new LocalDebtCommands(repos, { today: () => TODAY });
    const id = await debts.create({ name: "Empréstimo", kind: "loan", profileId: yan.id, principalCents: 90000, totalCents: 90000, installments: 3, firstDueDate: "2026-10-12" });
    const load = async () => workspace({ transactions: await repos.transactions.list(), debts: await repos.debts.list() });

    let c = cal(await load());
    expect(c.events.filter((e) => e.type === "debt_installment").map((e) => [e.date, e.amountCents])).toEqual([["2026-10-12", 30000]]);
    expect(c.summary.pendingCents).toBe(30000);
    expect(collectEvents(await load(), TODAY).filter((e) => e.type === "debt_installment")).toHaveLength(3);

    await debts.pay({ debtId: id, accountId: nubank.id, amountCents: 10000, date: TODAY });
    c = cal(await load());
    const inst = c.events.find((e) => e.type === "debt_installment")!;
    expect(inst).toMatchObject({ amountCents: 20000, paidCents: 10000, totalCents: 30000 });
    const pay = c.events.find((e) => e.type === "debt_payment")!;
    expect(pay).toMatchObject({ status: "paid", amountCents: 10000, realizedExpense: true });
    expect(c.summary.pendingCents).toBe(20000); // o pago não é descontado de novo
    expect(c.summary.realizedExpensesCents).toBe(10000);

    await debts.setStatus((await repos.debts.get(id))!, "paused");
    expect(collectEvents(await load(), TODAY).some((e) => e.type === "debt_installment")).toBe(false);
  });

  it("parcela vencida fica atrasada na data original", async () => {
    installFakeStorage();
    const repos = createRepos();
    await new LocalDebtCommands(repos, { today: () => TODAY }).create({ name: "Empréstimo", kind: "loan", profileId: yan.id, principalCents: 20000, totalCents: 20000, installments: 2, firstDueDate: "2026-09-12" });
    const events = collectEvents(workspace({ transactions: await repos.transactions.list(), debts: await repos.debts.list() }), TODAY).filter((e) => e.type === "debt_installment");
    expect(events.find((e) => e.date === "2026-09-12")?.status).toBe("overdue");
    expect(events.find((e) => e.date === "2026-10-12")?.status).toBe("pending");
  });
});

describe("atrasados e fuso (hoje da família)", () => {
  const data = workspace({
    transactions: [
      tx({ kind: "expense", status: "pending", date: "2026-09-10", dueDate: "2026-09-10", amountCents: 8000, accountId: nubank.id, description: "Velha" }),
      tx({ kind: "expense", status: "pending", date: "2026-10-06", dueDate: "2026-10-06", amountCents: 3000, accountId: nubank.id, description: "Vence hoje" }),
    ],
  });

  it("atrasado mantém a data original, vai para 'atrasados de meses anteriores' e soma nos pendentes", () => {
    const c = cal(data);
    expect(c.carriedOverdue).toHaveLength(1);
    expect(c.carriedOverdue[0]).toMatchObject({ date: "2026-09-10", status: "overdue" });
    expect(c.events.find((e) => e.title === "Velha")).toBeUndefined();
    expect(c.summary).toMatchObject({ overdueCount: 1, overdueCents: 8000, pendingCents: 11000 });
    expect(upcomingEvents(collectEvents(data, TODAY), TODAY)[0].title).toBe("Velha"); // atrasado primeiro
  });

  it("em setembro, a conta aparece na própria data e não é 'carregada'", () => {
    const c = cal(data, "2026-09");
    expect(c.events.map((e) => e.title)).toEqual(["Velha"]);
    expect(c.carriedOverdue).toHaveLength(0);
  });

  it("mês passado não recebe atrasados de meses anteriores", () => {
    expect(cal(data, "2026-08").carriedOverdue).toHaveLength(0);
  });

  it("fuso: o mesmo vencimento é 'pendente' no dia e 'atrasado' no dia seguinte (hoje vem do fuso da família)", () => {
    const status = (today: string) => collectEvents(data, today).find((e) => e.title === "Vence hoje")!.status;
    expect(status("2026-10-06")).toBe("pending");
    expect(status("2026-10-07")).toBe("overdue");
    // o resultado depende só da data informada, nunca do relógio do navegador
    expect(status("2026-10-05")).toBe("pending");
  });
});

describe("perfis (sem contar duas vezes)", () => {
  const data = workspace({
    transactions: [
      tx({ kind: "expense", status: "pending", date: "2026-10-10", amountCents: 1000, accountId: nubank.id, profileId: yan.id }),
      tx({ kind: "expense", status: "pending", date: "2026-10-11", amountCents: 2000, accountId: santander.id, profileId: camila.id }),
      tx({ kind: "expense", status: "pending", date: "2026-10-12", amountCents: 4000, accountId: nubank.id, profileId: casal.id, split: [{ profileId: yan.id, percent: 50 }, { profileId: camila.id, percent: 50 }] }),
    ],
  });

  it("Todos = soma das partes; despesa do Casal conta uma vez", () => {
    const total = cal(data).summary.pendingCents;
    const parts = [yan.id, camila.id, casal.id].map((id) => cal(data, "2026-10", { profileId: id }).summary.pendingCents);
    expect(total).toBe(7000);
    expect(parts).toEqual([1000, 2000, 4000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("filtros combinados: conta, categoria e status", () => {
    const events = collectEvents(data, TODAY);
    expect(filterEvents(events, { ...defaultCalendarFilters, accountId: santander.id })).toHaveLength(1);
    expect(filterEvents(events, { ...defaultCalendarFilters, accountId: nubank.id, status: "paid" })).toHaveLength(0);
    expect(filterEvents(events, { ...defaultCalendarFilters, profileId: camila.id, accountId: nubank.id })).toHaveLength(0);
  });

  it("perfil desconhecido cai em Todos", () => {
    expect(cal(data, "2026-10", { profileId: "p-inexistente" }).summary.pendingCents).toBe(7000);
  });
});

describe("virada de mês/ano e grades", () => {
  it("31/12 e 01/01 caem em meses diferentes", () => {
    const d = workspace({
      transactions: [
        tx({ kind: "expense", status: "planned", date: "2026-12-31", amountCents: 100, accountId: nubank.id }),
        tx({ kind: "expense", status: "planned", date: "2027-01-01", amountCents: 200, accountId: nubank.id }),
      ],
    });
    expect(cal(d, "2026-12").events.map((e) => e.amountCents)).toEqual([100]);
    expect(cal(d, "2027-01").events.map((e) => e.amountCents)).toEqual([200]);
  });

  it("navegação de mês limita o dia (31/01 → 28/02) e atravessa o ano", () => {
    expect(moveMonth("2027-01-31", 1)).toBe("2027-02-28");
    expect(moveMonth("2026-12-15", 1)).toBe("2027-01-15");
    expect(moveMonth("2027-01-10", -1)).toBe("2026-12-10");
  });

  it("grade mensal começa no domingo e cobre o mês; semana atravessa a virada do ano", () => {
    const grid = monthGrid("2026-10");
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid.flat().filter((c) => c.inMonth)).toHaveLength(31);
    expect(grid[0][0].date).toBe("2026-09-27"); // 01/10/2026 é quinta
    expect(weekday("2026-10-01")).toBe(4);
    expect(weekOf("2026-12-31")[0]).toBe("2026-12-27");
    expect(weekOf("2026-12-31")[6]).toBe("2027-01-02");
  });

  it("janela de dados cobre a semana que atravessa meses e o horizonte dos próximos vencimentos", () => {
    const w = calendarWindow("2026-12", "2026-12-20", { from: "2026-11-29", to: "2027-01-02" });
    expect(w).toMatchObject({ from: "2026-11-29", to: "2027-01-02" });
    expect(w.openOnly).toMatchObject({ until: "2027-01-31", withWindow: true });
    expect(calendarWindow("2026-03", "2026-10-06").openOnly?.until).toBe("2026-11-30");
  });
});

describe("saldo projetado e consistência", () => {
  const data = workspace({
    transactions: [
      tx({ kind: "income", status: "planned", date: "2026-11-05", amountCents: 900000, accountId: nubank.id }),
      tx({ kind: "expense", status: "pending", date: "2026-10-20", amountCents: 50000, accountId: nubank.id }),
      tx({ kind: "credit_card_purchase", status: "pending", date: "2026-10-03", amountCents: 30000, cardId: card.id }),
    ],
  });

  it("usa o Planejamento (mesmas regras); some em mês passado, além de 12 meses e com filtros que ele não entende", () => {
    const plan = buildPlanning(data, { profileId: "all", months: 2 }, TODAY);
    expect(cal(data, "2026-10").summary.projectedBalanceCents).toBe(plan.months[0].endBalanceCents);
    expect(cal(data, "2026-11").summary.projectedBalanceCents).toBe(plan.months[1].endBalanceCents);
    expect(cal(data, "2026-09").summary.projectedBalanceCents).toBeNull();
    expect(cal(data, "2027-12").summary.projectedBalanceCents).toBeNull();
    expect(cal(data, "2026-10", { categoryId: "x" }).summary.projectedBalanceCents).toBeNull();
    expect(cal(data, "2026-10", { profileId: yan.id }).summary.projectedBalanceCents).not.toBeNull();
  });

  it("a saída de caixa prevista do mês bate com a do Planejamento (cada obrigação uma vez)", () => {
    const c = cal(data, "2026-10").summary;
    const plan = buildPlanning(data, { profileId: "all", months: 1 }, TODAY).months[0];
    expect(c.pendingCents + c.plannedCents).toBe(plan.outflowCents);
  });

  it("ids são únicos e filtro 'todos' não remove nada", () => {
    const events = collectEvents(data, TODAY);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(filterEvents(events, defaultCalendarFilters)).toHaveLength(events.length);
    expect(CALENDAR_ALL).toBe("all");
  });
});
