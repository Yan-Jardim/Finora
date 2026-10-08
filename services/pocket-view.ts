import { goalProgress, type GoalProgress } from "@/domain/pockets";
import { snapshotFree, snapshotOf, snapshotPocketBalance, snapshotReserved } from "@/domain/snapshot";
import type { Account, Cents, Goal, ID, ISODate, Pocket, WorkspaceData } from "@/domain/types";

/**
 * Visões de COFRINHOS e OBJETIVOS para as telas (puras): tudo derivado do snapshot — views do banco no Supabase, histórico
 * no modo local. Nenhum valor reservado é guardado nos modelos.
 */
export const ALL = "all";

export interface PocketCard {
  pocket: Pocket;
  /** Saldo reservado neste cofrinho. */
  balanceCents: Cents;
  account?: Account;
  /** Da CONTA (não só deste cofrinho): saldo bancário, total reservado e livre. */
  accountBalanceCents: Cents;
  accountReservedCents: Cents;
  accountFreeCents: Cents;
  /** Objetivo ligado a este cofrinho. */
  goal?: Goal;
}

export interface PocketsView {
  active: PocketCard[];
  archived: PocketCard[];
  /** Total reservado nos cofrinhos visíveis (do filtro). */
  reservedCents: Cents;
  /** Dinheiro livre das contas de consumo visíveis (saldo − reservado). */
  freeCents: Cents;
}

const byName = (a: PocketCard, b: PocketCard) => a.pocket.name.localeCompare(b.pocket.name, "pt-BR");

export function buildPocketsView(data: WorkspaceData, today: ISODate, profileId: ID | typeof ALL = ALL): PocketsView {
  const snap = snapshotOf(data, today);
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const goalByPocket = new Map(data.goals.filter((g) => g.pocketId).map((g) => [g.pocketId as ID, g]));
  const scoped = profileId !== ALL && data.profiles.some((p) => p.id === profileId);

  const cards = data.pockets
    .filter((p) => !scoped || p.profileId === profileId)
    .map<PocketCard>((pocket) => {
      const account = accounts.get(pocket.accountId);
      return {
        pocket,
        balanceCents: snapshotPocketBalance(snap, pocket),
        account,
        accountBalanceCents: account ? (snap.accountBalances.get(account.id) ?? account.initialBalanceCents) : 0,
        accountReservedCents: snapshotReserved(snap, pocket.accountId),
        accountFreeCents: account ? snapshotFree(snap, account) : 0,
        goal: goalByPocket.get(pocket.id),
      };
    })
    .sort(byName);

  const consumption = data.accounts.filter((a) => a.active && a.type !== "investment" && (!scoped || a.ownerProfileId === profileId));
  return {
    active: cards.filter((c) => c.pocket.status === "active"),
    archived: cards.filter((c) => c.pocket.status === "archived"),
    reservedCents: cards.reduce((sum, c) => sum + c.balanceCents, 0),
    freeCents: consumption.reduce((sum, a) => sum + snapshotFree(snap, a), 0),
  };
}

/** Situação da conta de um cofrinho para mostrar o "antes/depois" de uma operação (sem tocar em nada). */
export function accountPosition(data: WorkspaceData, today: ISODate, accountId: ID) {
  const snap = snapshotOf(data, today);
  const account = data.accounts.find((a) => a.id === accountId);
  const balanceCents = account ? (snap.accountBalances.get(account.id) ?? account.initialBalanceCents) : 0;
  const reservedCents = snapshotReserved(snap, accountId);
  return { balanceCents, reservedCents, freeCents: balanceCents - reservedCents };
}

export interface GoalCard {
  goal: Goal;
  progress: GoalProgress;
  pocket?: Pocket;
  /** Dias até o prazo (negativo = vencido); undefined sem prazo. */
  daysLeft?: number;
}

const DAY_MS = 86_400_000;
export const daysBetween = (from: ISODate, to: ISODate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export interface GoalsView {
  active: GoalCard[];
  closed: GoalCard[];
}

export function buildGoalsView(data: WorkspaceData, today: ISODate, profileId: ID | typeof ALL = ALL): GoalsView {
  const snap = snapshotOf(data, today);
  const pockets = new Map(data.pockets.map((p) => [p.id, p]));
  const scoped = profileId !== ALL && data.profiles.some((p) => p.id === profileId);
  const cards = data.goals
    .filter((g) => !scoped || g.profileId === profileId)
    .map<GoalCard>((goal) => ({
      goal,
      progress: goalProgress(goal, snap.pocketBalances),
      pocket: goal.pocketId ? pockets.get(goal.pocketId) : undefined,
      daysLeft: goal.deadline ? daysBetween(today, goal.deadline) : undefined,
    }))
    // Mais perto do prazo primeiro; sem prazo por último.
    .sort((a, b) => (a.goal.deadline ?? "9999").localeCompare(b.goal.deadline ?? "9999") || a.goal.name.localeCompare(b.goal.name, "pt-BR"));
  return {
    active: cards.filter((c) => c.goal.status === "active" || c.goal.status === "paused"),
    closed: cards.filter((c) => c.goal.status === "completed" || c.goal.status === "canceled"),
  };
}
