import { describe, expect, it } from "vitest";
import { sum } from "@/domain/calculations";
import { buildPlanning, compareSimulation, planningAlerts, PLANNING_MAX_MONTHS } from "@/domain/planning";
import type { WorkspaceData } from "@/domain/types";
import { LocalDebtCommands } from "@/services/local-debt";
import { LocalRecurrenceCommands } from "@/services/local-recurrence";
import { LocalTransactionCommands } from "@/services/local-transaction-commands";
import { card, casal, createRepos, installFakeStorage, camila, nubank, santander, TODAY, tx, workspace, yan } from "./helpers";

const ALL = { profileId: "all", months: 12 };
const month = (p: ReturnType<typeof buildPlanning>, ym: string) => p.months.find((m) => m.month === ym)!;

describe("projeção básica (saldo atual, receitas e saídas previstas)", () => {
  it("começa no saldo ATUAL das contas (sem investimentos) e encadeia mês a mês", () => {
    const data = workspace({
      transactions: [
        tx({ kind: "income", status: "planned", date: "2026-10-20", amountCents: 500000, accountId: nubank.id }),
        tx({ kind: "expense", status: "pending", date: "2026-10-25", amountCents: 120000, accountId: nubank.id }),
        tx({ kind: "expense", status: "planned", date: "2026-11-10", amountCents: 30000, accountId: nubank.id }),
      ],
    });
    const p = buildPlanning(data, ALL, TODAY);
    expect(p.startBalanceCents).toBe(100000 + 0 + 100000); // nubank + mercado pago + santander (invest fora)
    expect(month(p, "2026-10")).toMatchObject({ startBalanceCents: 200000, incomeCents: 500000, outflowCents: 120000, endBalanceCents: 580000 });
    expect(month(p, "2026-11")).toMatchObject({ startBalanceCents: 580000, outflowCents: 30000, endBalanceCents: 550000 });
    expect(p.months).toHaveLength(12);
    expect(p.endBalanceCents).toBe(550000);
  });

  it("não trata previsto como saldo de hoje; pagas, canceladas e fora do horizonte não entram", () => {
    const data = workspace({
      transactions: [
        tx({ kind: "income", status: "planned", date: "2026-11-05", amountCents: 900000, accountId: nubank.id }),
        tx({ kind: "expense", status: "paid", date: "2026-10-02", amountCents: 50000, accountId: nubank.id }), // já está no saldo
        tx({ kind: "expense", status: "canceled", date: "2026-10-20", amountCents: 70000, accountId: nubank.id }),
        tx({ kind: "expense", status: "planned", date: "2028-03-10", amountCents: 80000, accountId: nubank.id }), // além de 12 meses
      ],
    });
    const p = buildPlanning(data, ALL, TODAY);
    expect(p.startBalanceCents).toBe(200000 - 50000); // a despesa PAGA já está no saldo; o salário previsto NÃO o aumenta
    expect(p.totalIncomeCents).toBe(900000);
    expect(p.totalOutflowCents).toBe(0);
    expect(p.months.at(-1)?.month).toBe("2027-09");
  });

  it("receitas futuras caem no mês certo; virada de ano", () => {
    const data = workspace({ transactions: [tx({ kind: "income", status: "planned", date: "2027-01-10", amountCents: 250000, accountId: nubank.id })] });
    const p = buildPlanning(data, ALL, "2026-12-20");
    expect(p.months.slice(0, 3).map((m) => m.month)).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(month(p, "2027-01").incomeCents).toBe(250000);
    expect(month(p, "2026-12").endBalanceCents).toBe(200000);
    expect(month(p, "2027-01").startBalanceCents).toBe(200000);
    expect(month(p, "2027-01").endBalanceCents).toBe(450000);
  });

  it("filtro de período limita os meses", () => {
    expect(buildPlanning(workspace(), { profileId: "all", months: 3 }, TODAY).months).toHaveLength(3);
    expect(buildPlanning(workspace(), { profileId: "all", months: 99 }, TODAY).months).toHaveLength(PLANNING_MAX_MONTHS);
  });
});

