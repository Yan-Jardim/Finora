import { beforeEach, describe, expect, it } from "vitest";
import { accountBalance, monthBreakdown, sum } from "@/domain/calculations";
import { debtInstallments, debtPaid, debtSchedule, debtSummary, deriveDebtViews } from "@/domain/debts";
import { splitCents } from "@/domain/installments";
import type { Debt } from "@/domain/types";
import { ALL_PROFILES, buildDashboard } from "@/services/dashboard-service";
import { LocalDebtCommands } from "@/services/local-debt";
import { LocalTransactionCommands } from "@/services/local-transaction-commands";
import { createRepos, installFakeStorage, nubank, TODAY, workspace, yan } from "./helpers";

const debt = (over: Partial<Debt> = {}): Debt => ({
  id: "d1", name: "Empréstimo Banco X", creditor: "Banco X", kind: "loan", profileId: yan.id, principalCents: 800000, totalCents: 1030000,
  installments: 13, firstDueDate: "2026-06-12", categoryId: "dividas", status: "active", ...over,
});

describe("cronograma derivado", () => {
  it("R$ 10.300 em 13x soma exatamente o total, sem perder centavos (split_cents)", () => {
    const schedule = debtSchedule(debt());
    expect(schedule).toHaveLength(13);
    expect(sum(schedule.map((s) => s.amountCents))).toBe(1030000);
    expect(schedule.map((s) => s.amountCents)).toEqual([...Array(10).fill(79231), ...Array(3).fill(79230)]);
    expect(schedule[0].dueDate).toBe("2026-06-12");
    expect(schedule[12].dueDate).toBe("2027-06-12");
  });
  it("R$ 1.000 / 3 = 333,34 / 333,33 / 333,33 e dia 31 cai no fim do mês curto", () => {
    expect(splitCents(100000, 3)).toEqual([33334, 33333, 33333]);
    expect(debtSchedule(debt({ totalCents: 100000, principalCents: 100000, installments: 3, firstDueDate: "2026-01-31" })).map((s) => s.dueDate)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31",
    ]);
  });
  it("dívida sem parcelas não tem cronograma", () => {
    expect(debtSchedule(debt({ installments: undefined, firstDueDate: undefined }))).toEqual([]);
  });
});

describe("alocação dos pagamentos nas parcelas (cascata)", () => {
  it("pagamento parcial deixa o restante da parcela em aberto; adiantado cobre as seguintes", () => {
    const rows = debtInstallments(debt(), 79231 + 50000, TODAY);
    expect(rows[0]).toMatchObject({ status: "paid", openCents: 0 });
    expect(rows[1]).toMatchObject({ status: "partial", paidCents: 50000, openCents: 29231 });
    expect(rows[2]).toMatchObject({ status: "open", openCents: 79231 });
    const early = debtInstallments(debt(), 300000, TODAY);
    expect(early.filter((r) => r.status === "paid")).toHaveLength(3);
    expect(sum(early.map((r) => r.paidCents + r.openCents))).toBe(1030000); // pago + aberto == total: sem dupla contagem
  });
  it("vencida só se ativa e em aberto; pausada não atrasa; quitada/cancelada não tem nada em aberto", () => {
    expect(debtInstallments(debt(), 0, TODAY).filter((r) => r.overdue)).toHaveLength(4); // jun, jul, ago, set (out/12 ainda não venceu)
    expect(debtInstallments(debt({ status: "paused" }), 0, TODAY).some((r) => r.overdue)).toBe(false);
    expect(debtInstallments(debt({ settledAt: TODAY, settlementDiscountCents: 100 }), 0, TODAY).every((r) => r.openCents === 0)).toBe(true);
    expect(debtInstallments(debt({ status: "canceled" }), 0, TODAY).every((r) => r.openCents === 0)).toBe(true);
  });
  it("'quitada' é DERIVADA do saldo (ou do acordo), nunca marcada à mão", () => {
    const d = debt({ installments: undefined, firstDueDate: undefined, totalCents: 150000, principalCents: 150000 });
    expect(debtSummary(d, { cents: 149999, count: 3 }, []).status).toBe("active");
    expect(debtSummary(d, { cents: 150000, count: 3 }, []).status).toBe("paid");
    expect(debtSummary(d, { cents: 150000, count: 3 }, []).progressPercent).toBe(100);
    expect(debtSummary(debt({ status: "paused" }), { cents: 0, count: 0 }, []).status).toBe("paused");
  });
});

