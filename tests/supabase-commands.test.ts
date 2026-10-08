import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { friendlyDbMessage } from "@/repositories/supabase/errors";
import {
  toInstallmentRpcPatch,
  toTransactionRpcPatch,
  transactionFromRow,
} from "@/repositories/supabase/transaction-mappers";
import { SupabaseTransactionCommands } from "@/services/supabase-transaction-commands";
import type { Invoice } from "@/domain/calculations";
import type { FinanceSnapshot } from "@/domain/snapshot";
import { card, nubank, TODAY, tx, workspace, yan } from "./helpers";

type RpcCall = { fn: string; args: Record<string, unknown> };

/** Cliente falso: registra RPCs e escritas diretas; devolve resultados configurados por função/tabela. */
function fake(opts: { rpc?: Record<string, unknown>; rpcError?: { code?: string; message: string }; direct?: unknown[] } = {}) {
  const rpcs: RpcCall[] = [];
  const direct: { table: string; ops: [string, unknown[]][] }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return opts.rpcError ? { data: null, error: opts.rpcError } : { data: opts.rpc?.[fn] ?? null, error: null };
    },
    from(table: string) {
      const entry = { table, ops: [] as [string, unknown[]][] };
      direct.push(entry);
      const b: Record<string, unknown> = {};
      for (const op of ["update", "delete", "eq", "select"]) {
        b[op] = (...a: unknown[]) => {
          entry.ops.push([op, a]);
          return b;
        };
      }
      b.then = (resolve: (v: unknown) => void) => resolve({ data: opts.direct ?? [{ id: "x" }], error: null });
      return b;
    },
  } as unknown as SupabaseClient;
  return { client, rpcs, direct };
}

const ctx = (data = workspace()) => ({ today: () => TODAY, data: () => data });
const noReads = { installmentGroup: async () => [] };
const commands = (f: ReturnType<typeof fake>, data = workspace()) => new SupabaseTransactionCommands(f.client, noReads, ctx(data));

const base = tx({ kind: "expense", description: "Mercado", amountCents: 12345, accountId: nubank.id, categoryId: "cat", tags: ["Casa"], status: "paid", paidAt: TODAY });

describe("SupabaseTransactionCommands — criar", () => {
  it("receita/despesa/transferência vão por create_transaction (movimentação + tags numa chamada)", async () => {
    const f = fake({ rpc: { create_transaction: "new-id" } });
    const id = await commands(f).create({ ...base, id: undefined } as never);
    expect(id).toBe("new-id");
    expect(f.rpcs).toHaveLength(1);
    expect(f.rpcs[0]).toEqual({
      fn: "create_transaction",
      args: expect.objectContaining({
        p_kind: "expense",
        p_description: "Mercado",
        p_amount_cents: 12345,
        p_status: "paid",
        p_account_id: nubank.id,
        p_category_id: "cat",
        p_paid_at: TODAY,
        p_tags: ["Casa"],
      }),
    });
    expect(f.direct).toHaveLength(0); // nada de escrita direta nas tabelas
  });

  it("compra no cartão à vista: o STATUS é do banco (não é enviado) e nada de paid_at", async () => {
    const f = fake({ rpc: { create_transaction: "id" } });
    await commands(f).create({ kind: "credit_card_purchase", description: "Jantar", amountCents: 5000, date: TODAY, status: "pending", cardId: card.id, categoryId: "c", tags: [], profileId: yan.id });
    const args = f.rpcs[0].args;
    expect(args.p_status).toBeUndefined();
    expect(args.p_paid_at).toBeUndefined();
    expect(args.p_card_id).toBe(card.id);
    expect(args.p_account_id).toBeUndefined(); // compra no cartão não mexe em conta
  });

  it("card_payment não é criado por aqui (só por pay_invoice)", async () => {
    const f = fake();
    await expect(commands(f).create({ ...base, kind: "card_payment" })).rejects.toThrow(/Pagar fatura/);
    expect(f.rpcs).toHaveLength(0);
  });

  it("compra parcelada: create_installment_purchase (uma chamada) e devolve a contagem", async () => {
    const f = fake({ rpc: { create_installment_purchase: { purchase_id: "p1", transaction_ids: ["a", "b", "c"] } } });
    const result = await commands(f).createInstallmentPurchase({ description: "TV", totalCents: 100000, installments: 3, date: TODAY, cardId: card.id, profileId: yan.id, categoryId: "cat", tags: ["Lar"] });
    expect(result).toEqual({ purchaseId: "p1", count: 3 });
    expect(f.rpcs.map((r) => r.fn)).toEqual(["create_installment_purchase"]);
    expect(f.rpcs[0].args).toMatchObject({ p_total_cents: 100000, p_installments: 3, p_purchase_date: TODAY, p_tags: ["Lar"] });
  });
});