describe("atrasados", () => {
  it("vencimentos atrasados caem no mês atual, marcados, e geram alerta com a quantidade e o valor", () => {
    const data = workspace({
      transactions: [
        tx({ kind: "expense", status: "pending", date: "2026-09-02", dueDate: "2026-09-20", amountCents: 10000, accountId: nubank.id }),
        tx({ kind: "expense", status: "pending", date: "2026-08-02", amountCents: 20000, accountId: nubank.id }),
        tx({ kind: "expense", status: "pending", date: "2026-09-29", amountCents: 5000, accountId: nubank.id }),
      ],
    });
    const p = buildPlanning(data, ALL, TODAY);
    expect(p.overdue).toEqual({ count: 3, cents: 35000 });
    expect(month(p, "2026-10").outflowCents).toBe(35000);
    expect(month(p, "2026-10").items.every((i) => i.overdue)).toBe(true);
    expect(p.alerts.find((a) => a.kind === "overdue")).toMatchObject({ count: 3, cents: 35000 });
  });
});

describe("cartões: sem dupla contagem", () => {
  const purchase = (date: string, amountCents: number, over = {}) =>
    tx({ kind: "credit_card_purchase", status: "pending", date, amountCents, cardId: card.id, ...over });

  it("compra no cartão sai UMA vez, no vencimento da fatura (nunca pela data da compra)", () => {
    const data = workspace({ transactions: [purchase("2026-10-03", 30000), purchase("2026-10-25", 40000)] }); // fecha dia 20, vence dia 27
    const p = buildPlanning(data, ALL, TODAY);
    expect(month(p, "2026-10").buckets.invoicesCents).toBe(30000); // out/27
    expect(month(p, "2026-11").buckets.invoicesCents).toBe(40000); // 25/10 fecha em nov -> vence 27/11
    expect(month(p, "2026-10").buckets.billsCents).toBe(0);
    expect(p.totalOutflowCents).toBe(70000); // exatamente o que foi comprado
  });

  it("compra parcelada: cada parcela entra pela fatura do ciclo dela; soma = total", async () => {
    installFakeStorage();
    const repos = createRepos();
    const ws = () => workspace({ transactions: [] });
    const commands = new LocalTransactionCommands(repos, { today: () => TODAY, data: ws });
    await commands.createInstallmentPurchase({ description: "TV", totalCents: 90001, installments: 3, date: "2026-10-03", cardId: card.id, profileId: yan.id, categoryId: "c", tags: [] });
    const p = buildPlanning(workspace({ transactions: await repos.transactions.list() }), ALL, TODAY);
    expect([month(p, "2026-10"), month(p, "2026-11"), month(p, "2026-12")].map((m) => m.buckets.invoicesCents)).toEqual([30001, 30000, 30000]);
    expect(p.totalOutflowCents).toBe(90001);
    const invoice = month(p, "2026-10").items.find((i) => i.type === "invoice")!;
    expect(invoice.parts).toHaveLength(1); // a compra que compõe a fatura
    expect(invoice.unlistedCents).toBe(0);
  });

  it("pagamento de fatura: o pago já está no saldo; só o que falta é projetado (fluxo neutro)", async () => {
    installFakeStorage();
    const repos = createRepos();
    await repos.transactions.createMany([purchase("2026-10-03", 50000)]);
    const ws = () => workspace({ transactions: [] });
    const before = buildPlanning(workspace({ transactions: await repos.transactions.list() }), ALL, TODAY);
    const commands = new LocalTransactionCommands(repos, { today: () => TODAY, data: () => workspace({ transactions: [] }) });
    void ws;
    void commands;
    await repos.transactions.create({ kind: "card_payment", description: "pgto", amountCents: 20000, date: TODAY, paidAt: TODAY, status: "paid", accountId: nubank.id, cardId: card.id, invoiceMonth: "2026-10", profileId: yan.id, tags: [] });
    const after = buildPlanning(workspace({ transactions: await repos.transactions.list() }), ALL, TODAY);
    expect(after.startBalanceCents).toBe(before.startBalanceCents - 20000);
    expect(month(after, "2026-10").buckets.invoicesCents).toBe(30000); // só o que falta
    expect(after.endBalanceCents).toBe(before.endBalanceCents); // pagar não muda o resultado final: sem dupla contagem
  });

  it("compra recorrente no cartão também entra só pela fatura", async () => {
    installFakeStorage();
    const repos = createRepos();
    const recurrence = new LocalRecurrenceCommands(repos, { today: () => TODAY });
    await recurrence.create({ kind: "credit_card_purchase", description: "Netflix", amountCents: 5590, profileId: yan.id, cardId: card.id, categoryId: "c", tags: [], frequency: "monthly", interval: 1, startDate: "2026-10-05" });
    const p = buildPlanning(workspace({ transactions: await repos.transactions.list() }), ALL, TODAY);
    // out/05 já passou (a regra começa hoje): primeira ocorrência = nov/05 -> fatura de dez/27? ciclo: 05/11 <= 20 -> vence 27/11
    expect(p.months.filter((m) => m.buckets.invoicesCents > 0).every((m) => m.buckets.invoicesCents === 5590)).toBe(true);
    expect(sum(p.months.map((m) => m.buckets.invoicesCents))).toBeGreaterThanOrEqual(11 * 5590);
    expect(sum(p.months.map((m) => m.buckets.recurringBillsCents))).toBe(0); // não aparece também como conta
  });
});

