import { accountBalance } from "./calculations";
import type { Account, Cents, Goal, ID, Pocket, PocketMovement, PocketMovementKind, Transaction } from "./types";

/**
 * COFRINHOS — regras puras (sem I/O). O saldo de um cofrinho NUNCA é gravado: é a soma com sinal do histórico
 * (no Supabase: view v_pocket_balances; no modo local: estas funções). Mesma definição nos dois motores.
 *
 *   reservado(conta) = soma dos saldos dos cofrinhos da conta
 *   livre(conta)     = saldo bancário − reservado
 *   regra de lastro  = reservado > 0  =>  saldo >= reservado   (conta SEM reserva nunca é verificada: saldo negativo vale)
 *
 * Reservar/retirar/transferir NÃO mexem no saldo bancário nem criam despesa. Gastar com a reserva reduz saldo e reservado
 * na mesma medida (o livre não muda quando a reserva cobre a despesa inteira).
 */

const POSITIVE: ReadonlySet<PocketMovementKind> = new Set(["reserve", "transfer_in", "use_reversal"]);

/** +1 aumenta o reservado; −1 diminui. */
export const movementSign = (kind: PocketMovementKind): 1 | -1 => (POSITIVE.has(kind) ? 1 : -1);

export const signedCents = (m: Pick<PocketMovement, "kind" | "amountCents">): Cents => movementSign(m.kind) * m.amountCents;

export function pocketBalances(movements: PocketMovement[]): Map<ID, Cents> {
  const map = new Map<ID, Cents>();
  for (const m of movements) map.set(m.pocketId, (map.get(m.pocketId) ?? 0) + signedCents(m));
  return map;
}

export const pocketBalanceOf = (movements: PocketMovement[], pocketId: ID): Cents =>
  movements.filter((m) => m.pocketId === pocketId).reduce((sum, m) => sum + signedCents(m), 0);

/** Reservado por conta: soma dos saldos dos cofrinhos da conta. */
export function reservedByAccount(pockets: Pocket[], movements: PocketMovement[]): Map<ID, Cents> {
  const balances = pocketBalances(movements);
  const map = new Map<ID, Cents>();
  for (const p of pockets) map.set(p.accountId, (map.get(p.accountId) ?? 0) + (balances.get(p.id) ?? 0));
  return map;
}

export const accountReservedOf = (pockets: Pocket[], movements: PocketMovement[], accountId: ID): Cents =>
  reservedByAccount(pockets, movements).get(accountId) ?? 0;

/** Saldo livre = saldo bancário − reservado (pode ser negativo numa conta no vermelho). */
export const freeCents = (balanceCents: Cents, reservedCents: Cents): Cents => balanceCents - reservedCents;

export interface BackingShortfall {
  accountId: ID;
  shortfallCents: Cents;
  reservedCents: Cents;
  balanceCents: Cents;
}

/**
 * REGRA DE LASTRO sobre uma mudança em movimentações (equivalente ao trigger z_reserve_backing do banco): só confere as
 * contas cujo saldo DIMINUIU com a mudança e que têm reserva > 0. Receitas/melhorias nunca são bloqueadas.
 */
export function backingShortfall(input: {
  accounts: Account[];
  pockets: Pocket[];
  movements: PocketMovement[];
  before: Transaction[];
  after: Transaction[];
  /** Contas tocadas pela mudança. */
  touched: ID[];
}): BackingShortfall | null {
  const reserved = reservedByAccount(input.pockets, input.movements);
  for (const accountId of new Set(input.touched)) {
    const account = input.accounts.find((a) => a.id === accountId);
    const reservedCents = reserved.get(accountId) ?? 0;
    if (!account || reservedCents <= 0) continue;
    const balanceBefore = accountBalance(account, input.before);
    const balanceAfter = accountBalance(account, input.after);
    if (balanceAfter < balanceBefore && balanceAfter < reservedCents) {
      return { accountId, shortfallCents: reservedCents - balanceAfter, reservedCents, balanceCents: balanceAfter };
    }
  }
  return null;
}

/** Despesa que usou dinheiro de um cofrinho (derivada dos movimentos `use` / `use_reversal`). */
export interface PocketUse {
  transactionId: ID;
  pocketId: ID;
  /** Quanto saiu da reserva (pode ser menos que a despesa: uso parcial). */
  amountCents: Cents;
  reversed: boolean;
}

export function pocketUses(movements: PocketMovement[]): Map<ID, PocketUse> {
  const reversedIds = new Set(movements.filter((m) => m.kind === "use_reversal" && m.reversesId).map((m) => m.reversesId as ID));
  const map = new Map<ID, PocketUse>();
  for (const m of movements) {
    if (m.kind !== "use" || !m.transactionId) continue;
    map.set(m.transactionId, { transactionId: m.transactionId, pocketId: m.pocketId, amountCents: m.amountCents, reversed: reversedIds.has(m.id) });
  }
  return map;
}

export type GoalProgressSource = "pocket" | "manual";

export interface GoalProgress {
  /** "pocket" = dinheiro efetivamente reservado; "manual" = valor informado (não comprovado). */
  source: GoalProgressSource;
  currentCents: Cents;
  remainingCents: Cents;
  /** 0 a 100 (duas casas). */
  percent: number;
  reached: boolean;
}

/**
 * Progresso do objetivo: ligado a cofrinho = saldo REAL do cofrinho; sem cofrinho = valor informado à mão.
 * O manual NÃO é dinheiro reservado: nunca entra em reservado, disponível nem patrimônio.
 */
export function goalProgress(goal: Goal, balances: Map<ID, Cents>): GoalProgress {
  const source: GoalProgressSource = goal.pocketId ? "pocket" : "manual";
  const raw = goal.pocketId ? (balances.get(goal.pocketId) ?? 0) : goal.manualAmountCents;
  const currentCents = Math.max(0, raw);
  const remainingCents = Math.max(0, goal.targetCents - currentCents);
  const percent = goal.targetCents > 0 ? Math.min(100, Math.round((currentCents / goal.targetCents) * 10000) / 100) : 0;
  return { source, currentCents, remainingCents, percent, reached: currentCents >= goal.targetCents };
}
