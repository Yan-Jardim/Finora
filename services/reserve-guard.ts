import { backingShortfall } from "@/domain/pockets";
import type { Account, ID, Pocket, PocketMovement, Transaction } from "@/domain/types";
import { appError } from "@/repositories/supabase/errors";
import type { Repository } from "@/repositories/types";

/**
 * GUARDAS LOCAIS dos cofrinhos — o equivalente, no motor local, dos triggers do banco que protegem TODA operação que
 * altera saldo (z_reserve_backing) e a despesa que usou reserva (d_guard_pocket_use). São opcionais: sem os repositórios de
 * cofrinhos (ex.: testes que não os têm) viram no-op.
 */
export interface ReserveGuardRepos {
  accounts?: Pick<Repository<Account>, "list">;
  pockets?: { list(): Promise<Pocket[]> };
  pocketMovements?: Pick<Repository<PocketMovement>, "list">;
}

type WithTransactions = ReserveGuardRepos & { transactions: Pick<Repository<Transaction>, "list"> };

/**
 * Confere o lastro ANTES de gravar uma mudança em UMA transação: `before` (como estava) e `after` (como ficará).
 * Receita/melhoria nunca é bloqueada; só operação que reduz o saldo de conta COM reserva abaixo do reservado.
 */
export async function assertBacked(repos: WithTransactions, change: { before?: Transaction; after?: Transaction }): Promise<void> {
  if (!repos.accounts || !repos.pockets || !repos.pocketMovements) return;
  const [accounts, pockets, movements, all] = await Promise.all([
    repos.accounts.list(),
    repos.pockets.list(),
    repos.pocketMovements.list(),
    repos.transactions.list(),
  ]);
  if (movements.length === 0) return;
  const afterAll = all.filter((t) => t.id !== change.before?.id);
  if (change.after) afterAll.push(change.after);
  const touched: ID[] = [change.before, change.after].flatMap((t) => (t ? [t.accountId, t.toAccountId] : [])).filter((x): x is ID => !!x);
  const gap = backingShortfall({ accounts, pockets, movements, before: all, after: afterAll, touched });
  if (gap) {
    throw appError("reserve_shortfall", {
      account_id: gap.accountId,
      shortfall_cents: gap.shortfallCents,
      reserved_cents: gap.reservedCents,
      balance_cents: gap.balanceCents,
    });
  }
}

/** Campos que mudam o efeito financeiro: bloqueados numa despesa que usou reserva (só o estorno desfaz). */
const FINANCIAL_KEYS = ["amountCents", "date", "status", "paidAt", "accountId", "toAccountId", "kind"] as const;

/**
 * Despesa que usou dinheiro de cofrinho: não se exclui nem se altera valor/data/status/conta (descrição, categoria, tags
 * e notas seguem editáveis). Para desfazer: `PocketCommands.reverseUse`. `patch` ausente = exclusão/mudança de status.
 */
export async function assertNotPocketUse(repos: ReserveGuardRepos, tx: Transaction, patch?: Partial<Transaction>): Promise<void> {
  if (!repos.pocketMovements) return;
  // Como o banco (is distinct from): só conta se o valor MUDA (o formulário de edição reenvia todos os campos).
  const same = (k: (typeof FINANCIAL_KEYS)[number]) => (patch?.[k] ?? null) === (tx[k] ?? null);
  if (patch && FINANCIAL_KEYS.every((k) => !(k in patch) || same(k))) return;
  const movements = await repos.pocketMovements.list();
  if (movements.some((m) => m.kind === "use" && m.transactionId === tx.id)) throw appError("use_pocket_flow");
}
