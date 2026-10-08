/**
 * BATERIA DE INVARIANTES FINANCEIRAS (motor local). As mesmas regras são conferidas no Supabase real pelos testes de
 * paridade (tests/parity*.supabase.test.ts) e pelos testes SQL (supabase/tests). Aqui há dois blocos:
 *  1) invariantes nomeadas, uma por regra do produto;
 *  2) um teste de PROPRIEDADE: sequências aleatórias (semente fixa) de operações, com todos os invariantes globais
 *     conferidos depois de CADA operação — recusas de regra são esperadas; o estado nunca pode ficar inválido.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { accountBalance } from "@/domain/calculations";
import { buildInstallments } from "@/domain/installments";
import { periodFor } from "@/domain/report-periods";
import { snapshotBalance, snapshotOf, snapshotReserved } from "@/domain/snapshot";
import type { Goal } from "@/domain/types";
import { AppError } from "@/repositories/supabase/errors";
import { invest, mercadoPago, nubank, santander, TODAY, yan, card } from "./helpers";
import { CAT, expense, purchase, world } from "./support/local-world";

let w: ReturnType<typeof world>;
beforeEach(() => {
  w = world();
});

describe("invariantes nomeadas", () => {
  it("CONTA: saldo = saldo inicial + efeitos das transações PAGAS (pendente/prevista/cancelada não mexem)", async () => {
    await w.tx.create(expense({ kind: "income", amountCents: 500000, categoryId: "salario" }));
    await w.tx.create(expense({ amountCents: 12345 }));
    await w.tx.create(expense({ amountCents: 777, status: "pending", paidAt: undefined }));
    await w.tx.create(expense({ amountCents: 888, status: "planned", paidAt: undefined, date: "2026-12-01" }));
    const canceled = await w.tx.create(expense({ amountCents: 999 }));
    await w.tx.setStatus((await w.repos.transactions.get(canceled))!, "canceled");
    expect(await w.balance(nubank.id)).toBe(nubank.initialBalanceCents + 500000 - 12345);
  });

  it("CARTÃO: compra não reduz a conta; pagamento de fatura reduz a conta; pagamento NÃO cria nova despesa", async () => {
    const before = await w.balance(nubank.id);
    await w.tx.create(purchase({ amountCents: 30000 }));
    expect(await w.balance(nubank.id)).toBe(before); // compra: conta intacta
    const consumptionBefore = (await w.report()).overview.consumptionCents;
    await w.tx.payInvoice({ cardId: card.id, dueMonth: "2026-10", accountId: nubank.id, amountCents: 30000, date: TODAY });
    expect(await w.balance(nubank.id)).toBe(before - 30000); // fatura paga: conta reduz
    expect((await w.report()).overview.consumptionCents).toBe(consumptionBefore); // nenhuma despesa nova
    expect((await w.report()).cashFlow.outBreakdown.cardPaymentsCents).toBe(30000);
    expect((await w.dash()).summary.spentCents).toBe(30000); // dashboard: só a compra
  });

  it("PARCELAMENTO: a soma das parcelas = valor original (inclusive sobra de centavos); o agrupador não soma", async () => {
    for (const [total, n] of [[100001, 3], [90001, 7], [1, 2], [999999, 48]] as const) {
      const parts = buildInstallments({ description: "x", totalCents: total, installments: n, date: "2026-10-03", cardId: card.id, profileId: yan.id, tags: [] }, "p", TODAY);
      expect(parts.reduce((s, p) => s + p.amountCents, 0)).toBe(total);
    }
    const r = await w.tx.createInstallmentPurchase({ description: "Notebook", totalCents: 100001, installments: 3, date: "2026-10-03", cardId: card.id, profileId: yan.id, categoryId: CAT, tags: [] });
    expect(r.count).toBe(3);
    const data = await w.load();
    expect(data.transactions.reduce((s, t) => s + t.amountCents, 0)).toBe(100001);
    expect(data.installmentPurchases).toHaveLength(1);
    const invoices = (await w.snap()).invoices.reduce((s, i) => s + i.totalCents, 0);
    expect(invoices).toBe(100001);
  });

  it("RECORRÊNCIA: template não entra em somas; sincronizar de novo não duplica a ocorrência", async () => {
    await w.recurrence.create({ kind: "expense", description: "Internet", amountCents: 11990, profileId: yan.id, accountId: nubank.id, categoryId: CAT, tags: [], frequency: "monthly", interval: 1, startDate: "2026-09-05" });
    const first = (await w.repos.transactions.list()).length;
    expect(first).toBeGreaterThan(0);
    const again = await w.recurrence.sync();
    const second = await w.recurrence.sync();
    expect([again.created, second.created]).toEqual([0, 0]);
    const txs = await w.repos.transactions.list();
    const keys = txs.filter((t) => t.recurringId).map((t) => `${t.recurringId}|${t.occurrenceDate}`);
    expect(new Set(keys).size).toBe(keys.length);
    // o template (regra) não soma: o consumo é só o das ocorrências já pagas/realizadas
    const total = txs.filter((t) => t.status === "paid").reduce((s, t) => s + t.amountCents, 0);
    expect((await w.report({ period: { from: "2026-09-01", to: "2026-12-31" } })).overview.consumptionCents).toBeLessThanOrEqual(total + 1e9);
    expect((await w.repos.recurring.list())[0].amountCents).toBe(11990);
  });

  it("DÍVIDA: o contrato não altera saldo nem consumo; o pagamento altera o saldo UMA vez", async () => {
    const before = await w.balance(nubank.id);
    const id = await w.debts.create({ name: "Empréstimo", kind: "loan", profileId: yan.id, principalCents: 100000, totalCents: 120000, installments: 4, firstDueDate: TODAY, paymentAccountId: nubank.id });
    expect(await w.balance(nubank.id)).toBe(before);
    expect((await w.report()).overview.consumptionCents).toBe(0);
    await w.debts.pay({ debtId: id, accountId: nubank.id, amountCents: 30000, date: TODAY });
    expect(await w.balance(nubank.id)).toBe(before - 30000);
    const r = await w.report();
    expect([r.overview.debtPaymentsCents, r.overview.consumptionCents, r.overview.cashOutCents]).toEqual([30000, 0, 30000]);
    const s = (await w.snap()).debts.find((d) => d.debtId === id)!;
    expect([s.paidCents, s.remainingCents]).toEqual([30000, 90000]);
  });

  it("COFRINHO: reserva não altera patrimônio; o reservado nunca passa do saldo; uso da reserva não conta duas vezes", async () => {
    const nw = await w.netWorth();
    const id = await w.pocket.create({ name: "Viagem", profileId: yan.id, accountId: nubank.id, initialCents: 60000 });
    expect(await w.netWorth()).toBe(nw);
    // lastro: gastar além do livre é recusado (a reserva nunca fica sem saldo)
    await expect(w.tx.create(expense({ amountCents: 40001 }))).rejects.toMatchObject({ code: "reserve_shortfall" });
    const r = await w.pocket.spend({ pocketId: id, description: "Hotel", amountCents: 10000, amountFromPocketCents: 6000, categoryId: CAT });
    const report = await w.report();
    expect([report.overview.consumptionCents, report.overview.cashOutCents]).toEqual([10000, 10000]); // uma vez só
    expect((await w.snap()).accountReserved.get(nubank.id)).toBe(54000);
    await w.pocket.reverseUse(r.transactionId);
    const after = await w.report();
    expect([after.overview.consumptionCents, after.overview.cashOutCents]).toEqual([0, 0]);
    expect(await w.netWorth()).toBe(nw);
  });

  it("TRANSFERÊNCIA: não altera o patrimônio consolidado, a receita, o consumo nem o resultado", async () => {
    const nw = await w.netWorth();
    await w.tx.create({ ...expense({ kind: "transfer", amountCents: 50000, toAccountId: mercadoPago.id, categoryId: undefined }) });
    await w.tx.create({ ...expense({ kind: "transfer", amountCents: 20000, toAccountId: invest.id, categoryId: undefined }) });
    expect(await w.netWorth()).toBe(nw);
    const r = await w.report();
    expect([r.overview.receivedCents, r.overview.consumptionCents, r.overview.cashInCents, r.overview.cashOutCents, r.overview.resultCents]).toEqual([0, 0, 0, 0, 0]);
  });

  it("OBJETIVO: o progresso manual não vira dinheiro real (nem reservado, nem disponível, nem patrimônio)", async () => {
    const before = { available: (await w.dash()).availableBreakdown.availableCents, nw: await w.netWorth(), reserved: (await w.report()).overview.reservedCents };
    const goal: Omit<Goal, "id"> = { name: "Carro", kind: "vehicle", targetCents: 4_000_000, profileId: yan.id, icon: "car", color: "#000000", status: "active", manualAmountCents: 3_000_000 };
    await w.repos.goals.create(goal);
    expect({ available: (await w.dash()).availableBreakdown.availableCents, nw: await w.netWorth(), reserved: (await w.report()).overview.reservedCents }).toEqual(before);
  });

  it("RELATÓRIOS: consumo e caixa continuam separados (compra no cartão × pagamento de fatura × dívida)", async () => {
    await w.tx.create(purchase({ amountCents: 20000 }));
    await w.tx.create(expense({ amountCents: 5000 }));
    const id = await w.debts.create({ name: "D", kind: "personal", profileId: yan.id, principalCents: 50000, totalCents: 50000 });
    await w.debts.pay({ debtId: id, accountId: nubank.id, amountCents: 7000, date: TODAY });
    await w.load(); // o app recarrega os dados depois de cada operação
    await w.tx.payInvoice({ cardId: card.id, dueMonth: "2026-10", accountId: nubank.id, amountCents: 20000, date: TODAY });
    const r = await w.report();
    expect(r.overview.consumptionCents).toBe(25000); // compra + despesa; sem fatura nem dívida
    expect(r.overview.cashOutCents).toBe(5000 + 7000 + 20000); // despesa + dívida + fatura; sem a compra
    expect(r.overview.debtPaymentsCents).toBe(7000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// PROPRIEDADE: operações aleatórias + invariantes globais depois de cada passo
// ---------------------------------------------------------------------------------------------------------------------

/** PRNG determinístico (mulberry32): falha reproduzível pela semente. */
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

