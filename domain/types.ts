/**
 * Modelo de domínio do Finora.
 *
 * Convenções:
 * - Valores monetários SEMPRE em centavos (inteiros) — nunca float.
 * - Datas em ISO "YYYY-MM-DD" (sem horário/fuso) para evitar deslocamento de dia.
 * - Chaves técnicas em inglês; rótulos em pt-BR ficam em lib/labels.ts (i18n-friendly).
 * - Nenhum nome de pessoa/banco é fixo no código: tudo é dado cadastrado pelo usuário.
 */

import type { FinanceSnapshot } from "./snapshot";

export type ID = string;
export type ISODate = string;
export type Cents = number;

// ---------- Perfis ----------

export type ProfileKind = "individual" | "shared";

export interface FinancialProfile {
  id: ID;
  name: string;
  avatarUrl?: string;
  color: string;
  kind: ProfileKind;
  active: boolean;
}

// ---------- Contas e cartões ----------

export type AccountType =
  | "checking"
  | "digital"
  | "savings"
  | "wallet"
  | "cash"
  | "investment"
  | "other";

export interface Account {
  id: ID;
  name: string;
  institution?: string;
  ownerProfileId: ID;
  type: AccountType;
  initialBalanceCents: Cents;
  color: string;
  icon: string;
  includeInNetWorth: boolean;
  active: boolean;
}

export type CardBrand = "visa" | "mastercard" | "elo" | "amex" | "hipercard" | "other";

export interface CreditCard {
  id: ID;
  name: string;
  /**
   * Conta PADRÃO sugerida para pagar a fatura (opcional). A conta que de fato pagou é a
   * accountId da movimentação card_payment.
   */
  accountId?: ID;
  ownerProfileId: ID;
  brand?: CardBrand;
  limitCents: Cents;
  closingDay: number;
  dueDay: number;
  color: string;
  /** Apenas os 4 últimos dígitos. Nunca armazenar número completo/CVV. */
  last4?: string;
  active: boolean;
}

// ---------- Categorias ----------

/** "both" = pode ser usada em receitas e despesas. */
export type CategoryKind = "income" | "expense" | "both";

export interface Category {
  id: ID;
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
  /** Subcategoria quando preenchido (apenas 1 nível). */
  parentId?: ID;
  active: boolean;
}

// ---------- Movimentações ----------

export type TransactionKind =
  | "income"
  | "expense"
  | "credit_card_purchase"
  | "transfer"
  | "debt_payment"
  | "card_payment"
  | "investment"
  | "redemption";

export type TransactionStatus = "planned" | "pending" | "paid" | "overdue" | "canceled";

export interface SplitShare {
  profileId: ID;
  percent: number;
}

/**
 * Única fonte de verdade para somas e relatórios.
 *
 * Impactos por tipo (ver domain/calculations.ts):
 * - income / expense ........ saldo da conta SOMENTE quando pagas; expense conta como despesa.
 * - credit_card_purchase .... conta como despesa + consome limite + entra na fatura; NÃO mexe no saldo.
 * - card_payment ............ reduz saldo da conta e a fatura; NÃO é despesa.
 * - transfer ................ move saldo entre contas; NÃO é receita/despesa nem altera o patrimônio.
 * Templates (InstallmentPurchase, RecurringTransaction) NUNCA são somados:
 * eles apenas geram Transactions.
 */
export interface Transaction {
  id: ID;
  kind: TransactionKind;
  description: string;
  amountCents: Cents;
  /** Data de competência (quando o gasto/ganho "aconteceu"; compra no cartão = data da compra). */
  date: ISODate;
  dueDate?: ISODate;
  paidAt?: ISODate;
  status: TransactionStatus;
  categoryId?: ID;
  tags: string[];
  /** Conta de origem (ou conta creditada, para receitas). Vazio em compra no cartão. */
  accountId?: ID;
  /** Conta de destino em transferências, investimentos e resgates. */
  toAccountId?: ID;
  /**
   * Cartão: em compra no cartão consome limite (não mexe no saldo da conta);
   * em pagamento de fatura identifica qual cartão está sendo pago.
   */
  cardId?: ID;
  /**
   * Mês de vencimento ("YYYY-MM") da fatura. Pagamento de fatura: a fatura quitada (obrigatório). Compra no cartão:
   * preenchido só pelo banco (modo supabase, que atribui a fatura); no modo local é derivado do ciclo.
   */
  invoiceMonth?: string;
  profileId: ID;
  /** Divisão para despesas compartilhadas. Ausente = 100% do profileId. */
  split?: SplitShare[];
  notes?: string;
  installment?: { purchaseId: ID; number: number; total: number; purchaseDate?: ISODate };
  /** Ocorrência de uma recorrência: template + data da agenda (chave de geração; a `date` pode ser ajustada depois). */
  recurringId?: ID;
  occurrenceDate?: ISODate;
  /** Ocorrência futura cancelada PELA regra (pausa/mudança de agenda): a regra pode reativá-la. */
  canceledByRule?: boolean;
  debtId?: ID;
}

