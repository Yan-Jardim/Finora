import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO } from "@/domain/dates";
import { normalizeTransaction } from "@/domain/legacy";
import type { Goal, Pocket, PocketMovement } from "@/domain/types";
import type { DataSourceMode } from "@/lib/config/data-source";
import { seeds } from "@/mocks/data";
import type { DebtCommands, DebtContext } from "@/services/debt-commands";
import { LocalDebtCommands } from "@/services/local-debt";
import { LocalPocketCommands } from "@/services/local-pocket";
import { LocalRecurrenceCommands } from "@/services/local-recurrence";
import type { PocketCommands, PocketContext } from "@/services/pocket-commands";
import {
  LEGACY_LOCAL_POCKETS_KEY,
  migrateLegacyPockets,
  POCKET_MOVEMENT_STORE_NAME,
  POCKET_STORE_NAME,
  prepareLocalPockets,
  readLegacyPockets,
  type LegacyPocket,
  type PocketMigrationReport,
} from "@/services/pocket-migration";
import { LocalTransactionCommands } from "@/services/local-transaction-commands";
import type { RecurrenceCommands, RecurrenceContext } from "@/services/recurrence-commands";
import { SupabaseDebtCommands } from "@/services/supabase-debt-commands";
import { SupabasePocketCommands } from "@/services/supabase-pocket-commands";
import { SupabaseRecurrenceCommands } from "@/services/supabase-recurrence-commands";
import { SupabaseTransactionCommands } from "@/services/supabase-transaction-commands";
import type { CommandContext, TransactionCommands } from "@/services/transaction-commands";
import { LocalStorageRepository } from "./local-storage-repository";
import { LocalAccountRepository, type AccountGuardSources } from "./local-account-repository";
import { LocalPocketRepository } from "./local-pocket-repository";
import { LocalTransactionRepository } from "./local-transaction-repository";
import { SupabaseRecurringRepository } from "./supabase/supabase-recurring-repository";
import { SupabaseDebtRepository } from "./supabase/supabase-debt-repository";
import { SupabaseGoalRepository, SupabasePocketRepository } from "./supabase/supabase-pocket-repository";
import { SupabaseFinanceReader } from "./supabase/supabase-finance-reader";
import {
  SupabaseAccountRepository,
  SupabaseCategoryRepository,
  SupabaseCreditCardRepository,
  SupabaseProfileRepository,
  seedDefaultCategories,
} from "./supabase/supabase-repository";
import { SupabaseTransactionRepository } from "./supabase/supabase-transaction-repository";
import type { FinanceReader, Repositories, WorkspaceAdmin } from "./types";

/**
 * ÚNICO lugar que conhece as implementações de persistência.
 *
 * - modo "local": tudo em localStorage (demonstração e testes; motor de regras no cliente).
 * - modo "supabase": Pessoas, Categorias, Contas, Cartões E Movimentações (parcelas, faturas, pagamentos, tags)
 *   vêm do Supabase (RLS por household). Leituras por janela de datas; saldos/faturas/limites vêm das views;
 *   escritas de negócio são RPCs atômicas (veja services/supabase-transaction-commands.ts).
 *   Cofrinhos: cadastro e histórico são LIDOS do banco; saldo reservado/livre vêm das views (snapshot); TODA escrita é RPC
 *   (create_pocket, pocket_reserve, spend_from_pocket...). Objetivos: CRUD com RLS.
 *
 * Os dados antigos de movimentações do localStorage NÃO são lidos, importados nem apagados no modo supabase.
 */
const local = {
  profiles: new LocalStorageRepository("profiles", () => seeds.profiles),
  categories: new LocalStorageRepository("categories", () => seeds.categories),
  // Contas locais com as guardas de lastro do banco (editar saldo inicial/arquivar/tipo com reserva).
  accounts: new LocalAccountRepository("accounts", () => seeds.accounts, (): AccountGuardSources => ({ pockets: pocketStore, pocketMovements: pocketMovementStore, transactions: local.transactions })),
  creditCards: new LocalStorageRepository("credit-cards", () => seeds.creditCards),
  transactions: new LocalTransactionRepository("transactions", () => seeds.transactions, normalizeTransaction),
  installmentPurchases: new LocalStorageRepository("installment-purchases", () => seeds.installmentPurchases),
  recurring: new LocalStorageRepository("recurring", () => seeds.recurringTransactions),
  debts: new LocalStorageRepository("debts", () => seeds.debts),
  goals: new LocalStorageRepository<Goal>("goals", () => seeds.goals),
};

/**
 * Cofrinhos locais: cadastro e histórico em chaves NOVAS (a chave antiga "pockets", que guardava o saldo, NUNCA é apagada:
 * a migração só a lê). O saldo é derivado do histórico.
 */
const pocketStore = new LocalStorageRepository<Pocket>(POCKET_STORE_NAME, () => seeds.pockets);
const pocketMovementStore = new LocalStorageRepository<PocketMovement>(POCKET_MOVEMENT_STORE_NAME, () => seeds.pocketMovements);

/** Repositórios do modo local + cofrinhos: os comandos de transação/dívida precisam deles para as guardas de lastro (reserve-guard). */
const guarded = { ...local, pockets: pocketStore, pocketMovements: pocketMovementStore };

/** Repositórios do modo local (singleton). */
export const repositories: Repositories = { ...local, pockets: new LocalPocketRepository(pocketStore, pocketMovementStore) };

