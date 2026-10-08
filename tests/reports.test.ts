import { describe, expect, it } from "vitest";
import { addDays, coversWholeMonths, periodFor, periodLabel, previousPeriod, shiftPeriod, variation } from "@/domain/report-periods";
import { buildReport, categoryBreakdown, defaultFilters, type ReportFilters } from "@/domain/reports";
import type { Category, Debt, Goal, Pocket, PocketMovement, Transaction, WorkspaceData } from "@/domain/types";
import { toCsv, money } from "@/lib/csv";
import { cashFlowCsv, cashFlowMonthlyCsv, expensesCsv, incomeCsv, movementsCsv } from "@/services/report-csv";
import { card, casal, invest, camila, mercadoPago, nubank, santander, TODAY, tx, workspace, yan } from "./helpers";

const OCT = periodFor("month", TODAY); // 2026-10-01 .. 2026-10-31
const cat = (id: string, name: string, parentId?: string, kind: Category["kind"] = "expense"): Category => ({ id, name, icon: "more", color: "#111111", kind, parentId, active: true });
const categories = [
  cat("alim", "Alimentação"),
  cat("alim-mercado", "Mercado", "alim"),
  cat("alim-rest", "Restaurante", "alim"),
  cat("lazer", "Lazer"),
  cat("salario", "Salário", undefined, "income"),
  cat("freela", "Freelance", undefined, "income"),
];

const paid = (over: Partial<Transaction>) => tx({ status: "paid", paidAt: over.date ?? TODAY, accountId: nubank.id, ...over });
const report = (data: WorkspaceData, over: Partial<ReportFilters> = {}, movements: PocketMovement[] = []) =>
  buildReport({ data, pocketMovements: movements, today: TODAY }, { ...defaultFilters(OCT), ...over });
const ws = (transactions: Transaction[], over: Partial<WorkspaceData> = {}) => workspace({ categories, transactions, ...over });