// ---------- Templates geradores (não entram em somas) ----------

export interface InstallmentPurchase {
  id: ID;
  description: string;
  totalCents: Cents;
  installments: number;
  firstDate: ISODate;
  cardId?: ID;
  accountId?: ID;
  profileId: ID;
  categoryId?: ID;
  tags?: string[];
  notes?: string;
}

export type RecurrenceFrequency = "weekly" | "monthly" | "yearly";

/** Tipos que podem recorrer. Parcelamento NÃO é recorrência (é outra coisa: compra única dividida). */
export type RecurringKind = "income" | "expense" | "credit_card_purchase";

/**
 * TEMPLATE de recorrência. NUNCA é somado: gera Transactions (ocorrências), e só elas entram em saldo, despesas,
 * dashboard, planejamento e calendário. Cada ocorrência aponta para o template por `recurringId` + `occurrenceDate`
 * (par único: gerar duas vezes nunca duplica).
 */
export interface RecurringTransaction {
  id: ID;
  kind: RecurringKind;
  description: string;
  amountCents: Cents;
  profileId: ID;
  /** Receita/despesa: conta. */
  accountId?: ID;
  /** Compra recorrente no cartão: cartão (sem conta). A fatura é decidida pelo banco / pelo ciclo. */
  cardId?: ID;
  categoryId: ID;
  tags: string[];
  notes?: string;
  frequency: RecurrenceFrequency;
  /** "A cada N" semanas/meses/anos (1 a 24). */
  interval: number;
  /** Âncora: o dia do mês/da semana vem dela; dia inexistente cai no último dia válido do mês. */
  startDate: ISODate;
  endDate?: ISODate;
  /** Nada é gerado antes desta data (o passado não é reconstruído). */
  materializeFrom: ISODate;
  active: boolean;
  /** Modo local: ocorrências excluídas pelo usuário (no banco: tabela recurring_skips). Não são recriadas. */
  skippedDates?: ISODate[];
}

// ---------- Dívidas e reservas ----------

/** Classificação para organização (sem regras bancárias por tipo). */
export type DebtKind = "loan" | "financing" | "personal" | "external_installment" | "other";

/**
 * Situação GRAVADA. "Quitada" nunca é gravada: é derivada do saldo (ou da quitação antecipada) — veja DebtDerivedStatus.
 * - active: em andamento (parcelas entram no "Disponível de verdade");
 * - paused: suspensa (não entra no disponível e não atrasa);
 * - canceled: cadastro errado — só sem pagamentos.
 */
export type DebtStatus = "active" | "paused" | "canceled";
export type DebtDerivedStatus = DebtStatus | "paid";

/**
 * Contrato da dívida. NUNCA entra em saldo, receitas ou despesas. As parcelas são DERIVADAS (split_cents + datas) e os
 * pagamentos são Transactions (kind debt_payment, debtId): só elas movem saldo e entram nas despesas realizadas.
 * Pago, restante, progresso e "quitada" também são derivados (domain/debts.ts; views v_debt_summary/v_debt_installments).
 */
export interface Debt {
  id: ID;
  name: string;
  /** Instituição ou pessoa (opcional: dívida informal pode não ter). */
  creditor?: string;
  kind: DebtKind;
  /** Responsável. */
  profileId: ID;
  notes?: string;
  /** Quanto foi recebido/devido originalmente. */
  principalCents: Cents;
  /** Quanto será pago no total (a diferença é só "custo financeiro", sem motor de juros). */
  totalCents: Cents;
  /** Sem parcelas = ausente (pagamentos livres até zerar). */
  installments?: number;
  firstDueDate?: ISODate;
  /** Conta padrão sugerida para pagar. */
  paymentAccountId?: ID;
  categoryId?: ID;
  status: DebtStatus;
  /** Quitação antecipada: data do acordo e desconto (saldo projetado - valor efetivamente pago). */
  settledAt?: ISODate;
  settlementDiscountCents?: Cents;
}

