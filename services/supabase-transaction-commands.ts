import type { SupabaseClient } from "@supabase/supabase-js";
import { planScope, type InstallmentPurchaseInput, type InstallmentScope } from "@/domain/installments";
import { snapshotInvoiceIndex, snapshotOf } from "@/domain/snapshot";
import { transactionLockReason } from "@/domain/rules";
import type { Transaction, TransactionStatus } from "@/domain/types";
import { friendlyDbMessage, toFriendlyError } from "@/repositories/supabase/errors";
import type { SupabaseTransactionRepository } from "@/repositories/supabase/supabase-transaction-repository";
import { toInstallmentRpcPatch, toTransactionRpcPatch } from "@/repositories/supabase/transaction-mappers";
import type {
  CommandContext,
  DeleteResult,
  PayInvoiceInput,
  ScopePreview,
  TransactionCommands,
  TransactionPatch,
} from "./transaction-commands";

const domainError = (code: string) => new Error(friendlyDbMessage({ message: code }));

/** Número de parcelas: o banco valida de novo (invalid_installments); aqui só evita uma ida inútil. */
const MIN_INSTALLMENTS = 2;

/**
 * Comandos sobre o Supabase. Cada operação de negócio é UMA chamada RPC (atômica, SECURITY INVOKER, com RLS):
 *
 *   create ................... create_transaction            (movimentação + tags)
 *   createInstallmentPurchase  create_installment_purchase    (agrupador + parcelas + faturas + tags)
 *   payInvoice ............... pay_invoice                   (card_payment sempre pago, ligado à fatura)
 *   update / setStatus ....... update_transaction | update_installments
 *   delete ................... delete_installments (parcelas) | DELETE de UMA linha (movimentação comum)
 *
 * O cliente NÃO cria faturas, NÃO atribui invoice_id, NÃO deriva status de compra no cartão e NÃO replica
 * travas: o banco decide (triggers) e devolve o motivo, que é traduzido em repositories/supabase/errors.ts.
 * Pré-validações locais da UI (lock, valor máximo) existem só por UX.
 *
 * Duas escritas de UMA linha não têm RPC e vão direto na tabela (RLS + triggers valem; são atômicas):
 *  - excluir movimentação comum;
 *  - mudar o status de uma PARCELA (cancelar/reativar): update_installments não aceita `status`.
 */
export class SupabaseTransactionCommands implements TransactionCommands {
  constructor(
    private readonly client: SupabaseClient,
    private readonly reads: Pick<SupabaseTransactionRepository, "installmentGroup">,
    private readonly ctx: CommandContext,
  ) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw toFriendlyError(error);
    return data as T;
  }

  async create(input: Omit<Transaction, "id">): Promise<string> {
    if (input.kind === "card_payment") throw domainError("use_pay_invoice");
    const cardPurchase = input.kind === "credit_card_purchase";
    return this.rpc<string>("create_transaction", {
      p_kind: input.kind,
      p_description: input.description,
      p_amount_cents: input.amountCents,
      p_date: input.date,
      p_profile_id: input.profileId,
      // Compra no cartão: o BANCO deriva (pendente se a data já chegou no fuso do household, senão prevista).
      p_status: cardPurchase ? undefined : input.status === "overdue" ? "pending" : input.status,
      p_account_id: input.accountId,
      p_to_account_id: input.toAccountId,
      p_card_id: input.cardId,
      p_category_id: input.categoryId,
      p_due_date: input.dueDate,
      p_paid_at: cardPurchase ? undefined : input.paidAt,
      p_notes: input.notes,
      p_tags: input.tags,
    });
  }

  async createInstallmentPurchase(input: InstallmentPurchaseInput) {
    if (input.installments < MIN_INSTALLMENTS) throw domainError("invalid_installments");
    if (!input.categoryId) throw new Error("Escolha a categoria.");
    const result = await this.rpc<{ purchase_id: string; transaction_ids: string[] }>("create_installment_purchase", {
      p_card_id: input.cardId,
      p_profile_id: input.profileId,
      p_category_id: input.categoryId,
      p_description: input.description,
      p_total_cents: input.totalCents,
      p_installments: input.installments,
      p_purchase_date: input.date,
      p_notes: input.notes,
      p_tags: input.tags,
    });
    return { purchaseId: result.purchase_id, count: result.transaction_ids.length };
  }

  async payInvoice(input: PayInvoiceInput): Promise<void> {
    await this.rpc<string>("pay_invoice", {
      p_card_id: input.cardId,
      // A fatura é identificada pelo mês de vencimento; qualquer dia do mês serve ("YYYY-MM" -> dia 1).
      p_due_month: `${input.dueMonth}-01`,
      // A conta é a ESCOLHIDA no diálogo; payment_account_id do cartão é só sugestão.
      p_account_id: input.accountId,
      p_amount_cents: input.amountCents,
      p_date: input.date,
    });
  }

  async setStatus(tx: Transaction, status: TransactionStatus): Promise<void> {
    const dbStatus = status === "overdue" ? "pending" : status;
    if (!tx.installment) {
      // paid_at (ao marcar como pago) fica por conta do banco: a data do dia no fuso do household.
      await this.rpc<null>("update_transaction", { p_transaction_id: tx.id, p_patch: { status: dbStatus } });
      return;
    }
    const { data, error } = await this.client.from("transactions").update({ status: dbStatus }).eq("id", tx.id).select("id");
    if (error) throw toFriendlyError(error);
    if (!data?.length) throw domainError("transaction_not_found");
  }

  async update(tx: Transaction, patch: TransactionPatch, scope: InstallmentScope = "this"): Promise<void> {
    if (tx.installment) {
      if (scope === "all") throw domainError("invalid_scope");
      await this.rpc("update_installments", {
        p_transaction_id: tx.id,
        p_scope: scope,
        p_patch: toInstallmentRpcPatch(patch, scope),
      });
      return;
    }
    await this.rpc<null>("update_transaction", {
      p_transaction_id: tx.id,
      p_patch: toTransactionRpcPatch(tx, patch),
      p_tags: "tags" in patch ? (patch.tags ?? []) : undefined,
    });
  }

  async delete(tx: Transaction, scope: InstallmentScope = "this"): Promise<DeleteResult> {
    if (tx.installment) {
      const result = await this.rpc<{ deleted: number; kept_paid: number }>("delete_installments", {
        p_transaction_id: tx.id,
        p_scope: scope,
      });
      return { deleted: result.deleted, keptPaid: result.kept_paid };
    }
    const { data, error } = await this.client.from("transactions").delete().eq("id", tx.id).select("id");
    if (error) throw toFriendlyError(error);
    if (!data?.length) throw domainError("transaction_not_found");
    return { deleted: 1, keptPaid: 0 };
  }

  /** Mesma regra do banco (parcela de fatura paga é preservada), calculada sobre TODAS as parcelas da compra. */
  async previewScope(tx: Transaction, scope: InstallmentScope): Promise<ScopePreview> {
    if (!tx.installment) return { affected: 1, keptPaid: 0 };
    const group = await this.reads.installmentGroup(tx.installment.purchaseId);
    const data = this.ctx.data();
    const cards = new Map(data.creditCards.map((c) => [c.id, c]));
    const invoices = snapshotInvoiceIndex(snapshotOf(data, this.ctx.today()));
    const isProtected = (t: Transaction) => transactionLockReason(t, cards, invoices) !== null;
    const plan = planScope(group, tx, scope, isProtected);
    return { affected: plan.affected.length, keptPaid: plan.keptPaid.length };
  }
}
