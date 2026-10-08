import type { InstallmentPurchaseInput, InstallmentScope } from "@/domain/installments";
import { recordSkip } from "./local-recurrence";
import type { Transaction, TransactionStatus } from "@/domain/types";
import {
  createInstallmentPurchase,
  createTransaction,
  deleteTransaction,
  payInvoice,
  previewScope,
  setTransactionStatus,
  updateTransaction,
  type TxRepos,
} from "./transaction-service";
import type {
  CommandContext,
  DeleteResult,
  PayInvoiceInput,
  ScopePreview,
  TransactionCommands,
  TransactionPatch,
} from "./transaction-commands";

/** Comandos sobre o motor local (localStorage): regras no cliente, usando os dados carregados. */
export class LocalTransactionCommands implements TransactionCommands {
  constructor(
    private readonly repos: TxRepos,
    private readonly ctx: CommandContext,
  ) {}

  async create(input: Omit<Transaction, "id">) {
    if (input.kind === "card_payment") throw new Error("Use \"Pagar fatura\" para registrar pagamentos de fatura.");
    return (await createTransaction(this.repos, input)).id;
  }

  async createInstallmentPurchase(input: InstallmentPurchaseInput) {
    const { purchase, transactions } = await createInstallmentPurchase(this.repos, input, this.ctx.today());
    return { purchaseId: purchase.id, count: transactions.length };
  }

  async payInvoice(input: PayInvoiceInput) {
    await payInvoice(this.repos, this.ctx.data(), input);
  }

  async setStatus(tx: Transaction, status: TransactionStatus) {
    await setTransactionStatus(this.repos, this.ctx.data(), tx, status, this.ctx.today());
  }

  update(tx: Transaction, patch: TransactionPatch, scope: InstallmentScope = "this") {
    return updateTransaction(this.repos, this.ctx.data(), tx, patch, scope);
  }

  async delete(tx: Transaction, scope: InstallmentScope = "this"): Promise<DeleteResult> {
    const result = await deleteTransaction(this.repos, this.ctx.data(), tx, scope);
    // Excluir uma ocorrência gerada = pular: a regra não a recria (no banco: trigger + recurring_skips).
    if (this.repos.recurring) await recordSkip({ recurring: this.repos.recurring }, tx);
    return result;
  }

  async previewScope(tx: Transaction, scope: InstallmentScope): Promise<ScopePreview> {
    const { affected, keptPaid } = previewScope(this.ctx.data(), tx, scope);
    return { affected: affected.length, keptPaid: keptPaid.length };
  }
}