describe("motor local de dívidas", () => {
  let repos: ReturnType<typeof createRepos>;
  let debts: LocalDebtCommands;
  let today = TODAY;

  const base = {
    name: "Empréstimo Banco X", creditor: "Banco X", kind: "loan" as const, profileId: yan.id, principalCents: 800000, totalCents: 1030000,
    installments: 13, firstDueDate: "2026-06-12", paymentAccountId: nubank.id, categoryId: "dividas",
  };
  const data = async () => workspace({ transactions: await repos.transactions.list(), debts: await repos.debts.list() });
  const summary = async (id: string) => deriveDebtViews(await repos.debts.list(), await repos.transactions.list(), today).summaries.find((s) => s.debtId === id)!;
  const pay = (debtId: string, amountCents: number) => debts.pay({ debtId, accountId: nubank.id, amountCents, date: TODAY });

  beforeEach(() => {
    installFakeStorage();
    repos = createRepos();
    today = TODAY;
    debts = new LocalDebtCommands(repos, { today: () => today });
  });

  it("dívida simples (sem parcelas): vários pagamentos até zerar; acima do restante é recusado", async () => {
    const id = await debts.create({ ...base, name: "Familiar", creditor: undefined, kind: "personal", principalCents: 150000, totalCents: 150000, installments: undefined, firstDueDate: undefined });
    await pay(id, 50000);
    await pay(id, 30000);
    expect(await summary(id)).toMatchObject({ paidCents: 80000, remainingCents: 70000, status: "active", paymentsCount: 2 });
    await expect(pay(id, 70001)).rejects.toThrow(/saldo devido/);
    expect((await repos.transactions.list()).filter((t) => t.debtId === id)).toHaveLength(2); // a recusa não deixou rastro
    await pay(id, 70000);
    expect(await summary(id)).toMatchObject({ remainingCents: 0, status: "paid", progressPercent: 100 });
    await expect(pay(id, 1)).rejects.toThrow(/totalmente paga/);
  });

  it("pagamento é uma transação debt_payment paga, ligada à dívida, que reduz o saldo da conta", async () => {
    const id = await debts.create(base);
    const before = accountBalance(nubank, await repos.transactions.list());
    const txId = await pay(id, 79231);
    const tx = (await repos.transactions.get(txId))!;
    expect(tx).toMatchObject({ kind: "debt_payment", status: "paid", paidAt: TODAY, accountId: nubank.id, debtId: id, amountCents: 79231 });
    expect(accountBalance(nubank, await repos.transactions.list())).toBe(before - 79231);
    expect(debtPaid(id, await repos.transactions.list())).toEqual({ cents: 79231, count: 1 });
  });

  it("pagamento parcial de parcela, vários pagamentos e progresso", async () => {
    const id = await debts.create(base);
    await pay(id, 79231);
    await pay(id, 50000); // parcial da parcela 2
    const s = await summary(id);
    expect(s).toMatchObject({ paidCents: 129231, remainingCents: 900769, installmentsPaid: 1, installmentsOpen: 12, nextOpenCents: 29231, nextDueDate: "2026-07-12" });
    expect(s.progressPercent).toBe(12.55);
    expect(s.financialCostCents).toBe(230000);
  });

  it("quitação antecipada: registra o valor REAL pago e o desconto; encerra e trava", async () => {
    const id = await debts.create(base);
    await pay(id, 400000);
    const projected = 1030000 - 400000;
    const result = await debts.settle({ debtId: id, accountId: nubank.id, amountCents: 540000, date: TODAY });
    expect(result).toEqual({ projectedCents: projected, paidCents: 540000, discountCents: projected - 540000 });
    expect(await summary(id)).toMatchObject({ remainingCents: 0, status: "paid", settlementDiscountCents: 90000, paidCents: 940000 });
    const ws = await data();
    expect(accountBalance(nubank, ws.transactions)).toBe(nubank.initialBalanceCents - 940000); // saiu o que foi pago, não o projetado
    await expect(pay(id, 100)).rejects.toThrow(/quitada/);
    await expect(debts.update((await repos.debts.get(id))!, { totalCents: 2000000 })).rejects.toThrow(/quitada/);
    await debts.reopen((await repos.debts.get(id))!);
    expect(await summary(id)).toMatchObject({ remainingCents: 90000, status: "active" });
    await expect(debts.settle({ debtId: id, accountId: nubank.id, amountCents: 90001, date: TODAY })).rejects.toThrow(/saldo devido/);
  });

  it("editar: total nunca abaixo do pago; cronograma recalcula e o histórico de pagamentos não muda", async () => {
    const id = await debts.create(base);
    await pay(id, 79231);
    const d = (await repos.debts.get(id))!;
    await expect(debts.update(d, { totalCents: 79230, principalCents: 79230 })).rejects.toThrow(/abaixo/);
    await debts.update(d, { totalCents: 1300000, installments: 26, notes: "renegociado" });
    expect(await summary(id)).toMatchObject({ installmentsCount: 26, paidCents: 79231, totalCents: 1300000 });
    expect((await repos.transactions.list()).filter((t) => t.debtId === id)).toHaveLength(1);
  });

  it("cancelar só sem pagamentos; pausar é reversível", async () => {
    const id = await debts.create(base);
    await debts.setStatus((await repos.debts.get(id))!, "paused");
    expect((await summary(id)).status).toBe("paused");
    await debts.setStatus((await repos.debts.get(id))!, "active");
    await pay(id, 100);
    await expect(debts.setStatus((await repos.debts.get(id))!, "canceled")).rejects.toThrow(/pagamentos/);
    const other = await debts.create({ ...base, name: "Errada" });
    await debts.setStatus((await repos.debts.get(other))!, "canceled");
    expect((await summary(other)).status).toBe("canceled");
    await expect(pay(other, 100)).rejects.toThrow(/cancelada/);
  });

  it("validações", async () => {
    await expect(debts.create({ ...base, totalCents: 100 })).rejects.toThrow(/menor/);
    await expect(debts.create({ ...base, firstDueDate: undefined })).rejects.toThrow(/parcelas/);
    await expect(debts.create({ ...base, name: "  " })).rejects.toThrow(/nome/);
  });

  it("pagamento de dívida não é editável pelo fluxo genérico; excluir reabre o saldo (exceto quitada)", async () => {
    const id = await debts.create(base);
    const txId = await pay(id, 79231);
    const ws = await data();
    const commands = new LocalTransactionCommands(repos, { today: () => today, data: () => ws });
    const tx = ws.transactions.find((t) => t.id === txId)!;
    await expect(commands.update(tx, { amountCents: 1 })).rejects.toThrow(/Dívidas/);
    await expect(commands.setStatus(tx, "pending")).rejects.toThrow(/Dívidas/);
    await commands.delete(tx);
    expect((await summary(id)).paidCents).toBe(0);

    const second = await pay(id, 1000);
    await debts.settle({ debtId: id, accountId: nubank.id, amountCents: 5000, date: TODAY });
    const ws2 = await data();
    const locked = new LocalTransactionCommands(repos, { today: () => today, data: () => ws2 });
    await expect(locked.delete(ws2.transactions.find((t) => t.id === second)!)).rejects.toThrow(/quitada/);
  });

  it("persistência: recarregar (novos repositórios sobre o mesmo storage) mantém dívida e pagamentos", async () => {
    const id = await debts.create(base);
    await pay(id, 79231);
    const reloaded = createRepos();
    expect(await reloaded.debts.list()).toHaveLength(1);
    expect(debtPaid(id, await reloaded.transactions.list()).cents).toBe(79231);
  });
});

