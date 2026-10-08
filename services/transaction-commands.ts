import type { InstallmentPurchaseInput, InstallmentScope } from "@/domain/installments";
import type { Cents, ISODate, Transaction, TransactionStatus, WorkspaceData } from "@/domain/types";

/**
 * PORTA de comandos de movimentação — tudo o que a UI faz que ALTERA o ledger.
 * Os componentes só conhecem esta interface; quem decide como persistir é a implementação:
 *
 * - LocalTransactionCommands ....... motor em localStorage (demo/testes): regras no cliente (services/transaction-service).
 * - SupabaseTransactionCommands .... RPCs atômicas do banco (create_transaction, create_installment_purchase,
 *   pay_invoice, update_transaction, update_installments, delete_installments). As regras multi-passo
 *   (fatura, parcelas, tags, travas) vivem no banco: o cliente NÃO as replica.
 *
 * Erros: sempre `Error` com mensagem pronta para o usuário (veja repositories/supabase/errors.ts).
 */

export interface PayInvoiceInput {
  cardId: string;
  /** "YYYY-MM" do vencimento da fatura. */
  dueMonth: string;
  /** Conta escolhida no diálogo (a do cartão é só sugestão). */
  accountId: string;
  amountCents: Cents;
  date: ISODate;
}

export interface DeleteResult {
  deleted: number;
  keptPaid: number;
}

export type TransactionPatch = Partial<Omit<Transaction, "id" | "installment" | "kind">>;

/** Impacto de um escopo de parcelas, mostrado ANTES de confirmar. */
export interface ScopePreview {
  affected: number;
  /** Parcelas dentro do escopo preservadas por estarem em fatura já paga. */
  keptPaid: number;
}

export interface TransactionCommands {
  /** Receita, despesa, transferência ou compra no cartão à vista (+ tags). Pagamento de fatura: use payInvoice. */
  create(input: Omit<Transaction, "id">): Promise<string>;
  /** Compra parcelada: agrupador + todas as parcelas numa única operação. */
  createInstallmentPurchase(input: InstallmentPurchaseInput): Promise<{ purchaseId: string; count: number }>;
  /** Registra o pagamento (parcial ou total) de uma fatura. NÃO é despesa. */
  payInvoice(input: PayInvoiceInput): Promise<void>;
  setStatus(tx: Transaction, status: TransactionStatus): Promise<void>;
  /** Edição de movimentação comum, ou de parcela(s) conforme o escopo. */
  update(tx: Transaction, patch: TransactionPatch, scope?: InstallmentScope): Promise<void>;
  delete(tx: Transaction, scope?: InstallmentScope): Promise<DeleteResult>;
  previewScope(tx: Transaction, scope: InstallmentScope): Promise<ScopePreview>;
}

/** O que as implementações precisam do app em tempo de execução. */
export interface CommandContext {
  /** "Hoje": navegador (local) ou fuso do household (supabase). */
  today(): ISODate;
  /** Dados carregados no momento da chamada (as regras do motor local precisam deles). */
  data(): WorkspaceData;
}
