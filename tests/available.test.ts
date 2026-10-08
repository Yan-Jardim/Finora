/**
 * AUDITORIA DO "DISPONÍVEL DE VERDADE".
 *
 *   disponível = saldo das contas (sem investimentos)
 *              − contas restantes   (despesas pendentes/atrasadas até o mês + previstas DO mês; sem compra no cartão)
 *              − faturas em aberto  (vencimento até o mês; a compra no cartão entra AQUI, uma vez)
 *              − dívidas            (parcelas em aberto com vencimento até o mês + contas de dívida soltas)
 *              − reservado          (soma dos cofrinhos; já está dentro do saldo)
 *
 * Regra de ouro: toda obrigação é descontada UMA vez. Pagá-la reduz o saldo e a obrigação na mesma medida, então o
 * disponível NÃO muda no pagamento. Estes testes provam isso para cada tipo de obrigação.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { card, mercadoPago, nubank, santander, TODAY, yan } from "./helpers";
import { CAT, expense, purchase, world } from "./support/local-world";

let w: ReturnType<typeof world>;
const av = async () => (await w.dash()).availableBreakdown;
const BASE = nubank.initialBalanceCents + mercadoPago.initialBalanceCents + santander.initialBalanceCents;

beforeEach(() => {
  w = world();
});

describe("Disponível de verdade", () => {
  it("sem obrigações: disponível = saldo das contas (investimento não entra)", async () => {
    expect(await av()).toMatchObject({ balanceCents: BASE, remainingBillsCents: 0, invoicesCents: 0, debtsCents: 0, reservedCents: 0, availableCents: BASE });
  });

  it("CONTA PENDENTE: desconta uma vez; pagar não muda o disponível", async () => {
    const id = await w.tx.create(expense({ amountCents: 30000, status: "pending", paidAt: undefined, date: "2026-10-20" }));
    expect(await av()).toMatchObject({ balanceCents: BASE, remainingBillsCents: 30000, availableCents: BASE - 30000 });
    await w.load();
    await w.tx.setStatus((await w.repos.transactions.get(id))!, "paid");
    expect(await av()).toMatchObject({ balanceCents: BASE - 30000, remainingBillsCents: 0, availableCents: BASE - 30000 });
  });

  it("CONTA ATRASADA de mês anterior entra; DESPESA PREVISTA só do mês (não mexe no saldo)", async () => {
    await w.tx.create(expense({ amountCents: 10000, status: "pending", paidAt: undefined, date: "2026-09-10", dueDate: "2026-09-15" }));
    await w.tx.create(expense({ amountCents: 7000, status: "planned", paidAt: undefined, date: "2026-10-28" }));
    await w.tx.create(expense({ amountCents: 90000, status: "planned", paidAt: undefined, date: "2026-11-05" })); // mês seguinte: fora
    expect(await av()).toMatchObject({ balanceCents: BASE, remainingBillsCents: 17000, availableCents: BASE - 17000 });
  });

  it("CARTÃO: a compra é descontada UMA vez (como fatura); pagar a fatura — parcial ou total — não muda o disponível", async () => {
    await w.tx.create(purchase({ amountCents: 20000 }));
    expect(await av()).toMatchObject({ balanceCents: BASE, remainingBillsCents: 0, invoicesCents: 20000, availableCents: BASE - 20000 });
    await w.load();
    await w.tx.payInvoice({ cardId: card.id, dueMonth: "2026-10", accountId: nubank.id, amountCents: 5000, date: TODAY });
    expect(await av()).toMatchObject({ balanceCents: BASE - 5000, invoicesCents: 15000, availableCents: BASE - 20000 });
    await w.load();
    await w.tx.payInvoice({ cardId: card.id, dueMonth: "2026-10", accountId: nubank.id, amountCents: 15000, date: TODAY });
    expect(await av()).toMatchObject({ balanceCents: BASE - 20000, invoicesCents: 0, availableCents: BASE - 20000 });
  });

  it("DÍVIDA: o contrato só pesa pelas parcelas que vencem até o mês; pagar a parcela não muda o disponível", async () => {
    const future = await w.debts.create({ name: "Futura", kind: "loan", profileId: yan.id, principalCents: 100000, totalCents: 100000, installments: 4, firstDueDate: "2026-12-10", paymentAccountId: nubank.id });
    expect((await av()).debtsCents).toBe(0); // nenhuma parcela vence até outubro
    const id = await w.debts.create({ name: "Empréstimo", kind: "loan", profileId: yan.id, principalCents: 40000, totalCents: 40000, installments: 4, firstDueDate: "2026-10-10", paymentAccountId: nubank.id });
    expect(await av()).toMatchObject({ balanceCents: BASE, debtsCents: 10000, availableCents: BASE - 10000 });
    await w.debts.pay({ debtId: id, accountId: nubank.id, amountCents: 10000, date: TODAY });
    expect(await av()).toMatchObject({ balanceCents: BASE - 10000, debtsCents: 0, availableCents: BASE - 10000 });
    void future;
  });

  it("RESERVA: reservar reduz o disponível sem mexer no saldo; retirar devolve", async () => {
    const id = await w.pocket.create({ name: "Viagem", profileId: yan.id, accountId: nubank.id, initialCents: 30000 });
    expect(await av()).toMatchObject({ balanceCents: BASE, reservedCents: 30000, availableCents: BASE - 30000 });
    await w.pocket.withdraw({ pocketId: id, amountCents: 10000 });
    expect(await av()).toMatchObject({ balanceCents: BASE, reservedCents: 20000, availableCents: BASE - 20000 });
  });

  it("DESPESA USANDO A RESERVA: uso total não muda o disponível; uso parcial reduz só a parte que não veio da reserva; estorno restaura", async () => {
    const id = await w.pocket.create({ name: "Viagem", profileId: yan.id, accountId: nubank.id, initialCents: 30000 });
    const reserved = (await av()).availableCents; // BASE - 30000
    const full = await w.pocket.spend({ pocketId: id, description: "Total", amountCents: 10000, categoryId: CAT });
    expect(await av()).toMatchObject({ balanceCents: BASE - 10000, reservedCents: 20000, availableCents: reserved });
    const partial = await w.pocket.spend({ pocketId: id, description: "Parcial", amountCents: 10000, amountFromPocketCents: 4000, categoryId: CAT });
    expect(await av()).toMatchObject({ balanceCents: BASE - 20000, reservedCents: 16000, availableCents: reserved - 6000 });
    await w.pocket.reverseUse(partial.transactionId);
    await w.pocket.reverseUse(full.transactionId);
    expect(await av()).toMatchObject({ balanceCents: BASE, reservedCents: 30000, availableCents: reserved });
  });

  it("TRANSFERÊNCIA entre contas de consumo não muda o disponível; aporte em investimento tira (o dinheiro deixa de ser gastável)", async () => {
    await w.tx.create({ ...expense({ kind: "transfer", amountCents: 50000, toAccountId: mercadoPago.id, categoryId: undefined }) });
    expect((await av()).availableCents).toBe(BASE);
    await w.tx.create({ ...expense({ kind: "transfer", amountCents: 20000, toAccountId: "a-invest", categoryId: undefined }) });
    expect((await av()).availableCents).toBe(BASE - 20000);
  });

  it("NENHUMA obrigação em dobro: conta + fatura + parcela de dívida + reserva juntas; pagar tudo mantém o disponível", async () => {
    await w.pocket.create({ name: "Reserva", profileId: yan.id, accountId: nubank.id, initialCents: 25000 });
    const bill = await w.tx.create(expense({ amountCents: 12000, status: "pending", paidAt: undefined, date: "2026-10-18" }));
    await w.tx.create(purchase({ amountCents: 33000 }));
    const debt = await w.debts.create({ name: "Carro", kind: "financing", profileId: yan.id, principalCents: 60000, totalCents: 60000, installments: 3, firstDueDate: "2026-10-12", paymentAccountId: nubank.id });
    const before = await av();
    expect(before.availableCents).toBe(BASE - 12000 - 33000 - 20000 - 25000); // cada obrigação UMA vez
    // paga tudo
    await w.load();
    await w.tx.setStatus((await w.repos.transactions.get(bill))!, "paid");
    await w.load();
    await w.tx.payInvoice({ cardId: card.id, dueMonth: "2026-10", accountId: nubank.id, amountCents: 33000, date: TODAY });
    await w.debts.pay({ debtId: debt, accountId: nubank.id, amountCents: 20000, date: TODAY });
    const after = await av();
    expect(after).toMatchObject({ balanceCents: BASE - 12000 - 33000 - 20000, remainingBillsCents: 0, invoicesCents: 0, debtsCents: 0, reservedCents: 25000 });
    expect(after.availableCents).toBe(before.availableCents); // pagar não muda o disponível
  });
});
