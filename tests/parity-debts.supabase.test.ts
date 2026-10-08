/**
 * PARIDADE DE DÍVIDAS: o mesmo roteiro roda no motor LOCAL (domain/debts.ts + local-debt) e no SUPABASE REAL (RPCs +
 * views v_debt_summary / v_debt_installments), e parcelas, pago, restante, progresso, situação, saldo, "Despesas
 * realizadas", dashboard e "Disponível de verdade" precisam ser IGUAIS. Integração: só com o usuário descartável
 * configurado (veja tests/support/parity-harness.ts); sem ele, é pulado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMonths } from "@/domain/dates";
import type { Debt } from "@/domain/types";
import type { DebtInput } from "@/services/debt-commands";
import { ENABLED, makeLocal, makeSupabase, metrics, today, type Side, type SupabaseSide } from "./support/parity-harness";

/** 1º vencimento = 4 meses atrás, dia 12: algumas parcelas já vencidas (atrasadas), outras futuras. */
const firstDue = `${addMonths(`${today.slice(0, 7)}-12`, -4)}`;

describe.skipIf(!ENABLED)("paridade de dívidas: motor local x Supabase (usuário descartável)", { timeout: 240_000 }, () => {
  let local: Side;
  let remote: Side;
  let sb: SupabaseSide;
  const sides = () => [local, remote];
  const sync = async () => {
    for (const s of sides()) await s.refresh();
  };
  const same = async (label: string) => {
    await sync();
    expect(metrics(remote), label).toEqual(metrics(local));
  };
  const both = async <T,>(fn: (s: Side) => Promise<T>) => {
    const a = await fn(local);
    const b = await fn(remote);
    await sync();
    return [a, b] as [T, T];
  };
  const debtOf = (s: Side, name: string): Debt => s.data.debts.find((d) => d.name === name)!;
  const input = (s: Side, over: Partial<DebtInput>): DebtInput => ({
    name: "Empréstimo Banco X", creditor: "Banco X", kind: "loan", profileId: s.ids.profile, principalCents: 800000, totalCents: 1030000,
    installments: 13, firstDueDate: firstDue, paymentAccountId: s.ids.accA, categoryId: undefined, ...over,
  });
  const pay = (name: string, amountCents: number) => both((s) => s.debt.pay({ debtId: debtOf(s, name).id, accountId: s.ids.accA, amountCents, date: today }));

  beforeAll(async () => {
    local = makeLocal();
    sb = await makeSupabase();
    remote = sb.side;
    await local.refresh();
  });
  afterAll(async () => {
    if (sb) await sb.cleanup();
  });

  it("criar: simples (sem parcelas) e parcelada — mesmo cronograma, sem perder centavos, saldo intacto", async () => {
    const balances = metrics(remote).balances;
    await both((s) => s.debt.create(input(s, { name: "Familiar", creditor: undefined, kind: "personal", principalCents: 150000, totalCents: 150000, installments: undefined, firstDueDate: undefined, notes: "sem juros" })));
    await both((s) => s.debt.create(input(s, {})));
    await both((s) => s.debt.create(input(s, { name: "Notebook externo", kind: "external_installment", principalCents: 100000, totalCents: 100000, installments: 3, firstDueDate: addMonths(today, 1) })));
    await same("dívidas criadas");
    const m = metrics(remote);
    expect(m.balances).toEqual(balances); // criar dívida não move saldo
    const loan = m.debts.find((d) => d.name === "Empréstimo Banco X")!;
    expect(loan.installments.reduce((sum, i) => sum + (i[2] as number), 0)).toBe(1030000);
    expect(m.debts.find((d) => d.name === "Notebook externo")!.installments.map((i) => i[2])).toEqual([33334, 33333, 33333]);
    expect(m.dashboard.summary.spentCents).toBe(0); // nada de despesa só por cadastrar
  });

  it("pagar parcela, pagamento parcial e vários pagamentos: pago, restante, progresso, parcelas e saldo iguais", async () => {
    await pay("Empréstimo Banco X", 79231);
    await same("1 parcela");
    await pay("Empréstimo Banco X", 50000);
    await same("pagamento parcial");
    await pay("Empréstimo Banco X", 200000);
    await same("pagamento adiantado cobre as seguintes");
    const m = metrics(remote);
    const loan = m.debts.find((d) => d.name === "Empréstimo Banco X")!;
    expect(loan).toMatchObject({ paid: 329231, remaining: 700769, payments: 3 });
    expect(m.balances.A).toBe(100000 - 329231);
    expect(loan.installments.reduce((sum, i) => sum + (i[3] as number) + (i[4] as number), 0)).toBe(1030000); // pago + aberto = total
  });

  it("dívida sem parcelas: pagamentos livres até zerar; 'quitada' é derivada", async () => {
    await pay("Familiar", 50000);
    await pay("Familiar", 30000);
    await same("500 + 300");
    await pay("Familiar", 70000);
    await same("zerou");
    expect(metrics(remote).debts.find((d) => d.name === "Familiar")).toMatchObject({ remaining: 0, derived: "paid", progress: 100 });
  });

  it("pagar acima do restante e pagar quitada: ambos recusam e nada muda", async () => {
    const frozen = metrics(remote);
    for (const s of sides()) {
      await expect(s.debt.pay({ debtId: debtOf(s, "Empréstimo Banco X").id, accountId: s.ids.accA, amountCents: 700770, date: today }), `${s.name}: acima`).rejects.toThrow(/saldo devido/);
      await expect(s.debt.pay({ debtId: debtOf(s, "Familiar").id, accountId: s.ids.accA, amountCents: 1, date: today }), `${s.name}: quitada`).rejects.toThrow();
    }
    await same("nada mudou");
    expect(metrics(remote)).toEqual(frozen);
  });

  it("dashboard: Disponível de verdade coerente; pagamento é despesa UMA vez, em 'Dívidas'; gráfico bate", async () => {
    await same("estado");
    const before = metrics(remote).dashboard;
    await pay("Notebook externo", 33334);
    await same("pagou parcela do notebook");
    const after = metrics(remote).dashboard;
    // saldo e obrigação (parcela do notebook ainda não vencida => fora do disponível): spent sobe 1x
    expect(after.summary.spentCents).toBe(before.summary.spentCents + 33334);
    expect(after.chartEqualsSpent).toBe(true);
    expect(after.byCategory.some((c) => c[0] === "Dívidas")).toBe(true);
    // Pagar o que está EM ABERTO até o mês: saldo cai e obrigação cai igual => disponível constante.
    const m0 = metrics(remote).dashboard;
    const open = Math.min(79231, m0.available.debtsCents);
    expect(open).toBeGreaterThan(0);
    await pay("Empréstimo Banco X", open);
    await same("pagou obrigação em aberto do empréstimo");
    const m1 = metrics(remote).dashboard;
    expect(m1.summary.availableCents).toBe(m0.summary.availableCents);
    expect(m1.summary.balanceCents).toBe(m0.summary.balanceCents - open);
    expect(m1.available.debtsCents).toBe(m0.available.debtsCents - open);
    // Pagar ALÉM do que vence até o mês adianta parcela futura (que ainda não conta no disponível): o disponível cai
    // exatamente nesse excedente — e só nele.
    const surplus = 10000;
    await pay("Empréstimo Banco X", m1.available.debtsCents + surplus);
    await same("pagou além do vencido");
    const m2 = metrics(remote).dashboard;
    expect(m2.available.debtsCents).toBe(0);
    expect(m2.summary.availableCents).toBe(m1.summary.availableCents - surplus);
  });

  it("editar, pausar e reativar; cancelar só sem pagamentos", async () => {
    await both((s) => s.debt.update(debtOf(s, "Empréstimo Banco X"), { notes: "renegociado", totalCents: 1100000, installments: 14 }));
    await same("editado (cronograma recalculado)");
    await both((s) => s.debt.setStatus(debtOf(s, "Empréstimo Banco X"), "paused"));
    await same("pausada: fora do disponível, sem atraso");
    expect(metrics(remote).debts.find((d) => d.name === "Empréstimo Banco X")!.derived).toBe("paused");
    await both((s) => s.debt.setStatus(debtOf(s, "Empréstimo Banco X"), "active"));
    for (const s of sides()) {
      await expect(s.debt.setStatus(debtOf(s, "Empréstimo Banco X"), "canceled"), `${s.name}`).rejects.toThrow(/pagamentos/);
      await expect(s.debt.update(debtOf(s, "Empréstimo Banco X"), { totalCents: 100000, principalCents: 100000 }), `${s.name}`).rejects.toThrow(/abaixo/);
    }
    await same("recusas não alteram nada");
  });

  it("quitação antecipada: valor efetivamente pago e desconto; encerra; reabrir devolve o desconto ao saldo", async () => {
    const [a, b] = await both((s) => s.debt.settle({ debtId: debtOf(s, "Empréstimo Banco X").id, accountId: s.ids.accA, amountCents: 500000, date: today }));
    expect(b).toEqual(a);
    await same("quitada");
    const loan = metrics(remote).debts.find((d) => d.name === "Empréstimo Banco X")!;
    expect(loan).toMatchObject({ remaining: 0, derived: "paid", progress: 100 });
    expect(loan.discount).toBe(b.discountCents);
    expect(loan.installments.every((i) => i[4] === 0)).toBe(true);
    for (const s of sides()) {
      await expect(s.debt.pay({ debtId: debtOf(s, "Empréstimo Banco X").id, accountId: s.ids.accA, amountCents: 100, date: today }), s.name).rejects.toThrow(/quitada/);
    }
    await both((s) => s.debt.reopen(debtOf(s, "Empréstimo Banco X")));
    await same("reaberta");
    expect(metrics(remote).debts.find((d) => d.name === "Empréstimo Banco X")!.remaining).toBe(b.discountCents);
  });

  it("pagamento de dívida não é editável pelo fluxo genérico; excluir desfaz e reabre o saldo", async () => {
    const find = (s: Side) => s.data.transactions.find((t) => t.debtId === debtOf(s, "Notebook externo").id)!;
    for (const s of sides()) {
      await expect(s.commands.update(find(s), { amountCents: 1 }), s.name).rejects.toThrow(/Dívidas/);
      await expect(s.commands.setStatus(find(s), "pending"), s.name).rejects.toThrow(/Dívidas/);
    }
    await both((s) => s.commands.delete(find(s)));
    await same("pagamento excluído");
    expect(metrics(remote).debts.find((d) => d.name === "Notebook externo")).toMatchObject({ paid: 0, remaining: 100000 });
  });
});
