import type { WorkspaceData } from "@/domain/types";
import type { DataSource } from "./index";
import type { TransactionWindow } from "./types";

/**
 * Carrega o workspace de uma fonte de dados: cadastros, movimentações da JANELA pedida e (no Supabase) os
 * derivados das views + tags. Puro (sem React): usado pelo provider e pelos testes de paridade.
 */
export async function loadWorkspace(source: DataSource, window: TransactionWindow): Promise<WorkspaceData> {
  const { repos, finance } = source;
  const [profiles, categories, accounts, creditCards, pockets, goals, installmentPurchases, recurringTransactions, debts, found, snapshot, knownTags] =
    await Promise.all([
      repos.profiles.list(),
      repos.categories.list(),
      repos.accounts.list(),
      repos.creditCards.list(),
      repos.pockets.list(),
      repos.goals.list(),
      repos.installmentPurchases.list(),
      repos.recurring.list(),
      repos.debts.list(),
      repos.transactions.query(window),
      finance?.snapshot(),
      finance?.tags(),
    ]);
  // Com "finance" (supabase) os saldos vêm das views e só carregamos os USOS (use/use_reversal), para marcar as despesas que
  // usaram cofrinho; o histórico completo é lido sob demanda (repos.pockets.movements). Sem "finance" (local) o histórico é a
  // fonte dos saldos e é carregado inteiro.
  const pocketMovements = await repos.pockets.movements(
    finance ? { kinds: ["use", "use_reversal"], limit: 5000 } : { limit: Number.MAX_SAFE_INTEGER },
  );
  return {
    profiles,
    categories,
    accounts,
    creditCards,
    transactions: found.items,
    installmentPurchases,
    recurringTransactions,
    debts,
    pockets,
    pocketMovements,
    goals,
    snapshot,
    knownTags,
    transactionsTruncated: found.truncated,
  };
}
