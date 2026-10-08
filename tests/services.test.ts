import { beforeEach, describe, expect, it } from "vitest";
import { accountDeleteBlocker, categoryDeleteBlocker, invoicePaymentError } from "@/domain/rules";
import { invoiceIndex } from "@/domain/calculations";
import type { Category, Transaction, WorkspaceData } from "@/domain/types";
import {
  createInstallmentPurchase,
  createTransaction,
  deleteTransaction,
  payInvoice,
  setTransactionStatus,
  updateTransaction,
} from "@/services/transaction-service";
import { LocalStorageRepository } from "@/repositories/local-storage-repository";
import { card, createRepos, installFakeStorage, nubank, TODAY, tx, workspace, yan } from "./helpers";

let repos: ReturnType<typeof createRepos>;

beforeEach(() => {
  installFakeStorage();
  repos = createRepos();
});

const load = async (): Promise<WorkspaceData> =>
  workspace({
    transactions: await repos.transactions.list(),
    installmentPurchases: await repos.installmentPurchases.list(),
  });

const purchaseInput = {
  description: "Notebook",
  totalCents: 100000,
  installments: 3,
  date: "2026-10-03",
  cardId: card.id,
  profileId: yan.id,
  tags: ["Trabalho"],
};

describe("persistência", () => {
  it("17. movimentações sobrevivem a um 'reload' (novos repositórios sobre o mesmo storage)", async () => {
    await createTransaction(repos, tx({ description: "Mercado", amountCents: 25000, accountId: nubank.id, tags: ["Casa nova"] }));
    await createInstallmentPurchase(repos, purchaseInput, TODAY);

    const reloaded = createRepos();
    const list = await reloaded.transactions.list();
    expect(list).toHaveLength(1 + 3);
    expect(list.find((t) => t.description === "Mercado")?.tags).toEqual(["Casa nova"]); // tags estruturadas
    expect(await reloaded.installmentPurchases.list()).toHaveLength(1);
  });

  it("registros da etapa anterior (expense + cardId) são migrados para credit_card_purchase", async () => {
    const legacy = { ...tx({ kind: "expense", cardId: card.id, status: "pending" }) };
    window.localStorage.setItem("finora:v1:transactions", JSON.stringify([legacy]));
    const [migrated] = await createRepos().transactions.list();
    expect(migrated.kind).toBe("credit_card_purchase");
  });

  it("os dados iniciais só são gravados uma vez", async () => {
    const seeded = new LocalStorageRepository<Transaction>("seeded", () => [tx({ description: "seed" })]);
    await seeded.list();
    await seeded.removeMany((await seeded.list()).map((t) => t.id));
    expect(await new LocalStorageRepository<Transaction>("seeded", () => [tx({})]).list()).toHaveLength(0);
  });
});

describe("compra parcelada", () => {
  it("cria o agrupador + todas as parcelas de uma vez, somando exatamente o total", async () => {
    const { purchase, transactions } = await createInstallmentPurchase(repos, purchaseInput, TODAY);
    expect(transactions.map((t) => t.amountCents)).toEqual([33334, 33333, 33333]);
    expect(transactions.reduce((s, t) => s + t.amountCents, 0)).toBe(100000);
    expect(transactions.every((t) => t.installment?.purchaseId === purchase.id)).toBe(true);
  });

  it("recusa menos de 2 parcelas", async () => {
    await expect(createInstallmentPurchase(repos, { ...purchaseInput, installments: 1 }, TODAY)).rejects.toThrow();
  });
});

describe("pagamento de fatura (serviço)", () => {
  it("registra card_payment pago, ligado ao cartão e à fatura, sem virar despesa", async () => {
    await createTransaction(repos, tx({ kind: "credit_card_purchase", cardId: card.id, status: "pending", amountCents: 50000, date: "2026-10-03" }));
    const payment = await payInvoice(repos, await load(), {
      cardId: card.id,
      dueMonth: "2026-10",
      accountId: nubank.id,
      amountCents: 50000,
      date: TODAY,
    });
    expect(payment).toMatchObject({ kind: "card_payment", status: "paid", invoiceMonth: "2026-10", accountId: nubank.id });
  });

  it("não aceita pagar mais do que o valor em aberto, nem fatura sem valor", async () => {
    await createTransaction(repos, tx({ kind: "credit_card_purchase", cardId: card.id, status: "pending", amountCents: 50000, date: "2026-10-03" }));
    const data = await load();
    const base = { cardId: card.id, accountId: nubank.id, date: TODAY };
    await expect(payInvoice(repos, data, { ...base, dueMonth: "2026-10", amountCents: 50001 })).rejects.toThrow(/maior/);
    await expect(payInvoice(repos, data, { ...base, dueMonth: "2027-05", amountCents: 100 })).rejects.toThrow(/aberto/);
    expect(invoicePaymentError(undefined, 100)).toBeTruthy();
  });
});

