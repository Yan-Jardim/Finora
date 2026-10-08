import type { FinanceSnapshot } from "@/domain/snapshot";
import type {
  Account,
  Category,
  CreditCard,
  Debt,
  FinancialProfile,
  Goal,
  InstallmentPurchase,
  ID,
  ISODate,
  Pocket,
  PocketMovement,
  PocketMovementKind,
  RecurringTransaction,
  Transaction,
} from "@/domain/types";

/**
 * Contrato de acesso a dados. Tudo é assíncrono de propósito: a implementação
 * atual (localStorage) é síncrona, mas a futura (Supabase) não será.
 * Componentes dependem SOMENTE destas interfaces.
 */
export interface Repository<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  create(input: Omit<T, "id">): Promise<T>;
  /** Em lote (ex.: parcelas de uma compra): no Supabase vira um único insert. */
  createMany(inputs: Omit<T, "id">[]): Promise<T[]>;
  update(id: string, patch: Partial<Omit<T, "id">>): Promise<T>;
  remove(id: string): Promise<void>;
  removeMany(ids: string[]): Promise<void>;
}

export type ProfileRepository = Repository<FinancialProfile>;
export type CategoryRepository = Repository<Category>;
export type AccountRepository = Repository<Account>;
export type CreditCardRepository = Repository<CreditCard>;

/**
 * Janela de movimentações que uma tela precisa. No Supabase vira filtro no banco (nunca se carrega o histórico
 * inteiro); no modo local (tudo já está em memória) é ignorada e devolve tudo.
 */
export interface TransactionWindow {
  /** Intervalo por data de competência (inclusive). */
  from: ISODate;
  to: ISODate;
  /**
   * Inclui contas a pagar (despesa/dívida) ainda PENDENTES com data anterior a `from` — o dashboard soma as
   * vencidas de meses anteriores no "Disponível de verdade".
   */
  overdueBills?: boolean;
  /**
   * RELATÓRIOS (fluxo de caixa e patrimônio): inclui também o que foi PAGO dentro de from..to mesmo que a data de
   * competência seja anterior (conta de setembro paga em outubro). Sem isso o caixa do período ficaria incompleto.
   */
  paidBetween?: boolean;
  /** Inclui as últimas `limit` movimentações já realizadas (data <= today; sem previstas nem canceladas). */
  recent?: { limit: number; today: ISODate };
  /**
   * PLANEJAMENTO: ignora o intervalo from/to e carrega só o que ainda vai mexer no caixa — movimentações EM ABERTO
   * (previstas/pendentes, inclusive as atrasadas) até `until`. Compras no cartão ficam de fora (o planejamento as lê
   * pelas faturas), salvo as de `cardSince` em diante, usadas só para DETALHAR cada fatura. Nunca o histórico inteiro.
   */
  openOnly?: {
    until: ISODate;
    cardSince: ISODate;
    /** CALENDÁRIO: além dos itens em aberto, traz TUDO (qualquer status) de from..to — pagamentos realizados do mês. */
    withWindow?: boolean;
  };
}

export interface TransactionQueryResult {
  items: Transaction[];
  /** O teto de itens foi atingido: há mais movimentações no período do que as carregadas. */
  truncated: boolean;
}

/**
 * Leitura de movimentações. ESCRITAS não passam por aqui: o frontend usa `TransactionCommands`
 * (services/transaction-commands.ts), que no Supabase são RPCs atômicas.
 */
export interface TransactionRepository extends Pick<Repository<Transaction>, "list" | "get"> {
  query(window: TransactionWindow): Promise<TransactionQueryResult>;
}

/** Templates de recorrência (leitura; as escritas passam por RecurrenceCommands). */
export type RecurringRepository = Pick<Repository<RecurringTransaction>, "list" | "get">;

/** Dívidas (contrato; leitura — as escritas passam por DebtCommands, e pago/restante vêm do snapshot). */
export type DebtRepository = Pick<Repository<Debt>, "list" | "get">;

/** Agrupador das parcelas (não entra em somas; a UI só precisa dele no modo local). */
export type InstallmentPurchaseRepository = Pick<Repository<InstallmentPurchase>, "list" | "get">;
export interface PocketMovementQuery {
  /** Só os movimentos deste cofrinho (padrão: todos). */
  pocketId?: ID;
  /** Só estes tipos (padrão: todos). */
  kinds?: PocketMovementKind[];
  /** Mais recentes primeiro; padrão 200. */
  limit?: number;
}

/**
 * COFRINHOS: somente LEITURA. As escritas passam por `PocketCommands` (services/pocket-commands.ts), que no Supabase são
 * RPCs atômicas. O saldo de um cofrinho NÃO está aqui: vem do snapshot (v_pocket_balances; local: soma do histórico).
 */
export interface PocketRepository extends Pick<Repository<Pocket>, "list" | "get"> {
  /** Histórico (append-only), mais recente primeiro. */
  movements(query?: PocketMovementQuery): Promise<PocketMovement[]>;
}

/**
 * OBJETIVOS: CRUD comum (RLS). Não movimentam dinheiro. Ligar/desligar um cofrinho NÃO é CRUD: use
 * `PocketCommands.linkGoal` (a regra "ligou, o valor manual zera" e a unicidade ficam no comando/banco).
 */
export type GoalRepository = Repository<Goal>;

export interface Repositories {
  profiles: ProfileRepository;
  categories: CategoryRepository;
  accounts: AccountRepository;
  creditCards: CreditCardRepository;
  transactions: TransactionRepository;
  installmentPurchases: InstallmentPurchaseRepository;
  recurring: RecurringRepository;
  debts: DebtRepository;
  pockets: PocketRepository;
  goals: GoalRepository;
}

/** Valores derivados e auxiliares que vêm prontos do banco (só modo supabase). */
export interface FinanceReader {
  /** Saldos (v_account_balances), faturas (v_card_invoice_totals) e limite usado (v_card_usage). */
  snapshot(): Promise<FinanceSnapshot>;
  /** Nomes das tags cadastradas (sugestões no formulário). */
  tags(): Promise<string[]>;
}

export type WorkspaceSeedMode = "demo" | "empty";

/** Operações administrativas do workspace (exemplo/zerar). No Supabase: ação de servidor. */
export interface WorkspaceAdmin {
  reset(mode: WorkspaceSeedMode): Promise<void>;
}