describe("dashboard e Disponível de verdade com dívidas", () => {
  let repos: ReturnType<typeof createRepos>;
  let debts: LocalDebtCommands;
  const month = "2026-10";

  const base = {
    name: "Empréstimo Banco X", creditor: "Banco X", kind: "loan" as const, profileId: yan.id, principalCents: 800000, totalCents: 1030000,
    installments: 13, firstDueDate: "2026-06-12", categoryId: "dividas",
  };
  const view = async (profileId = ALL_PROFILES) =>
    buildDashboard(workspace({ transactions: await repos.transactions.list(), debts: await repos.debts.list() }), { profileId, month }, "x", TODAY);

  beforeEach(() => {
    installFakeStorage();
    repos = createRepos();
    debts = new LocalDebtCommands(repos, { today: () => TODAY });
  });

  it("parcelas em aberto até o mês entram no disponível; a própria dívida (contrato) não soma em nada", async () => {
    const empty = await view();
    await debts.create(base);
    const v = await view();
    // jun..out (5 parcelas) vencem até o mês: 5 x 792,31 (a 5ª é a de out/12)
    expect(v.availableBreakdown.debtsCents).toBe(5 * 79231);
    expect(v.summary.availableCents).toBe(empty.summary.availableCents - 5 * 79231);
    expect(v.summary.balanceCents).toBe(empty.summary.balanceCents); // criar a dívida NÃO move saldo
    expect(v.summary.spentCents).toBe(empty.summary.spentCents); // nem vira despesa
    expect(v.upcoming.filter((u) => u.type === "debt")).toHaveLength(5);
  });

  it("pagar uma parcela: saldo cai e a obrigação cai na mesma medida — o disponível NÃO muda (sem dupla redução)", async () => {
    const id = await debts.create(base);
    const before = await view();
    await debts.pay({ debtId: id, accountId: nubank.id, amountCents: 79231, date: TODAY });
    const after = await view();
    expect(after.summary.balanceCents).toBe(before.summary.balanceCents - 79231);
    expect(after.availableBreakdown.debtsCents).toBe(before.availableBreakdown.debtsCents - 79231);
    expect(after.summary.availableCents).toBe(before.summary.availableCents); // matematicamente coerente
  });

  it("pagar ALÉM do que vence até o mês adianta parcela futura: o disponível cai só no excedente", async () => {
    const id = await debts.create(base);
    const before = await view();
    const due = before.availableBreakdown.debtsCents; // 5 parcelas vencidas até out
    await debts.pay({ debtId: id, accountId: nubank.id, amountCents: due + 20000, date: TODAY });
    const after = await view();
    expect(after.availableBreakdown.debtsCents).toBe(0);
    expect(after.summary.availableCents).toBe(before.summary.availableCents - 20000);
  });

  it("pagamento parcial e vários pagamentos mantêm a coerência; quitar zera a obrigação", async () => {
    const id = await debts.create(base);
    const before = await view();
    await debts.pay({ debtId: id, accountId: nubank.id, amountCents: 30000, date: TODAY });
    await debts.pay({ debtId: id, accountId: nubank.id, amountCents: 20000, date: TODAY });
    const mid = await view();
    expect(mid.summary.availableCents).toBe(before.summary.availableCents);
    expect(mid.availableBreakdown.debtsCents).toBe(before.availableBreakdown.debtsCents - 50000);
    await debts.settle({ debtId: id, accountId: nubank.id, amountCents: 100000, date: TODAY });
    const closed = await view();
    expect(closed.availableBreakdown.debtsCents).toBe(0);
    // o que saiu do saldo é o valor real pago; sem obrigação restante o disponível == saldo
    expect(closed.summary.availableCents).toBe(closed.summary.balanceCents);
  });

  it("pagamento é despesa realizada UMA vez (classificada em \"Dívidas\"); o gráfico continua batendo", async () => {
    const id = await debts.create({ ...base, categoryId: undefined });
    const before = await view();
    await debts.pay({ debtId: id, accountId: nubank.id, amountCents: 79231, date: TODAY });
    const after = await view();
    expect(after.summary.spentCents).toBe(before.summary.spentCents + 79231);
    expect(sum(after.spendingByCategory.map((c) => c.amountCents))).toBe(after.summary.spentCents);
    expect(after.spendingByCategory.find((c) => c.name === "Dívidas")?.amountCents).toBe(79231);
    // monthBreakdown (usado também por Movimentações) enxerga o mesmo
    const tx = await repos.transactions.list();
    expect(monthBreakdown(tx, month, TODAY).realizedCents).toBe(79231);
  });

  it("dívida pausada ou cancelada não entra no disponível; filtro de perfil respeita o responsável", async () => {
    const id = await debts.create(base);
    await debts.setStatus((await repos.debts.get(id))!, "paused");
    expect((await view()).availableBreakdown.debtsCents).toBe(0);
    await debts.setStatus((await repos.debts.get(id))!, "active");
    expect((await view("p-camila")).availableBreakdown.debtsCents).toBe(0);
    expect((await view(yan.id)).availableBreakdown.debtsCents).toBe(5 * 79231);
  });
});