describe("SupabaseTransactionCommands — pagamento de fatura", () => {
  it("usa pay_invoice com a conta ESCOLHIDA e o mês de vencimento (dia 1)", async () => {
    const f = fake({ rpc: { pay_invoice: "pay-id" } });
    await commands(f).payInvoice({ cardId: card.id, dueMonth: "2026-10", accountId: "outra-conta", amountCents: 7000, date: TODAY });
    expect(f.rpcs).toEqual([
      { fn: "pay_invoice", args: { p_card_id: card.id, p_due_month: "2026-10-01", p_account_id: "outra-conta", p_amount_cents: 7000, p_date: TODAY } },
    ]);
    expect(f.direct).toHaveLength(0); // jamais insere card_payment direto
  });
});

describe("SupabaseTransactionCommands — editar, status e excluir", () => {
  it("editar movimentação comum: update_transaction com patch em snake_case e tags no parâmetro próprio", async () => {
    const f = fake();
    await commands(f).update(base, { description: "Feira", amountCents: 999, dueDate: undefined, tags: ["x"] });
    expect(f.rpcs).toEqual([
      {
        fn: "update_transaction",
        args: { p_transaction_id: base.id, p_patch: { description: "Feira", amount_cents: 999, due_date: null }, p_tags: ["x"] },
      },
    ]);
  });

  it("sem 'tags' no patch, as tags não são tocadas (p_tags indefinido)", async () => {
    const f = fake();
    await commands(f).update(base, { description: "Só descrição" });
    expect(f.rpcs[0].args.p_tags).toBeUndefined();
  });

  it("parcela: update_installments; 'future' só leva campos descritivos (valor e data ficam de fora)", async () => {
    const parcel = tx({ kind: "credit_card_purchase", installment: { purchaseId: "ip", number: 2, total: 3 }, cardId: card.id });
    const f = fake();
    await commands(f).update(parcel, { description: "Novo", amountCents: 1, date: "2030-01-01", cardId: card.id, status: "pending", tags: ["a"] }, "future");
    expect(f.rpcs).toEqual([
      { fn: "update_installments", args: { p_transaction_id: parcel.id, p_scope: "future", p_patch: { description: "Novo", tags: ["a"] } } },
    ]);
    await commands(f).update(parcel, { amountCents: 500, date: "2030-02-02" }, "this");
    expect(f.rpcs[1].args.p_patch).toEqual({ amount_cents: 500, date: "2030-02-02" });
  });

  it("status de movimentação comum: update_transaction; o paid_at (hoje) é do banco", async () => {
    const f = fake();
    await commands(f).setStatus(base, "paid");
    expect(f.rpcs).toEqual([{ fn: "update_transaction", args: { p_transaction_id: base.id, p_patch: { status: "paid" } } }]);
  });

  it("status de PARCELA (cancelar/reativar): única escrita direta de status; sem RPC inexistente", async () => {
    const parcel = tx({ kind: "credit_card_purchase", installment: { purchaseId: "ip", number: 1, total: 2 } });
    const f = fake();
    await commands(f).setStatus(parcel, "canceled");
    expect(f.rpcs).toHaveLength(0);
    expect(f.direct[0].table).toBe("transactions");
    expect(f.direct[0].ops[0]).toEqual(["update", [{ status: "canceled" }]]);
  });

  it("excluir parcelas: delete_installments devolve deleted/kept_paid; comum: DELETE de uma linha", async () => {
    const parcel = tx({ kind: "credit_card_purchase", installment: { purchaseId: "ip", number: 1, total: 2 } });
    const f = fake({ rpc: { delete_installments: { deleted: 2, kept_paid: 1 } } });
    expect(await commands(f).delete(parcel, "all")).toEqual({ deleted: 2, keptPaid: 1 });
    expect(f.rpcs[0]).toEqual({ fn: "delete_installments", args: { p_transaction_id: parcel.id, p_scope: "all" } });
    expect(await commands(f).delete(base)).toEqual({ deleted: 1, keptPaid: 0 });
    expect(f.direct[0].ops.map((o) => o[0])).toEqual(["delete", "eq", "select"]);
  });

  it("excluir o que não existe (RLS/removida em outra aba): erro amigável", async () => {
    const f = fake({ direct: [] });
    await expect(commands(f).delete(base)).rejects.toThrow("Movimentação não encontrada.");
  });
});

describe("SupabaseTransactionCommands — erros do banco viram mensagens amigáveis", () => {
  it.each([
    ["invoice_paid_locked", "Esta fatura já está paga e não pode ser alterada."],
    ["payment_exceeds_open", "O pagamento não pode ser maior que o valor em aberto da fatura."],
    ["transaction_not_found", "Movimentação não encontrada."],
  ])("%s", async (code, message) => {
    const f = fake({ rpcError: { code: "P0001", message: code } });
    await expect(commands(f).update(base, { description: "x" })).rejects.toThrow(message);
  });

  it("não vaza código cru nem detalhes do Postgres", async () => {
    const f = fake({ rpcError: { code: "XX000", message: 'relation "x" does not exist' } });
    await expect(commands(f).update(base, { description: "x" })).rejects.toThrow("Não foi possível concluir a operação. Tente novamente.");
  });
});

