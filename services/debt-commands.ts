import type { Cents, Debt, DebtKind, DebtStatus, ID, ISODate } from "@/domain/types";

/**
 * PORTA de comandos de dívida. Os componentes só conhecem esta interface:
 *
 * - LocalDebtCommands ........ motor em localStorage (demo/testes): services/local-debt.ts;
 * - SupabaseDebtCommands ..... RPCs atômicas: create_debt, update_debt, pay_debt, settle_debt, reopen_debt,
 *   set_debt_status.
 *
 * Princípios (iguais nos dois lados):
 *  - a dívida (contrato) e as parcelas (derivadas) nunca movem saldo; só os PAGAMENTOS (transações debt_payment);
 *  - "quitada" é derivada do saldo ou da quitação antecipada — nunca um botão que a marca sem pagar;
 *  - pagar mais que o saldo devido é sempre recusado;
 *  - pagamento = uma transação + validação do saldo no mesmo comando (atômico).
 */

export interface DebtInput {
  name: string;
  creditor?: string;
  kind: DebtKind;
  profileId: ID;
  notes?: string;
  /** Quanto recebeu/deve originalmente. */
  principalCents: Cents;
  /** Quanto vai pagar no total. */
  totalCents: Cents;
  /** Sem parcelas = ausente (pagamentos livres até zerar). */
  installments?: number;
  firstDueDate?: ISODate;
  paymentAccountId?: ID;
  categoryId?: ID;
}

export type DebtPatch = Partial<DebtInput>;

export interface DebtPaymentInput {
  debtId: ID;
  accountId: ID;
  amountCents: Cents;
  date: ISODate;
}

export interface SettleResult {
  /** Saldo projetado no momento do acordo. */
  projectedCents: Cents;
  /** Valor efetivamente pago. */
  paidCents: Cents;
  /** projetado - pago. */
  discountCents: Cents;
}

export interface DebtCommands {
  create(input: DebtInput): Promise<string>;
  /** Descritivos sempre; valores/cronograma só se não quitada e nunca abaixo do já pago. */
  update(debt: Debt, patch: DebtPatch): Promise<void>;
  /** Registra um pagamento (parcela, parcial ou livre). Nunca acima do restante. */
  pay(input: DebtPaymentInput): Promise<string>;
  /** Quitação antecipada: valor efetivamente pago + encerra, guardando o desconto. */
  settle(input: DebtPaymentInput): Promise<SettleResult>;
  /** active <-> paused; canceled só sem pagamentos. */
  setStatus(debt: Debt, status: DebtStatus): Promise<void>;
  /** Desfaz a quitação (o desconto volta a ser saldo devido). */
  reopen(debt: Debt): Promise<void>;
}

export interface DebtContext {
  today(): ISODate;
}