describe("dívidas", () => {
  it("só as parcelas EM ABERTO de dívidas ativas entram; pagas, pausadas e o contrato não", async () => {
    installFakeStorage();
    const repos = createRepos();
    const debts = new LocalDebtCommands(repos, { today: () => TODAY });
    const id = await debts.create({ name: "Empréstimo", kind: "loan", profileId: yan.id, principalCents: 800000, totalCents: 1030000, installments: 13, firstDueDate: "2026-06-12" });
    const data = async (): Promise<WorkspaceData> => workspace({ transactions: await repos.transactions.list(), debts: await repos.debts.list() });

    let p = buildPlanning(await data(), ALL, TODAY);
    expect(p.totalOutflowCents).toBe(1030000); // 13 parcelas, nada pago ainda
    expect(p.overdue.count).toBe(4); // jun–set
    expect(month(p, "2026-10").buckets.debtsCents).toBe(4 * 79231 + 79231); // 4 atrasadas + out/12

    await debts.pay({ debtId: id, accountId: nubank.id, amountCents: 79231 * 2, date: TODAY });
    p = buildPlanning(await data(), ALL, TODAY);
    expect(p.totalOutflowCents).toBe(1030000 - 79231 * 2); // o pago saiu da projeção (e do saldo)
    expect(p.startBalanceCents).toBe(200000 - 79231 * 2);

    await debts.setStatus((await repos.debts.get(id))!, "paused");
    expect(buildPlanning(await data(), ALL, TODAY).totalOutflowCents).toBe(0);
    await debts.setStatus((await repos.debts.get(id))!, "active");
    await debts.settle({ debtId: id, accountId: nubank.id, amountCents: 100000, date: TODAY });
    expect(buildPlanning(await data(), ALL, TODAY).totalOutflowCents).toBe(0); // quitada: nada em aberto
  });

  it("dívida sem parcelas não tem vencimento: não é projetada", async () => {
    installFakeStorage();
    const repos = createRepos();
    await new LocalDebtCommands(repos, { today: () => TODAY }).create({ name: "Familiar", kind: "personal", profileId: yan.id, principalCents: 150000, totalCents: 150000 });
    expect(buildPlanning(workspace({ debts: await repos.debts.list() }), ALL, TODAY).totalOutflowCents).toBe(0);
  });
});

