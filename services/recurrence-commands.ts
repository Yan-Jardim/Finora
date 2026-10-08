import type { Cents, ID, ISODate, RecurrenceFrequency, RecurringKind, RecurringTransaction } from "@/domain/types";

/**
 * PORTA de comandos de recorrência (template). Os componentes só conhecem esta interface:
 *
 * - LocalRecurrenceCommands ....... motor em localStorage (demo/testes): services/local-recurrence.ts;
 * - SupabaseRecurrenceCommands .... RPCs atômicas: create_recurring_transaction, update_recurring_transaction,
 *   set_recurring_transaction_active e sync_recurring_transactions.
 *
 * Princípios (iguais nos dois lados):
 *  - o template nunca soma; as ocorrências geradas são Transactions comuns;
 *  - nada é gerado/alterado no passado; pagas e canceladas pelo usuário nunca são tocadas;
 *  - toda sincronização é idempotente (pode rodar a qualquer momento, quantas vezes for);
 *  - não há exclusão destrutiva: pausar cancela só as futuras previstas, e de forma reversível.
 */

export interface RecurrenceInput {
  kind: RecurringKind;
  description: string;
  amountCents: Cents;
  profileId: ID;
  accountId?: ID;
  cardId?: ID;
  categoryId: ID;
  tags: string[];
  notes?: string;
  frequency: RecurrenceFrequency;
  interval: number;
  startDate: ISODate;
  endDate?: ISODate;
}

/** O tipo nunca muda; pausar/reativar é `setActive`. */
export type RecurrencePatch = Partial<Omit<RecurrenceInput, "kind">>;

export interface SyncResult {
  created: number;
  revived: number;
  canceled: number;
  promoted: number;
}

export const EMPTY_SYNC: SyncResult = { created: 0, revived: 0, canceled: 0, promoted: 0 };

export interface RecurrenceUpdateOptions {
  /**
   * Ocorrências FUTURAS ainda não pagas (previstas/pendentes, a partir de hoje) recebem os novos campos.
   * `false` = só a regra muda (vale para as ocorrências geradas daqui em diante). Padrão: true.
   * Pagas, canceladas e passadas nunca mudam.
   */
  applyToFuture?: boolean;
}

export interface RecurrenceCommands {
  create(input: RecurrenceInput): Promise<SyncResult & { id: string }>;
  update(rule: RecurringTransaction, patch: RecurrencePatch, options?: RecurrenceUpdateOptions): Promise<SyncResult & { updated: number }>;
  /** Pausar: para de gerar e cancela as futuras previstas (reversível). Ativar: volta a gerar daqui em diante. */
  setActive(rule: RecurringTransaction, active: boolean): Promise<SyncResult>;
  /** Cria o que falta, estende o horizonte e promove previstas cuja data chegou. Idempotente. */
  sync(): Promise<SyncResult>;
}

export interface RecurrenceContext {
  today(): ISODate;
}