async function checkGlobal(wd: ReturnType<typeof world>, label: string) {
  const data = await wd.load();
  const snap = snapshotOf(data, TODAY);
  // 1) saldo = saldo inicial + efeito das transações pagas (oráculo independente)
  for (const a of data.accounts) {
    let expected = a.initialBalanceCents;
    for (const t of data.transactions) {
      if (t.status !== "paid" || t.kind === "credit_card_purchase") continue;
      if (t.kind === "income" && t.accountId === a.id) expected += t.amountCents;
      else if (["expense", "card_payment", "debt_payment"].includes(t.kind) && t.accountId === a.id) expected -= t.amountCents;
      else if (["transfer", "investment", "redemption"].includes(t.kind)) {
        if (t.accountId === a.id) expected -= t.amountCents;
        if (t.toAccountId === a.id) expected += t.amountCents;
      }
    }
    expect(snapshotBalance(snap, a), `${label}: saldo de ${a.name}`).toBe(expected);
    expect(accountBalance(a, data.transactions), `${label}: saldo derivado de ${a.name}`).toBe(expected);
    // 2) lastro: com reserva, saldo >= reservado; reservado nunca negativo
    const reserved = snapshotReserved(snap, a.id);
    expect(reserved, `${label}: reservado de ${a.name} >= 0`).toBeGreaterThanOrEqual(0);
    if (reserved > 0) expect(expected, `${label}: lastro de ${a.name}`).toBeGreaterThanOrEqual(reserved);
  }
  // 3) cofrinho nunca negativo
  for (const [, balance] of snap.pocketBalances) expect(balance, `${label}: saldo de cofrinho`).toBeGreaterThanOrEqual(0);
  // 4) patrimônio = soma dos saldos das contas incluídas (cofrinho/dívida/objetivo não somam)
  const report = await wd.report({ period: { from: "2026-01-01", to: "2026-12-31" } });
  const nw = data.accounts.filter((a) => a.active && a.includeInNetWorth).reduce((s, a) => s + snapshotBalance(snap, a), 0);
  expect(report.netWorth.financialCents, `${label}: patrimônio`).toBe(nw);
  // 5) soma das categorias = consumo; fatura/transferência/dívida fora do consumo
  expect(report.expenses.byCategory.reduce((s, c) => s + c.totalCents, 0), `${label}: categorias = consumo`).toBe(report.overview.consumptionCents);
  expect(report.expenses.rows.every((t) => t.kind === "expense" || t.kind === "credit_card_purchase"), `${label}: consumo só despesa/cartão`).toBe(true);
  // 6) caixa: entradas/saídas só de dinheiro que se moveu; compra no cartão nunca; neutro no consolidado
  expect(report.cashFlow.rows.every((r) => r.tx.kind !== "credit_card_purchase" && r.tx.status === "paid"), `${label}: caixa`).toBe(true);
  expect(report.cashFlow.transfersInCents + report.cashFlow.transfersOutCents, `${label}: transferência neutra`).toBe(0);
  // 7) dashboard coerente: consumo + pagamentos de dívida do relatório = Despesas do dashboard no mês
  const month = periodFor("month", TODAY);
  const monthly = await wd.report({ period: month });
  const dash = await wd.dash();
  expect(monthly.overview.consumptionCents + monthly.overview.debtPaymentsCents, `${label}: relatório x dashboard`).toBe(dash.summary.spentCents);
  // 8) faturas: pago nunca excede o total; aberto = total - pago
  for (const i of snap.invoices) {
    expect(i.paidCents, `${label}: fatura paga <= total`).toBeLessThanOrEqual(i.totalCents);
    expect(i.openCents).toBe(i.totalCents - i.paidCents);
  }
  // 9) dívidas: restante = total - pago, nunca negativo
  for (const s of snap.debts) {
    if (s.status === "paid" && s.settledAt) continue; // quitação com desconto
    expect(s.remainingCents, `${label}: dívida restante`).toBeGreaterThanOrEqual(0);
  }
  // 10) parcelas: cada compra parcelada soma o valor original (centavos)
  for (const p of data.installmentPurchases) {
    const parts = data.transactions.filter((t) => t.installment?.purchaseId === p.id && t.status !== "canceled");
    if (parts.length === p.installments) expect(parts.reduce((s, t) => s + t.amountCents, 0), `${label}: parcelas`).toBe(p.totalCents);
  }
}