/**
 * COFRINHO: separação VIRTUAL de dinheiro que já está numa conta real. Não cria dinheiro, não é despesa e NÃO guarda
 * saldo: o saldo reservado é a soma do histórico de movimentos (veja domain/pockets.ts e v_pocket_balances).
 */
export type PocketStatus = "active" | "archived";

export interface Pocket {
  id: ID;
  name: string;
  description?: string;
  icon: string;
  color: string;
  /** Responsável (pessoa ou Casal). */
  profileId: ID;
  /** Onde o dinheiro está (lastro). Imutável. */
  accountId: ID;
  status: PocketStatus;
  /** Instante da criação (ISO com hora). */
  createdAt: string;
  /** Origem da importação dos cofrinhos antigos (idempotência). */
  legacyRef?: string;
}

/**
 * Histórico (append-only) de um cofrinho. Saldo = reserve + transfer_in + use_reversal − withdraw − transfer_out − use.
 * Nunca é editado nem excluído; correção = novo movimento.
 */
export type PocketMovementKind = "reserve" | "withdraw" | "transfer_in" | "transfer_out" | "use" | "use_reversal";

export interface PocketMovement {
  id: ID;
  pocketId: ID;
  kind: PocketMovementKind;
  /** Sempre positivo; o sinal vem de `kind`. */
  amountCents: Cents;
  date: ISODate;
  note?: string;
  /** Despesa que usou a reserva (use / use_reversal). */
  transactionId?: ID;
  /** Liga as duas pontas de uma transferência entre cofrinhos. */
  transferGroupId?: ID;
  /** Estorno: o `use` que está sendo desfeito. */
  reversesId?: ID;
  createdAt: string;
}

export type GoalKind = "travel" | "emergency" | "purchase" | "education" | "housing" | "vehicle" | "retirement" | "other";
export type GoalStatus = "active" | "paused" | "completed" | "canceled";

/**
 * OBJETIVO financeiro. Ligado a um cofrinho: o progresso é o saldo REAL do cofrinho. Sem cofrinho: progresso INFORMADO
 * à mão (manualAmountCents) — nunca é dinheiro reservado nem entra em disponível/patrimônio.
 */
export interface Goal {
  id: ID;
  name: string;
  description?: string;
  kind: GoalKind;
  targetCents: Cents;
  deadline?: ISODate;
  /** Responsável financeiro. */
  profileId: ID;
  icon: string;
  color: string;
  status: GoalStatus;
  pocketId?: ID;
  /** Só vale sem cofrinho; ao ligar a um cofrinho vira 0 e NÃO é restaurado ao desligar. */
  manualAmountCents: Cents;
}

/**
 * Tudo que pertence a um workspace — o que os repositórios entregam à UI.
 *
 * `transactions` é o que está CARREGADO: no modo local, tudo; no modo supabase, só a janela pedida pela tela
 * (mês + pendências em aberto). Por isso saldos, faturas e limites NÃO saem de `transactions` no modo
 * supabase: vêm de `snapshot` (views do banco). Veja domain/snapshot.ts.
 */
export interface WorkspaceData {
  profiles: FinancialProfile[];
  categories: Category[];
  accounts: Account[];
  creditCards: CreditCard[];
  transactions: Transaction[];
  installmentPurchases: InstallmentPurchase[];
  recurringTransactions: RecurringTransaction[];
  debts: Debt[];
  pockets: Pocket[];
  /**
   * Histórico de movimentos dos cofrinhos CARREGADO: no modo local, todo (os saldos são derivados dele); no supabase,
   * vazio (saldo/reservado vêm das views no snapshot; o histórico é lido sob demanda por `PocketRepository.movements()`).
   */
  pocketMovements: PocketMovement[];
  goals: Goal[];
  /** Derivados vindos do banco (modo supabase). Ausente = derivar de `transactions` (modo local). */
  snapshot?: FinanceSnapshot;
  /** Tags já cadastradas (sugestões). Ausente = derivar de `transactions`. */
  knownTags?: string[];
  /** A janela carregada atingiu o limite de itens (há mais movimentações no período). */
  transactionsTruncated?: boolean;
}