describe("recorrências", () => {
  it("salário e despesa recorrentes entram pelas ocorrências materializadas, dentro do horizonte de 12 meses", async () => {
    installFakeStorage();
    const repos = createRepos();
    const recurrence = new LocalRecurrenceCommands(repos, { today: () => TODAY });
    const base = { profileId: yan.id, accountId: nubank.id, categoryId: "c", tags: [], frequency: "monthly" as const, interval: 1 };
    await recurrence.create({ ...base, kind: "income", description: "Salário", amountCents: 1000000, startDate: "2026-10-20" });
    await recurrence.create({ ...base, kind: "expense", description: "Internet", amountCents: 12000, startDate: "2026-10-10" });
    const p = buildPlanning(workspace({ transactions: await repos.transactions.list() }), ALL, TODAY);
    expect(p.months).toHaveLength(12);
    expect(p.months.every((m) => m.buckets.incomeRecurringCents === 1000000)).toBe(true);
    expect(p.months.every((m) => m.buckets.recurringBillsCents === 12000)).toBe(true);
    expect(p.totalIncomeCents).toBe(12 * 1000000);
    expect(p.months.at(-1)?.month).toBe("2027-09"); // nada além do horizonte
    expect(month(p, "2026-12").endBalanceCents).toBe(200000 + 3 * (1000000 - 12000));
  });
});

describe("saldo negativo e alertas derivados dos dados", () => {
  const data = workspace({
    transactions: [
      tx({ kind: "income", status: "planned", date: "2026-10-20", amountCents: 100000, accountId: nubank.id }),
      tx({ kind: "expense", status: "planned", date: "2026-11-10", amountCents: 700000, accountId: nubank.id }),
      tx({ kind: "expense", status: "planned", date: "2026-12-10", amountCents: 50000, accountId: nubank.id }),
      tx({ kind: "credit_card_purchase", status: "pending", date: "2026-10-25", amountCents: 350000, cardId: card.id }),
    ],
  });

  it("saldo projetado negativo, déficits e faturas do próximo mês saem dos números reais", () => {
    const p = buildPlanning(data, ALL, TODAY);
    const negative = p.alerts.find((a) => a.kind === "negative_balance")!;
    expect(negative.month).toBe("2026-11");
    expect(negative.cents).toBe(month(p, "2026-11").endBalanceCents);
    expect(negative.cents).toBeLessThan(0);
    expect(p.alerts.filter((a) => a.kind === "deficit").map((a) => [a.month, a.cents])).toEqual([
      ["2026-11", 700000 + 350000 - 0],
      ["2026-12", 50000],
    ]);
    expect(p.alerts.find((a) => a.kind === "invoices_next_month")).toMatchObject({ month: "2026-11", cents: 350000 });
    expect(p.lowest).toEqual({ month: "2026-12", balanceCents: month(p, "2026-12").endBalanceCents });
  });

  it("sem problemas, não há alertas (nada de texto fixo)", () => {
    expect(planningAlerts(buildPlanning(workspace(), ALL, TODAY))).toEqual([]);
  });
});