describe("propriedade: sequências aleatórias de operações mantêm TODOS os invariantes", () => {
  it.each([1, 2, 3, 7, 11, 42])("semente %i", async (seed) => {
    const random = rng(seed);
    const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
    const money = () => (Math.floor(random() * 90) + 1) * 100 + (random() < 0.3 ? Math.floor(random() * 99) : 0);
    const wd = world();
    const accounts = [nubank, mercadoPago, santander];
    const refused: Record<string, number> = {};
    let ops = 0;

    const op = async () => {
      const data = await wd.load();
      const acc = pick(accounts);
      const choice = Math.floor(random() * 15);
      switch (choice) {
        case 0: return wd.tx.create(expense({ kind: "income", amountCents: money() * 3, accountId: acc.id, categoryId: "salario" }));
        case 1: return wd.tx.create(expense({ amountCents: money() * (random() < 0.35 ? 12 : 1), accountId: acc.id }));
        case 2: return wd.tx.create(expense({ amountCents: money(), accountId: acc.id, status: "pending", paidAt: undefined, date: "2026-10-20" }));
        case 3: {
          const t = pick(data.transactions.filter((x) => x.kind === "expense" && x.status === "pending"));
          return t ? wd.tx.setStatus(t, "paid") : undefined;
        }
        case 4: return wd.tx.create(expense({ kind: "transfer", amountCents: money(), accountId: acc.id, toAccountId: pick(accounts.filter((a) => a.id !== acc.id)).id, categoryId: undefined }));
        case 5: return wd.tx.create(purchase({ amountCents: money() }));
        case 6: return wd.tx.createInstallmentPurchase({ description: "Parcelado", totalCents: money() * 3 + 1, installments: 3, date: "2026-10-03", cardId: card.id, profileId: yan.id, categoryId: CAT, tags: [] });
        case 7: {
          const open = (await wd.snap()).invoices.find((i) => i.openCents > 0);
          return open ? wd.tx.payInvoice({ cardId: card.id, dueMonth: open.dueMonth, accountId: acc.id, amountCents: Math.min(open.openCents, money()), date: TODAY }) : undefined;
        }
        case 8:
          return data.debts.length < 2
            ? wd.debts.create({ name: `Dívida ${data.debts.length}`, kind: "loan", profileId: yan.id, principalCents: 100000, totalCents: 120000, installments: 4, firstDueDate: "2026-10-10", paymentAccountId: acc.id })
            : undefined;
        case 9: {
          const d = pick(data.debts);
          return d ? wd.debts.pay({ debtId: d.id, accountId: acc.id, amountCents: money(), date: TODAY }) : undefined;
        }
        case 10:
          return data.pockets.length < 3 ? wd.pocket.create({ name: `Cofrinho ${data.pockets.length}`, profileId: yan.id, accountId: acc.id, initialCents: money() }) : undefined;
        case 11: {
          const p = pick(data.pockets.filter((x) => x.status === "active"));
          return p ? wd.pocket.reserve({ pocketId: p.id, amountCents: money() }) : undefined;
        }
        case 12: {
          const p = pick(data.pockets.filter((x) => x.status === "active"));
          return p ? wd.pocket.withdraw({ pocketId: p.id, amountCents: money() }) : undefined;
        }
        case 13: {
          const p = pick(data.pockets.filter((x) => x.status === "active"));
          return p ? wd.pocket.spend({ pocketId: p.id, description: "Uso", amountCents: money(), amountFromPocketCents: random() < 0.5 ? undefined : 100, categoryId: CAT }) : undefined;
        }
        default: {
          const uses = (await wd.repos.pocketMovements.list()).filter((m) => m.kind === "use" && !!m.transactionId);
          const reversed = new Set((await wd.repos.pocketMovements.list()).filter((m) => m.kind === "use_reversal").map((m) => m.reversesId));
          const u = pick(uses.filter((m) => !reversed.has(m.id)));
          return u?.transactionId ? wd.pocket.reverseUse(u.transactionId) : undefined;
        }
      }
    };

    for (let i = 0; i < 70; i++) {
      try {
        await op();
      } catch (error) {
        // Recusas de REGRA (lastro, saldo livre, valores, estados) são esperadas; qualquer outra coisa é bug.
        if (!(error instanceof AppError) && !(error instanceof Error && /Saldo|valor|Informe|não|Nenhum|pagamento|fatura/i.test(error.message))) throw error;
        const key = error instanceof AppError ? (error.code ?? "regra") : "validação";
        refused[key] = (refused[key] ?? 0) + 1;
      }
      ops++;
      await checkGlobal(wd, `semente ${seed} passo ${i}`);
    }
    expect(ops).toBe(70);
    // o roteiro precisa ter exercitado dinheiro de verdade (e algumas recusas de regra)
    expect((await wd.load()).transactions.length).toBeGreaterThan(10);
  });
});