describe("tradução central de erros de movimentação", () => {
  it.each([
    ["use_pay_invoice", /Pagar fatura/],
    ["use_pay_invoice_flow", /exclua o pagamento/], // não pode casar com o prefixo use_pay_invoice
    ["use_update_installments", /parcela/],
    ["invalid_scope", /Escopo inválido/],
    ["invalid_patch_key", /não pode ser alterado/],
    ["category_kind_mismatch", /receita x despesa/],
    ["invoice_overpaid", /mais pagamentos do que compras/],
    ["payment_invoice_mismatch", /não pertence a este cartão/],
    ["not_an_installment", /não faz parte de uma compra parcelada/],
    ["forbidden", /permissão/],
  ])("%s", (code, expected) => {
    expect(friendlyDbMessage({ code: "P0001", message: code })).toMatch(expected);
  });

  it("CHECKs de formato têm mensagem própria; desconhecidos caem na genérica", () => {
    expect(friendlyDbMessage({ code: "23514", message: 'violates check constraint "transactions_installment_only_card_purchase"' })).toMatch(/Parcelas só existem/);
    expect(friendlyDbMessage({ code: "23514", message: 'violates check constraint "outra"' })).toMatch(/fora do permitido/);
  });
});

describe("mapeamento linha <-> domínio", () => {
  it("compra parcelada com tags, fatura atribuída pelo banco e total da compra", () => {
    const t = transactionFromRow({
      id: "t1", kind: "credit_card_purchase", description: "TV", amount_cents: 33334, date: "2026-10-03", due_date: null, paid_at: null,
      status: "pending", category_id: "c", account_id: null, to_account_id: null, card_id: "card", profile_id: "p", notes: null,
      installment_purchase_id: "ip", installment_number: 1,
      installment: { installments_count: 3, purchase_date: "2026-10-03" }, invoice: { due_month: "2026-10-27" },
      tag_links: [{ tag: { name: "Zeta" } }, { tag: { name: "alfa" } }],
    });
    expect(t).toMatchObject({ amountCents: 33334, invoiceMonth: "2026-10", tags: ["alfa", "Zeta"], installment: { purchaseId: "ip", number: 1, total: 3, purchaseDate: "2026-10-03" } });
    expect(t.dueDate).toBeUndefined();
  });

  it("patch de compra no cartão nunca envia status/paid_at (o banco deriva)", () => {
    const purchase = tx({ kind: "credit_card_purchase", cardId: card.id });
    expect(toTransactionRpcPatch(purchase, { status: "pending", paidAt: TODAY, date: "2026-11-01", description: "x" })).toEqual({ date: "2026-11-01", description: "x" });
  });

  it("patch de parcela ignora chaves que não se aplicam", () => {
    expect(toInstallmentRpcPatch({ cardId: "c", status: "paid", notes: undefined }, "future")).toEqual({ notes: null });
  });
});

describe("preview de escopo (mesma regra do banco, sobre TODAS as parcelas)", () => {
  it("parcelas em fatura paga são preservadas em 'future' e 'all'", async () => {
    const group = [1, 2, 3].map((n) =>
      tx({ id: `p${n}`, kind: "credit_card_purchase", cardId: card.id, installment: { purchaseId: "ip", number: n, total: 3 }, invoiceMonth: `2026-1${n - 1}`, date: `2026-1${n - 1}-03`, status: "pending" }),
    );
    // fatura 2026-10 (parcela 1) está paga
    const paid: Invoice = { cardId: card.id, dueMonth: "2026-10", dueDate: "2026-10-27", closingDate: "2026-10-20", totalCents: 100, paidCents: 100, openCents: 0, paid: true };
    const snapshot: FinanceSnapshot = { accountBalances: new Map(), invoices: [paid], usedLimits: new Map(), debts: [], debtInstallments: [], pocketBalances: new Map(), accountReserved: new Map() };
    const f = fake();
    const cmds = new SupabaseTransactionCommands(f.client, { installmentGroup: async () => group }, ctx(workspace({ snapshot })));
    expect(await cmds.previewScope(group[1], "all")).toEqual({ affected: 2, keptPaid: 1 });
    expect(await cmds.previewScope(group[1], "future")).toEqual({ affected: 2, keptPaid: 0 });
    expect(await cmds.previewScope(group[1], "this")).toEqual({ affected: 1, keptPaid: 0 });
  });
});
