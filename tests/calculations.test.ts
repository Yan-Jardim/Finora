import { describe, expect, it } from "vitest";
import {
  accountBalance,
  cardInvoices,
  cardSummary,
  cardUsedLimit,
  computeBalances,
  displayStatus,
  invoiceCycle,
  invoiceIndex,
  isExpenseLike,
  monthBreakdown,
} from "@/domain/calculations";
import { card, mercadoPago, nubank, TODAY, tx, workspace } from "./helpers";

const balance = (account: typeof nubank, txs: ReturnType<typeof tx>[]) => accountBalance(account, txs);

describe("saldo da conta", () => {
  it("1. receita paga aumenta o saldo", () => {
    expect(balance(nubank, [tx({ kind: "income", amountCents: 500000, accountId: nubank.id })])).toBe(600000);
  });

  it("receita pendente/prevista NÃO aumenta o saldo", () => {
    const txs = [
      tx({ kind: "income", amountCents: 500000, accountId: nubank.id, status: "pending" }),
      tx({ kind: "income", amountCents: 700000, accountId: nubank.id, status: "planned" }),
    ];
    expect(balance(nubank, txs)).toBe(100000);
  });

  it("2. despesa paga reduz o saldo", () => {
    expect(balance(nubank, [tx({ amountCents: 25000, accountId: nubank.id })])).toBe(75000);
  });

  it("3. despesa prevista/pendente/cancelada não reduz o saldo", () => {
    const txs = ["planned", "pending", "canceled"].map((status) =>
      tx({ amountCents: 25000, accountId: nubank.id, status: status as "planned" }),
    );
    expect(balance(nubank, txs)).toBe(100000);
  });

  it("exemplo do enunciado: 1.000 + 5.000 salário - 500 mercado - 1.000 transferência = 4.500", () => {
    const txs = [
      tx({ kind: "income", amountCents: 500000, accountId: nubank.id }),
      tx({ kind: "expense", amountCents: 50000, accountId: nubank.id }),
      tx({ kind: "transfer", amountCents: 100000, accountId: nubank.id, toAccountId: mercadoPago.id }),
    ];
    expect(balance(nubank, txs)).toBe(450000);
  });
});

describe("transferência", () => {
  const transfer = tx({ kind: "transfer", amountCents: 100000, accountId: nubank.id, toAccountId: mercadoPago.id });

  it("4. reduz uma conta e aumenta a outra", () => {
    expect(balance(nubank, [transfer])).toBe(0);
    expect(balance(mercadoPago, [transfer])).toBe(100000);
  });

  it("5. não altera o patrimônio", () => {
    const ws = workspace();
    const before = computeBalances(ws.accounts, []).netWorthCents;
    const after = computeBalances(ws.accounts, [transfer]).netWorthCents;
    expect(after).toBe(before);
  });

  it("6. não aparece como receita nem despesa", () => {
    expect(isExpenseLike(transfer)).toBe(false);
    const month = monthBreakdown([transfer], "2026-10", TODAY);
    expect(month.realizedCents).toBe(0);
    expect(month.incomeReceivedCents).toBe(0);
    expect(month.pendingCents + month.plannedCents).toBe(0);
  });
});

describe("compra no cartão", () => {
  const purchase = tx({ kind: "credit_card_purchase", amountCents: 50000, cardId: card.id, status: "pending", date: "2026-10-03" });

  it("7. conta como despesa", () => {
    const month = monthBreakdown([purchase], "2026-10", TODAY);
    expect(month.realizedCents).toBe(50000);
    expect(month.realizedExpenses).toHaveLength(1);
  });

  it("8. não reduz o saldo da conta imediatamente (nem a conta de pagamento)", () => {
    expect(balance(nubank, [purchase])).toBe(100000);
    // Mesmo se estiver marcada como paga: o dinheiro só sai no pagamento da fatura.
    expect(balance(nubank, [{ ...purchase, status: "paid", accountId: nubank.id }])).toBe(100000);
  });

  it("9. consome limite", () => {
    expect(cardUsedLimit(card, [purchase], TODAY)).toBe(50000);
    expect(cardSummary(card, [purchase], TODAY).availableCents).toBe(450000);
  });

  it("compra apenas prevista (futura) não consome limite", () => {
    const future = tx({ kind: "credit_card_purchase", cardId: card.id, status: "planned", date: "2026-12-10" });
    expect(cardUsedLimit(card, [future], TODAY)).toBe(0);
  });

  it("14. antes/depois do fechamento cai na fatura correta (fecha 20, vence 27)", () => {
    expect(invoiceCycle(card, "2026-10-15")).toEqual({ closingDate: "2026-10-20", dueDate: "2026-10-27", dueMonth: "2026-10" });
    expect(invoiceCycle(card, "2026-10-20").dueMonth).toBe("2026-10"); // no dia do fechamento ainda entra
    expect(invoiceCycle(card, "2026-10-22")).toEqual({ closingDate: "2026-11-20", dueDate: "2026-11-27", dueMonth: "2026-11" });
    expect(invoiceCycle(card, "2026-12-25").dueMonth).toBe("2027-01"); // virada de ano
  });

  it("14b. vencimento menor que o fechamento cai no mês seguinte ao fechamento", () => {
    const nu = { closingDay: 25, dueDay: 3 };
    expect(invoiceCycle(nu, "2026-10-10")).toEqual({ closingDate: "2026-10-25", dueDate: "2026-11-03", dueMonth: "2026-11" });
    expect(invoiceCycle(nu, "2026-10-26").dueMonth).toBe("2026-12");
  });
});

describe("pagamento de fatura", () => {
  const purchase = tx({ kind: "credit_card_purchase", amountCents: 50000, cardId: card.id, status: "pending", date: "2026-10-03" });
  const payment = tx({
    kind: "card_payment",
    amountCents: 50000,
    accountId: nubank.id,
    cardId: card.id,
    invoiceMonth: "2026-10",
    status: "paid",
  });

  it("10. reduz o saldo da conta vinculada", () => {
    expect(balance(nubank, [purchase, payment])).toBe(50000);
  });

  it("11. não cria nova despesa (despesa continua sendo contada uma vez, na compra)", () => {
    expect(isExpenseLike(payment)).toBe(false);
    const month = monthBreakdown([purchase, payment], "2026-10", TODAY);
    expect(month.realizedCents).toBe(50000);
    expect(month.realizedExpenses.map((t) => t.id)).toEqual([purchase.id]);
  });

  it("zera a fatura, libera o limite e a compra passa a aparecer como paga", () => {
    const txs = [purchase, payment];
    const [invoice] = cardInvoices(card, txs);
    expect(invoice).toMatchObject({ totalCents: 50000, paidCents: 50000, openCents: 0, paid: true });
    expect(cardUsedLimit(card, txs, TODAY)).toBe(0);
    const status = displayStatus(purchase, TODAY, new Map([[card.id, card]]), invoiceIndex([card], txs));
    expect(status).toBe("paid");
  });

  it("pagamento parcial deixa o restante em aberto", () => {
    const partial = { ...payment, amountCents: 20000 };
    const [invoice] = cardInvoices(card, [purchase, partial]);
    expect(invoice.openCents).toBe(30000);
    expect(invoice.paid).toBe(false);
  });
});