describe("pessoas e Casal: consolidado sem duplicar", () => {
  const data = workspace({
    transactions: [
      tx({ kind: "income", status: "planned", date: "2026-10-20", amountCents: 800000, accountId: nubank.id, profileId: yan.id }),
      tx({ kind: "income", status: "planned", date: "2026-10-22", amountCents: 600000, accountId: santander.id, profileId: camila.id }),
      tx({ kind: "expense", status: "planned", date: "2026-11-05", amountCents: 320000, accountId: nubank.id, profileId: casal.id }),
      tx({ kind: "expense", status: "pending", date: "2026-10-25", amountCents: 12000, accountId: santander.id, profileId: camila.id }),
      tx({ kind: "credit_card_purchase", status: "pending", date: "2026-10-03", amountCents: 45000, cardId: card.id, profileId: casal.id }), // cartão do Yan
    ],
  });

  it("as partes somam o todo (cada item tem UM dono)", () => {
    const all = buildPlanning(data, ALL, TODAY);
    const parts = [yan.id, camila.id, casal.id].map((profileId) => buildPlanning(data, { profileId, months: 12 }, TODAY));
    expect(sum(parts.map((p) => p.startBalanceCents))).toBe(all.startBalanceCents);
    expect(sum(parts.map((p) => p.totalIncomeCents))).toBe(all.totalIncomeCents);
    expect(sum(parts.map((p) => p.totalOutflowCents))).toBe(all.totalOutflowCents);
    for (let i = 0; i < 12; i++) expect(sum(parts.map((p) => p.months[i].incomeCents))).toBe(all.months[i].incomeCents);
  });

  it("cada visão respeita o perfil: contas pelo dono, despesa pelo responsável, fatura pelo dono do cartão", () => {
    const y = buildPlanning(data, { profileId: yan.id, months: 12 }, TODAY);
    const m = buildPlanning(data, { profileId: camila.id, months: 12 }, TODAY);
    const c = buildPlanning(data, { profileId: casal.id, months: 12 }, TODAY);
    expect(y.startBalanceCents).toBe(100000); // nubank + mp (invest fora)
    expect(y.totalIncomeCents).toBe(800000);
    expect(y.totalOutflowCents).toBe(45000); // fatura do cartão do Yan (a compra é do Casal, mas a fatura é do dono do cartão)
    expect(m.totalIncomeCents).toBe(600000);
    expect(m.totalOutflowCents).toBe(12000);
    expect(c.totalOutflowCents).toBe(320000); // a conta do Casal; a compra no cartão NÃO entra duas vezes
    expect(c.startBalanceCents).toBe(0);
  });

  it("perfil desconhecido cai em Todos", () => {
    expect(buildPlanning(data, { profileId: "nao-existe", months: 12 }, TODAY).profileId).toBe("all");
  });
});

describe("simulador de compra (não grava nada)", () => {
  const data = workspace({ transactions: [tx({ kind: "income", status: "planned", date: "2026-10-20", amountCents: 100000, accountId: nubank.id })] });
  const sim = { description: "Notebook", totalCents: 400000, installments: 10, date: "2026-10-06", method: "card" as const, cardId: card.id };

  it("10x no cartão: impacto mensal pelos vencimentos das faturas e efeito acumulado no saldo", () => {
    const result = compareSimulation(data, ALL, TODAY, sim);
    const impacts = result.months.map((m) => m.impactCents);
    expect(sum(impacts)).toBe(400000); // a compra inteira, uma vez
    expect(impacts.filter((i) => i > 0)).toHaveLength(10);
    expect(impacts[0]).toBe(40000); // 06/10 <= fechamento 20 -> vence 27/10
    expect(result.months[9].simEndCents).toBe(result.months[9].baseEndCents - 400000);
    expect(result.base.endBalanceCents).toBeGreaterThan(result.withPurchase.endBalanceCents);
    expect(result.fitsCardLimit).toBe(true); // limite 5.000,00
  });

  it("aponta saldo que fica negativo por causa da compra e estouro de limite", () => {
    const big = compareSimulation(data, ALL, TODAY, { ...sim, totalCents: 900000, installments: 3 });
    expect(big.newNegativeMonths.length).toBeGreaterThan(0);
    expect(big.fitsCardLimit).toBe(false);
  });

  it("à vista sai na data; descartar = projeção igual à base; os dados originais não mudam", () => {
    const frozen = JSON.stringify(data.transactions);
    const cash = compareSimulation(data, ALL, TODAY, { ...sim, method: "cash", installments: 1 });
    expect(cash.months[0].impactCents).toBe(400000);
    expect(buildPlanning(data, ALL, TODAY)).toEqual(cash.base); // sem simulação = base
    expect(JSON.stringify(data.transactions)).toBe(frozen);
  });
});