describe("exclusões e edições respeitam as regras", () => {
  it("18. movimentação simples é excluída sozinha", async () => {
    const a = await createTransaction(repos, tx({ accountId: nubank.id }));
    await createTransaction(repos, tx({ accountId: nubank.id }));
    expect(await deleteTransaction(repos, await load(), a)).toEqual({ deleted: 1, keptPaid: 0 });
    expect(await repos.transactions.list()).toHaveLength(1);
  });

  it("18. parcelas: somente esta / esta e as próximas / compra inteira", async () => {
    const { transactions } = await createInstallmentPurchase(repos, { ...purchaseInput, installments: 5 }, TODAY);

    await deleteTransaction(repos, await load(), transactions[4], "this");
    expect(await repos.transactions.list()).toHaveLength(4);

    await deleteTransaction(repos, await load(), transactions[2], "future");
    expect((await repos.transactions.list()).map((t) => t.installment?.number)).toEqual([1, 2]);

    await deleteTransaction(repos, await load(), transactions[0], "all");
    expect(await repos.transactions.list()).toHaveLength(0);
    expect(await repos.installmentPurchases.list()).toHaveLength(0); // agrupador some junto
  });

  it("18. parcelas de fatura já paga não são excluídas em silêncio", async () => {
    // compra em 03/10 (fatura out/27, paga) + parcelas seguintes em faturas abertas
    const { transactions } = await createInstallmentPurchase(repos, { ...purchaseInput, installments: 3 }, TODAY);
    await payInvoice(repos, await load(), { cardId: card.id, dueMonth: "2026-10", accountId: nubank.id, amountCents: 33334, date: TODAY });

    const data = await load();
    // a parcela paga está travada...
    await expect(deleteTransaction(repos, data, transactions[0], "this")).rejects.toThrow(/fatura/i);
    await expect(setTransactionStatus(repos, data, transactions[0], "canceled", TODAY)).rejects.toThrow(/fatura/i);
    await expect(updateTransaction(repos, data, transactions[0], { description: "x" })).rejects.toThrow(/fatura/i);

    // ...e a exclusão da compra inteira preserva e informa a parcela paga.
    const result = await deleteTransaction(repos, data, transactions[1], "all");
    expect(result).toEqual({ deleted: 2, keptPaid: 1 });
    expect(await repos.transactions.list()).toHaveLength(1 + 1); // parcela paga + pagamento
    expect(await repos.installmentPurchases.list()).toHaveLength(1); // agrupador permanece
  });

  it("excluir o pagamento reabre a fatura (e destrava as compras)", async () => {
    const [purchase] = (await createInstallmentPurchase(repos, purchaseInput, TODAY)).transactions;
    const payment = await payInvoice(repos, await load(), { cardId: card.id, dueMonth: "2026-10", accountId: nubank.id, amountCents: 33334, date: TODAY });
    await deleteTransaction(repos, await load(), payment);
    const data = await load();
    const invoice = invoiceIndex([card], data.transactions).get(`${card.id}|2026-10`);
    expect(invoice?.openCents).toBe(33334);
    await expect(deleteTransaction(repos, data, purchase, "this")).resolves.toBeDefined();
  });

  it("editar 'esta e as próximas' propaga só campos descritivos, não o valor", async () => {
    const { transactions } = await createInstallmentPurchase(repos, { ...purchaseInput, installments: 4 }, TODAY);
    await updateTransaction(repos, await load(), transactions[1], { description: "Notebook Pro", amountCents: 1 }, "future");
    const list = await repos.transactions.list();
    expect(list.map((t) => t.description)).toEqual(["Notebook", "Notebook Pro", "Notebook Pro", "Notebook Pro"]);
    expect(list.map((t) => t.amountCents)).toEqual([25000, 25000, 25000, 25000]);
  });

  it("marcar como pago grava paidAt; voltar a pendente limpa", async () => {
    const t = await createTransaction(repos, tx({ status: "pending", accountId: nubank.id }));
    const paid = await setTransactionStatus(repos, await load(), t, "paid", TODAY);
    expect(paid).toMatchObject({ status: "paid", paidAt: TODAY });
    const back = await setTransactionStatus(repos, await load(), paid, "pending", TODAY);
    expect(back.paidAt).toBeUndefined();
  });

  it("não exclui conta nem categoria que já têm movimentações", async () => {
    const t = tx({ accountId: nubank.id, categoryId: "cat-1" });
    const data = workspace({ transactions: [t] });
    expect(accountDeleteBlocker(nubank, data)).toMatch(/movimenta/);
    const category: Category = { id: "cat-1", name: "X", icon: "more", color: "#000", kind: "expense", active: true };
    expect(categoryDeleteBlocker(category, data)).toMatch(/usada/);
    expect(accountDeleteBlocker({ ...nubank, id: "livre" }, data)).toBeNull();
  });
});