/** Restaurar/zerar dados de DEMONSTRAÇÃO (localStorage). Nunca toca o Supabase. */
export const workspaceAdmin: WorkspaceAdmin = {
  async reset(mode) {
    const pick = <T,>(items: T[]) => (mode === "demo" ? items : []);
    local.profiles.replaceAll(pick(seeds.profiles));
    local.categories.replaceAll(pick(seeds.categories));
    local.accounts.replaceAll(pick(seeds.accounts));
    local.creditCards.replaceAll(pick(seeds.creditCards));
    local.transactions.replaceAll(pick(seeds.transactions));
    local.installmentPurchases.replaceAll(pick(seeds.installmentPurchases));
    local.recurring.replaceAll(pick(seeds.recurringTransactions));
    local.debts.replaceAll(pick(seeds.debts));
    pocketStore.replaceAll(pick(seeds.pockets));
    pocketMovementStore.replaceAll(pick(seeds.pocketMovements));
    local.goals.replaceAll(pick(seeds.goals));
  },
};

export interface DataSource {
  mode: DataSourceMode;
  repos: Repositories;
  /** Só existe no modo local. */
  admin?: WorkspaceAdmin;
  /** Só existe no modo supabase. */
  seedDefaultCategories?: () => Promise<number>;
  /** Só existe no modo supabase: saldos, faturas e limites das views + tags. No local, o app deriva das movimentações. */
  finance?: FinanceReader;
  /** Comandos que ALTERAM movimentações: motor local ou RPCs do banco. Os componentes não sabem qual. */
  createCommands(ctx: CommandContext): TransactionCommands;
  /** Comandos de recorrência (template): motor local ou RPCs do banco. */
  createRecurrenceCommands(ctx: RecurrenceContext): RecurrenceCommands;
  /** Comandos de dívida: motor local ou RPCs do banco. */
  createDebtCommands(ctx: DebtContext): DebtCommands;
  /** Comandos de cofrinhos e objetivos ligados: motor local ou RPCs do banco. */
  createPocketCommands(ctx: PocketContext): PocketCommands;
  /**
   * Preparação ANTES da primeira carga. Modo local: migra os cofrinhos antigos (uma vez, idempotente, sem apagar a chave
   * antiga) e devolve o relatório. Supabase: nada a fazer (a importação dos antigos é uma ação explícita do usuário).
   */
  prepare?(): void;
  /** Cofrinhos antigos ainda salvos neste navegador, prontos para importar (modo supabase). */
  readLegacyPockets?(): LegacyPocket[];
  /** Importa os cofrinhos antigos do navegador (modo supabase; idempotente por legacyRef). */
  importLegacyPockets?(): Promise<PocketMigrationReport>;
}

export interface DataSourceOptions {
  mode: DataSourceMode;
  /** Obrigatórios no modo supabase. */
  householdId?: string;
  client?: SupabaseClient;
}

export function createDataSource({ mode, householdId, client }: DataSourceOptions): DataSource {
  if (mode === "local") {
    return {
      mode,
      repos: repositories,
      admin: workspaceAdmin,
      createCommands: (ctx) => new LocalTransactionCommands(guarded, ctx),
      createRecurrenceCommands: (ctx) => new LocalRecurrenceCommands(local, ctx),
      createDebtCommands: (ctx) => new LocalDebtCommands(guarded, ctx),
      createPocketCommands: (ctx) => localPocketCommands(ctx),
      prepare: () =>
        prepareLocalPockets(() => {
          pocketStore.replaceAll([]);
          pocketMovementStore.replaceAll([]);
        }),
      readLegacyPockets: () => readLegacyPockets(LEGACY_LOCAL_POCKETS_KEY),
      importLegacyPockets: () =>
        migrateLegacyPockets(readLegacyPockets(LEGACY_LOCAL_POCKETS_KEY), {
          commands: localPocketCommands({ today: () => todayISO() }),
          accounts: local.accounts,
          pockets: repositories.pockets,
        }),
    };
  }

  if (!householdId || !client) throw new Error("Modo supabase exige householdId e client.");
  const pocketCommands = new SupabasePocketCommands(client);
  const pockets = new SupabasePocketRepository(client);
  const accountsRepo = new SupabaseAccountRepository(client, householdId);
  const legacyKey = `finora:v1:sb:${householdId}:pockets`;
  const transactions = new SupabaseTransactionRepository(client);
  return {
    mode,
    repos: {
      profiles: new SupabaseProfileRepository(client, householdId),
      categories: new SupabaseCategoryRepository(client, householdId),
      accounts: accountsRepo,
      creditCards: new SupabaseCreditCardRepository(client, householdId),
      transactions,
      // O agrupador das parcelas só existe para integridade; a UI não o lê (a parcela já traz n/total).
      installmentPurchases: { list: async () => [], get: async () => undefined },
      recurring: new SupabaseRecurringRepository(client),
      debts: new SupabaseDebtRepository(client),
      pockets,
      goals: new SupabaseGoalRepository(client, householdId),
    },
    seedDefaultCategories: () => seedDefaultCategories(client, householdId),
    finance: new SupabaseFinanceReader(client),
    createCommands: (ctx) => new SupabaseTransactionCommands(client, transactions, ctx),
    createRecurrenceCommands: () => new SupabaseRecurrenceCommands(client),
    createDebtCommands: () => new SupabaseDebtCommands(client),
    createPocketCommands: () => pocketCommands,
    readLegacyPockets: () => readLegacyPockets(legacyKey),
    importLegacyPockets: () => migrateLegacyPockets(readLegacyPockets(legacyKey), { commands: pocketCommands, accounts: accountsRepo, pockets }),
  };
}

/** Comandos locais de cofrinhos sobre os armazenamentos do modo local. */
function localPocketCommands(ctx: PocketContext): PocketCommands {
  return new LocalPocketCommands(
    {
      pockets: pocketStore,
      pocketMovements: pocketMovementStore,
      goals: local.goals,
      accounts: local.accounts,
      profiles: local.profiles,
      transactions: local.transactions,
    },
    ctx,
  );
}