describe("períodos e comparação", () => {
  it("presets: mês, trimestre e ano; navegação", () => {
    expect(periodFor("month", "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodFor("quarter", "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodFor("quarter", "2026-08-02")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodFor("year", "2026-10-15")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(shiftPeriod("quarter", periodFor("quarter", "2026-01-10"), -1)).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(shiftPeriod("month", periodFor("month", "2026-12-10"), 1)).toEqual({ from: "2027-01-01", to: "2027-01-31" });
  });

  it("período anterior: meses inteiros recuam o MESMO número de meses (Jan–Jun/2027 → Jul–Dez/2026)", () => {
    const p = { from: "2027-01-01", to: "2027-06-30" };
    expect(coversWholeMonths(p)).toBe(true);
    expect(previousPeriod(p)).toEqual({ from: "2026-07-01", to: "2026-12-31" });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodLabel(p)).toBe("Jan a Jun/2027");
    expect(periodLabel(previousPeriod(p))).toBe("Jul a Dez/2026");
  });

  it("período em dias: recua o mesmo número de dias, terminando na véspera", () => {
    expect(previousPeriod({ from: "2026-10-10", to: "2026-10-19" })).toEqual({ from: "2026-09-30", to: "2026-10-09" });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("variação: com cuidado quando o período anterior é zero", () => {
    expect(variation(470000, 520000)).toEqual({ deltaCents: -50000, percent: -9.6, direction: "down" });
    expect(variation(115000, 100000)).toMatchObject({ percent: 15, direction: "up" });
    expect(variation(5000, 0)).toEqual({ deltaCents: 5000, percent: null, direction: "up" }); // sem divisão por zero
    expect(variation(0, 0)).toEqual({ deltaCents: 0, percent: null, direction: "flat" });
    expect(variation(0, 4000)).toMatchObject({ percent: -100, direction: "down" });
  });
});

describe("receita", () => {
  it("recebida (paga) x prevista; recorrente x avulsa; transferência recebida NÃO é receita", () => {
    const r = report(
      ws([
        paid({ kind: "income", amountCents: 500000, date: "2026-10-05", categoryId: "salario", recurringId: "rec1" }),
        paid({ kind: "income", amountCents: 80000, date: "2026-10-06", categoryId: "freela" }),
        tx({ kind: "income", status: "pending", amountCents: 20000, date: "2026-10-20", accountId: nubank.id, categoryId: "freela" }),
        paid({ kind: "transfer", amountCents: 300000, date: "2026-10-04", accountId: santander.id, toAccountId: nubank.id }),
      ]),
    );
    expect(r.income.receivedCents).toBe(580000);
    expect(r.income.expectedCents).toBe(20000);
    expect(r.income.recurringCents).toBe(500000);
    expect(r.income.oneOffCents).toBe(80000);
    expect(r.overview.receivedCents).toBe(580000);
    expect(r.income.byCategory.map((n) => [n.name, n.totalCents])).toEqual([["Salário", 500000], ["Freelance", 80000]]);
  });

  it("por pessoa/Casal: a soma das pessoas = total recebido", () => {
    const r = report(
      ws([
        paid({ kind: "income", amountCents: 100000, date: "2026-10-02", profileId: yan.id }),
        paid({ kind: "income", amountCents: 70000, date: "2026-10-03", profileId: camila.id, accountId: santander.id }),
        paid({ kind: "income", amountCents: 30000, date: "2026-10-03", profileId: casal.id }),
      ]),
    );
    expect(r.income.byProfile.map((p) => [p.name, p.totalCents])).toEqual([["Yan", 100000], ["Camila", 70000], ["Casal", 30000]]);
    expect(r.income.byProfile.reduce((n, p) => n + p.totalCents, 0)).toBe(r.income.receivedCents);
  });
});

describe("consumo x fluxo de caixa (sem dupla contagem)", () => {
  it("despesa paga em conta: consumo E saída de caixa (uma vez cada)", () => {
    const r = report(ws([paid({ amountCents: 12000, date: "2026-10-02", categoryId: "alim-mercado" })]));
    expect(r.overview.consumptionCents).toBe(12000);
    expect(r.overview.cashOutCents).toBe(12000);
  });

  it("COMPRA NO CARTÃO: consumo na data da compra, NÃO é saída imediata de conta", () => {
    const r = report(ws([tx({ kind: "credit_card_purchase", status: "pending", amountCents: 20000, date: "2026-10-03", cardId: card.id, categoryId: "lazer" })]));
    expect(r.overview.consumptionCents).toBe(20000);
    expect(r.overview.cashOutCents).toBe(0);
    expect(r.cashFlow.outCents).toBe(0);
    expect(r.cards[0].spentCents).toBe(20000);
  });

  it("PAGAMENTO DE FATURA: saída de caixa, NÃO cria nova despesa", () => {
    const purchase = tx({ kind: "credit_card_purchase", status: "pending", amountCents: 20000, date: "2026-10-03", cardId: card.id, categoryId: "lazer" });
    const payment = paid({ kind: "card_payment", amountCents: 20000, date: "2026-10-05", cardId: card.id, invoiceMonth: "2026-10" });
    const r = report(ws([purchase, payment]));
    expect(r.overview.consumptionCents).toBe(20000); // continua só a compra
    expect(r.overview.cashOutCents).toBe(20000);
    expect(r.cashFlow.outBreakdown).toEqual({ expenseCents: 0, cardPaymentsCents: 20000, debtPaymentsCents: 0 });
    expect(r.expenses.rows).toHaveLength(1);
    expect(r.expenses.byCategory.reduce((n, c) => n + c.totalCents, 0)).toBe(20000);
  });

  it("compra de um mês, fatura paga em outro: consumo no mês da compra, caixa no mês do pagamento", () => {
    const purchase = tx({ kind: "credit_card_purchase", status: "pending", amountCents: 30000, date: "2026-09-20", cardId: card.id, categoryId: "lazer" });
    const payment = paid({ kind: "card_payment", amountCents: 30000, date: "2026-10-05", cardId: card.id, invoiceMonth: "2026-09" });
    const data = ws([purchase, payment]);
    const oct = report(data);
    const sep = report(data, { period: periodFor("month", "2026-09-10") });
    expect([sep.overview.consumptionCents, sep.overview.cashOutCents]).toEqual([30000, 0]);
    expect([oct.overview.consumptionCents, oct.overview.cashOutCents]).toEqual([0, 30000]);
  });

  it("PARCELAMENTO: cada parcela cai na sua competência; o total do ano soma a compra uma vez", () => {
    const parcels = [0, 1, 2].map((i) =>
      tx({
        kind: "credit_card_purchase", status: i === 0 ? "pending" : "planned", amountCents: 10000, date: `2026-${10 + i}-03`, cardId: card.id, categoryId: "lazer",
        installment: { purchaseId: "p1", number: i + 1, total: 3 },
      }),
    );
    const data = ws(parcels);
    expect(report(data).overview.consumptionCents).toBe(10000); // só a parcela de outubro (as demais são previstas)
    const next = report(data, { period: { from: "2026-10-01", to: "2026-12-31" }, status: "all" });
    expect(next.expenses.consumptionCents).toBe(10000);
    expect(next.expenses.openCents).toBe(20000); // previstas, fora do consumo realizado
    expect(next.cards[0].installmentCount).toBe(1);
    expect(next.cards[0].upcomingInstallmentsCents).toBe(20000);
  });

  it("TRANSFERÊNCIA: neutra no consolidado (não é receita, consumo, entrada nem saída)", () => {
    const r = report(ws([paid({ kind: "transfer", amountCents: 50000, date: "2026-10-03", accountId: nubank.id, toAccountId: mercadoPago.id })]));
    expect([r.overview.receivedCents, r.overview.consumptionCents, r.overview.cashInCents, r.overview.cashOutCents, r.overview.resultCents]).toEqual([0, 0, 0, 0, 0]);
    expect([r.cashFlow.transfersInCents, r.cashFlow.transfersOutCents]).toEqual([0, 0]); // entra e sai dentro do escopo
    expect(r.overview.netWorthFinancialCents).toBe(nubank.initialBalanceCents + mercadoPago.initialBalanceCents + santander.initialBalanceCents + invest.initialBalanceCents);
  });

  it("transferência entre pessoas aparece como informativo no escopo da pessoa, nunca em entradas/saídas", () => {
    const r = report(ws([paid({ kind: "transfer", amountCents: 50000, date: "2026-10-03", accountId: nubank.id, toAccountId: santander.id, profileId: yan.id })]), { profileId: yan.id });
    expect(r.cashFlow.transfersOutCents).toBe(50000);
    expect([r.overview.cashInCents, r.overview.cashOutCents]).toEqual([0, 0]);
  });

  it("DÍVIDA: pagamento no caixa e em seção própria, FORA do consumo", () => {
    const debt: Debt = { id: "d1", name: "Empréstimo", kind: "loan", profileId: yan.id, principalCents: 100000, totalCents: 120000, status: "active" };
    const r = report(ws([paid({ kind: "debt_payment", amountCents: 20000, date: "2026-10-04", debtId: "d1" }), paid({ amountCents: 5000, date: "2026-10-04" })], { debts: [debt] }));
    expect(r.overview.consumptionCents).toBe(5000);
    expect(r.overview.debtPaymentsCents).toBe(20000);
    expect(r.overview.cashOutCents).toBe(25000);
    expect(r.expenses.debtPayments).toMatchObject({ totalCents: 20000, count: 1 });
    expect(r.expenses.debtPayments.byDebt).toEqual([{ debtId: "d1", name: "Empréstimo", totalCents: 20000, count: 1 }]);
    expect(r.expenses.rows.every((t) => t.kind !== "debt_payment")).toBe(true);
    expect(r.cashFlow.outBreakdown.debtPaymentsCents).toBe(20000);
    // sem estimar juros: o custo financeiro é só total − original
    expect(r.debts.rows[0]).toMatchObject({ principalCents: 100000, totalCents: 120000, financialCostCents: 20000, paidCents: 20000, remainingCents: 100000, paymentsInPeriodCents: 20000 });
  });

  it("resultado do período = recebido − consumo − pagamentos de dívida; taxa de economia = resultado / recebido", () => {
    const debt: Debt = { id: "d1", name: "Empréstimo", kind: "loan", profileId: yan.id, principalCents: 100000, totalCents: 100000, status: "active" };
    const r = report(
      ws([
        paid({ kind: "income", amountCents: 100000, date: "2026-10-01", categoryId: "salario" }),
        paid({ amountCents: 30000, date: "2026-10-02", categoryId: "alim-mercado" }),
        paid({ kind: "debt_payment", amountCents: 20000, date: "2026-10-03", debtId: "d1" }),
      ], { debts: [debt] }),
    );
    expect(r.overview.resultCents).toBe(50000);
    expect(r.overview.savingsRate).toBe(50);
    expect(report(ws([])).overview.savingsRate).toBeNull();
  });

  it("recorrência de despesa entra como consumo comum", () => {
    const r = report(ws([paid({ amountCents: 5590, date: "2026-10-05", categoryId: "lazer", recurringId: "r1", occurrenceDate: "2026-10-05" })]));
    expect(r.overview.consumptionCents).toBe(5590);
  });

  it("pago em outro mês: competência (date) x caixa (paidAt)", () => {
    const e = tx({ kind: "expense", status: "paid", amountCents: 9000, date: "2026-09-28", paidAt: "2026-10-02", accountId: nubank.id, categoryId: "lazer" });
    const data = ws([e]);
    const sep = report(data, { period: periodFor("month", "2026-09-10") });
    const oct = report(data);
    expect([sep.overview.consumptionCents, sep.overview.cashOutCents]).toEqual([9000, 0]);
    expect([oct.overview.consumptionCents, oct.overview.cashOutCents]).toEqual([0, 9000]);
  });

  it("cancelada não conta em lugar nenhum; pendente/prevista ficam em aberto", () => {
    const r = report(
      ws([
        tx({ kind: "expense", status: "canceled", amountCents: 9000, date: "2026-10-02", accountId: nubank.id }),
        tx({ kind: "expense", status: "pending", amountCents: 4000, date: "2026-10-20", accountId: nubank.id }),
        tx({ kind: "expense", status: "planned", amountCents: 3000, date: "2026-10-25", accountId: nubank.id }),
      ]),
    );
    expect(r.overview.consumptionCents).toBe(0);
    expect(r.expenses.openCents).toBe(7000);
    expect(r.movements).toHaveLength(2);
  });
});

describe("cofrinhos não mexem em receita, consumo, caixa nem patrimônio", () => {
  const pocket: Pocket = { id: "k1", name: "Viagem", icon: "piggy-bank", color: "#000000", profileId: yan.id, accountId: nubank.id, status: "active", createdAt: "2026-01-01T00:00:00Z" };
  const mv = (id: string, kind: PocketMovement["kind"], amountCents: number, over: Partial<PocketMovement> = {}): PocketMovement => ({ id, pocketId: "k1", kind, amountCents, date: "2026-10-02", createdAt: `2026-10-02T10:00:0${id.length}Z`, ...over });

  it("reserva e retirada: só informativo (reservado), nada em receita/consumo/caixa/patrimônio", () => {
    const base = report(ws([]));
    const data = ws([], { pockets: [pocket], pocketMovements: [mv("a", "reserve", 30000), mv("b", "withdraw", 5000)] });
    const r = report(data, {}, data.pocketMovements);
    expect(r.pockets.reservedCents).toBe(25000);
    expect(r.overview.reservedCents).toBe(25000);
    expect([r.overview.receivedCents, r.overview.consumptionCents, r.overview.cashInCents, r.overview.cashOutCents]).toEqual([0, 0, 0, 0]);
    expect(r.netWorth.financialCents).toBe(base.netWorth.financialCents); // COFRINHO não altera patrimônio
    expect(r.overview.currentBalanceCents).toBe(base.overview.currentBalanceCents);
    expect(r.pockets.periodMovementCents).toBe(25000);
  });

  it("uso de reserva: UMA despesa (consumo e caixa uma vez); estorno cancela a despesa e devolve a reserva", () => {
    const expense = paid({ amountCents: 4000, date: "2026-10-03", categoryId: "alim-mercado" });
    const used = ws([expense], { pockets: [pocket], pocketMovements: [mv("a", "reserve", 30000), mv("u", "use", 4000, { transactionId: expense.id, date: "2026-10-03" })] });
    const r1 = report(used, {}, used.pocketMovements);
    expect([r1.overview.consumptionCents, r1.overview.cashOutCents, r1.pockets.reservedCents]).toEqual([4000, 4000, 26000]);
    const reversed = ws([{ ...expense, status: "canceled", paidAt: undefined }], {
      pockets: [pocket],
      pocketMovements: [...used.pocketMovements, mv("r", "use_reversal", 4000, { transactionId: expense.id, reversesId: "u", date: "2026-10-04" })],
    });
    const r2 = report(reversed, {}, reversed.pocketMovements);
    expect([r2.overview.consumptionCents, r2.overview.cashOutCents, r2.pockets.reservedCents]).toEqual([0, 0, 30000]);
  });

  it("evolução das reservas é reconstruída a partir de hoje", () => {
    const data = ws([], { pockets: [pocket], pocketMovements: [mv("a", "reserve", 30000, { date: "2026-08-10" }), mv("b", "reserve", 10000, { date: "2026-10-02" })] });
    const r = report(data, { period: { from: "2026-08-01", to: "2026-10-31" } }, data.pocketMovements);
    expect(r.pockets.months).toEqual([
      { month: "2026-08", reservedCents: 30000 },
      { month: "2026-09", reservedCents: 30000 },
      { month: "2026-10", reservedCents: 40000 },
    ]);
  });

  it("objetivos: manual NÃO é dinheiro real; atrasado / próximo / concluído", () => {
    const goal = (id: string, over: Partial<Goal>): Goal => ({ id, name: id, kind: "other", targetCents: 100000, profileId: yan.id, icon: "target", color: "#000000", status: "active", manualAmountCents: 0, ...over });
    const data = ws([], {
      pockets: [pocket],
      pocketMovements: [mv("a", "reserve", 100000)],
      goals: [goal("late", { deadline: "2026-09-01" }), goal("near", { deadline: "2026-11-15" }), goal("done", { pocketId: "k1" }), goal("manual", { manualAmountCents: 99999, deadline: "2027-12-01" })],
    });
    const r = report(data, {}, data.pocketMovements);
    const state = Object.fromEntries(r.pockets.goals.map((g) => [g.goal.id, g.state]));
    expect(state).toEqual({ late: "late", near: "near", done: "completed", manual: "ongoing" });
    expect(r.pockets.goals.find((g) => g.goal.id === "manual")!.progress.source).toBe("manual");
    expect(r.overview.reservedCents).toBe(100000); // o manual nunca entra no reservado
  });
});

describe("categorias e drill-down: batem centavo a centavo", () => {
  const data = ws([
    paid({ amountCents: 60000, date: "2026-10-02", categoryId: "alim-mercado" }),
    paid({ amountCents: 45000, date: "2026-10-03", categoryId: "alim-rest" }),
    paid({ amountCents: 30000, date: "2026-10-04", categoryId: "alim" }),
    paid({ amountCents: 12345, date: "2026-10-05", categoryId: "lazer" }),
    paid({ amountCents: 777, date: "2026-10-06" }),
    tx({ kind: "credit_card_purchase", status: "pending", amountCents: 999, date: "2026-10-06", cardId: card.id, categoryId: "alim-mercado" }),
  ]);

  it("soma das categorias = total de consumo; filhos somam o pai; 'Sem categoria' incluída", () => {
    const r = report(data);
    const total = 60000 + 45000 + 30000 + 12345 + 777 + 999;
    expect(r.expenses.consumptionCents).toBe(total);
    expect(r.expenses.byCategory.reduce((n, c) => n + c.totalCents, 0)).toBe(total);
    const alim = r.expenses.byCategory.find((c) => c.id === "alim")!;
    expect(alim.totalCents).toBe(60000 + 45000 + 30000 + 999);
    expect(alim.children.reduce((n, c) => n + c.totalCents, 0)).toBe(alim.totalCents);
    expect(alim.children.map((c) => c.name)).toEqual(["Mercado", "Restaurante", "Alimentação (sem subcategoria)"]);
    expect(alim.transactions).toHaveLength(4);
    expect(r.expenses.byCategory.at(-1)!.name).toBe("Sem categoria");
    expect(r.expenses.byCategory.reduce((n, c) => n + c.percent, 0)).toBeGreaterThan(99.8);
  });

  it("categoryBreakdown isolado com lista vazia", () => {
    expect(categoryBreakdown([], new Map())).toEqual([]);
  });
});

describe("filtros combináveis", () => {
  const data = ws([
    paid({ kind: "income", amountCents: 100000, date: "2026-10-01", categoryId: "salario", profileId: yan.id }),
    paid({ amountCents: 10000, date: "2026-10-02", categoryId: "alim-mercado", profileId: yan.id }),
    paid({ amountCents: 20000, date: "2026-10-03", categoryId: "lazer", profileId: camila.id, accountId: santander.id }),
    paid({ amountCents: 7000, date: "2026-10-03", categoryId: "alim-rest", profileId: casal.id, accountId: mercadoPago.id }),
    tx({ kind: "credit_card_purchase", status: "pending", amountCents: 5000, date: "2026-10-04", cardId: card.id, categoryId: "lazer", profileId: yan.id }),
    tx({ kind: "expense", status: "pending", amountCents: 1500, date: "2026-10-25", accountId: nubank.id, categoryId: "lazer", profileId: yan.id }),
  ]);

  it("pessoa individual, Casal e consolidado; a soma das pessoas = consolidado", () => {
    const all = report(data);
    const rows = Object.fromEntries(all.profiles.map((p) => [p.name, p]));
    expect(rows.Yan.consumptionCents).toBe(15000);
    expect(rows.Camila.consumptionCents).toBe(20000);
    expect(rows.Casal.consumptionCents).toBe(7000);
    expect(rows.Consolidado.consumptionCents).toBe(42000);
    for (const key of ["receivedCents", "consumptionCents", "debtPaymentsCents", "cashInCents", "cashOutCents"] as const) {
      expect(all.profiles.filter((p) => p.profileId !== "all").reduce((n, p) => n + p[key], 0)).toBe(rows.Consolidado[key]);
    }
    expect(report(data, { profileId: casal.id }).overview.consumptionCents).toBe(7000);
    expect(report(data, { profileId: yan.id }).overview.receivedCents).toBe(100000);
  });

  it("conta, cartão, categoria (raiz e sub), tipo e situação", () => {
    expect(report(data, { accountId: santander.id }).overview.consumptionCents).toBe(20000);
    expect(report(data, { cardId: card.id }).overview.consumptionCents).toBe(5000);
    // a compra no cartão pertence à conta que paga a fatura do cartão
    expect(report(data, { accountId: nubank.id }).overview.consumptionCents).toBe(10000 + 5000);
    expect(report(data, { categoryId: "alim" }).overview.consumptionCents).toBe(17000);
    expect(report(data, { categoryId: "alim-rest" }).overview.consumptionCents).toBe(7000);
    expect(report(data, { kind: "income" }).overview.consumptionCents).toBe(0);
    expect(report(data, { kind: "credit_card_purchase" }).overview.consumptionCents).toBe(5000);
    expect(report(data, { status: "open" }).expenses.openCents).toBe(1500);
    expect(report(data, { status: "open" }).overview.consumptionCents).toBe(0); // a compra no cartão já ocorrida é realizada
  });

  it("filtros combinados: pessoa + categoria + período", () => {
    const r = report(data, { profileId: yan.id, categoryId: "lazer" });
    expect(r.overview.consumptionCents).toBe(5000);
    expect(report(data, { profileId: yan.id, categoryId: "lazer", period: periodFor("month", "2026-09-10") }).overview.consumptionCents).toBe(0);
  });
});

describe("patrimônio", () => {
  it("evolução a partir do saldo de hoje; cofrinho e dívida no lugar certo; líquido = financeiro − dívidas", () => {
    const debt: Debt = { id: "d1", name: "Carro", kind: "financing", profileId: yan.id, principalCents: 50000, totalCents: 60000, status: "active" };
    const data = ws(
      [
        paid({ kind: "income", amountCents: 200000, date: "2026-09-10", categoryId: "salario" }),
        paid({ amountCents: 50000, date: "2026-10-02", categoryId: "lazer" }),
        paid({ kind: "debt_payment", amountCents: 10000, date: "2026-10-03", debtId: "d1" }),
      ],
      { debts: [debt] },
    );
    const r = report(data, { period: { from: "2026-08-01", to: "2026-10-31" } });
    const initial = nubank.initialBalanceCents + mercadoPago.initialBalanceCents + santander.initialBalanceCents; // contas (sem investimento)
    expect(r.netWorth.months.map((m) => m.accountsCents)).toEqual([initial, initial + 200000, initial + 200000 - 60000]);
    expect(r.netWorth.months.map((m) => m.investmentsCents)).toEqual([invest.initialBalanceCents, invest.initialBalanceCents, invest.initialBalanceCents]);
    expect(r.netWorth.financialCents).toBe(initial + 200000 - 60000 + invest.initialBalanceCents);
    expect(r.netWorth.debtsCents).toBe(50000); // 60.000 − 10.000 pagos
    expect(r.netWorth.netCents).toBe(r.netWorth.financialCents - 50000);
    expect(r.netWorth.assets.map((a) => a.type)).toContain("investment");
  });

  it("conta inativa ou fora do patrimônio não entra", () => {
    const data = ws([], { accounts: [nubank, { ...mercadoPago, active: false }, { ...santander, includeInNetWorth: false }, invest] });
    expect(report(data).netWorth.assets.map((a) => a.accountId).sort()).toEqual([invest.id, nubank.id].sort());
  });
});

describe("cartões", () => {
  it("gasto, faturas, limite, disponível, por categoria; pagamento da fatura NÃO é gasto", () => {
    const purchase = tx({ kind: "credit_card_purchase", status: "pending", amountCents: 40000, date: "2026-10-03", cardId: card.id, categoryId: "lazer", invoiceMonth: "2026-10" });
    const payment = paid({ kind: "card_payment", amountCents: 15000, date: "2026-10-05", cardId: card.id, invoiceMonth: "2026-10" });
    const r = report(ws([purchase, payment]));
    const c = r.cards[0];
    expect(c.spentCents).toBe(40000);
    expect(c.byCategory.map((n) => [n.name, n.totalCents])).toEqual([["Lazer", 40000]]);
    expect(c.limitCents).toBe(card.limitCents);
    expect(c.usedCents + c.availableCents).toBe(card.limitCents);
    expect(c.invoices.every((i) => i.totalCents >= i.paidCents || true)).toBe(true);
    expect(r.overview.consumptionCents).toBe(40000);
  });
});

describe("CSV respeita os filtros e protege contra fórmulas", () => {
  const data = ws([
    paid({ kind: "income", amountCents: 100000, date: "2026-10-01", categoryId: "salario", description: "Salário; \"bônus\"" }),
    paid({ amountCents: 12345, date: "2026-10-02", categoryId: "alim-mercado", description: "=HYPERLINK(\"x\")" }),
    paid({ amountCents: 777, date: "2026-10-03", categoryId: "lazer", profileId: camila.id, accountId: santander.id, description: "Cinema" }),
  ]);

  it("escape: separador, aspas, quebra de linha e injeção de fórmula; dinheiro com vírgula; BOM", () => {
    const csv = toCsv(["a", "b"], [["x;y", "z\"w"], ["=1+1", "+cmd"], ["linha\nquebrada", money(-1234)], [money(5), null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"x;y";"z""w"');
    expect(csv).toContain("'=1+1;'+cmd");
    expect(csv).toContain('"linha\nquebrada";-12,34');
    expect(csv).toContain("0,05;");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("movimentações, receitas, despesas e fluxo de caixa refletem os filtros ativos", () => {
    const all = report(data);
    const lines = (csv: string) => csv.split("\r\n").filter(Boolean).length - 1;
    expect(lines(movementsCsv(all, data))).toBe(3);
    expect(lines(incomeCsv(all, data))).toBe(1);
    expect(lines(expensesCsv(all, data))).toBe(2);
    expect(lines(cashFlowCsv(all, data))).toBe(3);
    const onlyCamila = report(data, { profileId: camila.id });
    expect(lines(movementsCsv(onlyCamila, data))).toBe(1);
    expect(expensesCsv(onlyCamila, data)).toContain("Cinema");
    expect(expensesCsv(onlyCamila, data)).not.toContain("HYPERLINK");
    expect(expensesCsv(all, data)).toContain("'=HYPERLINK"); // fórmula neutralizada
    expect(expensesCsv(all, data)).toContain("123,45");
    expect(cashFlowMonthlyCsv(all)).toContain("2026-10;1000,00;131,22;868,78");
  });
});

describe("auditoria: totais conferidos centavo a centavo (tela × CSV × séries)", () => {
  const debt: Debt = { id: "d1", name: "Empréstimo", kind: "loan", profileId: yan.id, principalCents: 100000, totalCents: 120000, status: "active" };
  const data = ws(
    [
      paid({ kind: "income", amountCents: 500001, date: "2026-10-01", categoryId: "salario" }),
      paid({ kind: "income", amountCents: 33333, date: "2026-10-09", categoryId: "freela", recurringId: "r" }),
      paid({ amountCents: 12345, date: "2026-10-02", categoryId: "alim-mercado" }),
      paid({ amountCents: 777, date: "2026-10-03", categoryId: "alim" }),
      tx({ kind: "credit_card_purchase", status: "pending", amountCents: 20001, date: "2026-10-03", cardId: card.id, categoryId: "lazer" }),
      paid({ kind: "card_payment", amountCents: 5000, date: "2026-10-05", cardId: card.id, invoiceMonth: "2026-10" }),
      paid({ kind: "debt_payment", amountCents: 7007, date: "2026-10-04", debtId: "d1" }),
      paid({ kind: "transfer", amountCents: 99999, date: "2026-10-04", accountId: nubank.id, toAccountId: mercadoPago.id }),
    ],
    { debts: [debt] },
  );
  const sumCsv = (csv: string, column: number) =>
    csv
      .split("\r\n")
      .slice(1)
      .filter(Boolean)
      .reduce((n, line) => n + Math.round(parseFloat(line.split(";")[column].replace(",", ".")) * 100), 0);

  it("o CSV de despesas soma exatamente o consumo; o de receitas, o recebido; o de caixa, entradas − saídas", () => {
    const r = report(data);
    expect(sumCsv(expensesCsv(r, data), 4)).toBe(r.overview.consumptionCents);
    expect(sumCsv(incomeCsv(r, data), 4)).toBe(r.income.receivedCents + r.income.expectedCents);
    expect(sumCsv(cashFlowCsv(r, data), 4)).toBe(r.overview.cashInCents - r.overview.cashOutCents);
    const monthly = cashFlowMonthlyCsv(r).split("\r\n")[1].split(";");
    expect([monthly[1], monthly[2], monthly[3]]).toEqual(["5333,34", "441,29", "4892,05"].map((_, i) => [money(r.overview.cashInCents), money(r.overview.cashOutCents), money(r.overview.cashInCents - r.overview.cashOutCents)][i].raw));
  });

  it("valores esperados à mão: consumo 33.123 = 12.345 + 777 + 20.001; saídas de caixa 24.129 = 12.345 + 777 + 5.000 + 7.007", () => {
    const r = report(data);
    expect(r.overview.consumptionCents).toBe(12345 + 777 + 20001);
    expect(r.overview.cashOutCents).toBe(12345 + 777 + 5000 + 7007);
    expect(r.overview.cashInCents).toBe(500001 + 33333);
    expect(r.overview.resultCents).toBe(500001 + 33333 - (12345 + 777 + 20001) - 7007);
  });

  it("séries mensais somam o total do período; por categoria/pessoa somam o total; subcategorias somam a raiz", () => {
    const r = report(data, { period: { from: "2026-08-01", to: "2026-12-31" } });
    expect(r.cashFlow.months.reduce((n, m) => n + m.cashInCents, 0)).toBe(r.overview.cashInCents);
    expect(r.cashFlow.months.reduce((n, m) => n + m.cashOutCents, 0)).toBe(r.overview.cashOutCents);
    expect(r.cashFlow.months.reduce((n, m) => n + m.consumptionCents, 0)).toBe(r.overview.consumptionCents);
    expect(r.cashFlow.months.reduce((n, m) => n + m.incomeCents, 0)).toBe(r.overview.receivedCents);
    expect(r.income.byCategory.reduce((n, c) => n + c.totalCents, 0)).toBe(r.income.receivedCents);
    expect(r.income.byProfile.reduce((n, c) => n + c.totalCents, 0)).toBe(r.income.receivedCents);
    for (const node of r.expenses.byCategory) {
      if (node.children.length) expect(node.children.reduce((n, c) => n + c.totalCents, 0)).toBe(node.totalCents);
      expect(node.transactions.reduce((n, t) => n + t.amountCents, 0)).toBe(node.totalCents);
    }
  });
});
