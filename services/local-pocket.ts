import { accountBalance } from "@/domain/calculations";
import { pocketBalances, reservedByAccount } from "@/domain/pockets";
import type { Account, FinancialProfile, Goal, ID, ISODate, Pocket, PocketMovement, PocketMovementKind, Transaction } from "@/domain/types";
import { AppError, appError, friendlyDbMessage } from "@/repositories/supabase/errors";
import type { Repository } from "@/repositories/types";
import type {
  PocketAmountInput,
  PocketCommands,
  PocketContext,
  PocketInput,
  PocketPatch,
  PocketSpendInput,
  PocketSpendResult,
  PocketTransferInput,
} from "./pocket-commands";

/**
 * MOTOR LOCAL de cofrinhos (localStorage): as MESMAS regras e as MESMAS mensagens/códigos de erro das RPCs do banco.
 * Saldo de cofrinho e reservado por conta são DERIVADOS do histórico (nada é gravado); toda operação valida antes de gravar,
 * então uma falha nunca deixa meia operação (o equivalente local da atomicidade da RPC).
 */
export interface PocketRepos {
  pockets: Repository<Pocket>;
  pocketMovements: Repository<PocketMovement>;
  goals: Repository<Goal>;
  accounts: Repository<Account>;
  profiles: Repository<FinancialProfile>;
  transactions: Repository<Transaction>;
}

const NAME_MAX = 60;
const nameError = () => new AppError(friendlyDbMessage({ code: "23514", message: "pockets_name_check" }), "pockets_name_check");
const isConsumption = (a: Account) => a.active && a.type !== "investment";

export class LocalPocketCommands implements PocketCommands {
  constructor(
    private readonly repos: PocketRepos,
    private readonly ctx: PocketContext,
  ) {}

  private async state() {
    const [pockets, movements, accounts, transactions] = await Promise.all([
      this.repos.pockets.list(),
      this.repos.pocketMovements.list(),
      this.repos.accounts.list(),
      this.repos.transactions.list(),
    ]);
    return { pockets, movements, accounts, transactions, balances: pocketBalances(movements), reserved: reservedByAccount(pockets, movements) };
  }

  private freeOf(s: Awaited<ReturnType<LocalPocketCommands["state"]>>, accountId: ID) {
    const account = s.accounts.find((a) => a.id === accountId);
    return (account ? accountBalance(account, s.transactions) : 0) - (s.reserved.get(accountId) ?? 0);
  }

  private pocketOf(s: { pockets: Pocket[] }, id: ID): Pocket {
    const pocket = s.pockets.find((p) => p.id === id);
    if (!pocket) throw appError("pocket_not_found");
    return pocket;
  }

  /** Mesmas verificações, na mesma ordem, de private.pocket_write + gatilhos de validação. */
  private check(s: Awaited<ReturnType<LocalPocketCommands["state"]>>, pocket: Pocket, kind: PocketMovementKind, amount: number, date: ISODate) {
    if (!(amount > 0)) throw appError("invalid_amount");
    if (pocket.status === "archived") throw appError("pocket_archived");
    if (kind === "reserve") {
      const free = this.freeOf(s, pocket.accountId);
      if (amount > free) {
        throw appError("insufficient_free", { account_id: pocket.accountId, free_cents: free, requested_cents: amount, shortfall_cents: amount - free });
      }
    } else if (kind === "withdraw" || kind === "transfer_out" || kind === "use") {
      const balance = s.balances.get(pocket.id) ?? 0;
      if (balance < amount) {
        throw appError("insufficient_pocket", { pocket_id: pocket.id, balance_cents: balance, requested_cents: amount, shortfall_cents: amount - balance });
      }
    }
    if (date > this.ctx.today()) throw appError("future_date");
  }

  private append(pocketId: ID, kind: PocketMovementKind, amountCents: number, date: ISODate, extra: Partial<PocketMovement> = {}) {
    return this.repos.pocketMovements.create({
      pocketId,
      kind,
      amountCents,
      date,
      createdAt: new Date().toISOString(),
      ...extra,
    });
  }

  private async write(pocketId: ID, kind: PocketMovementKind, amountCents: number, date: ISODate | undefined, note?: string) {
    const s = await this.state();
    const pocket = this.pocketOf(s, pocketId);
    const when = date || this.ctx.today();
    this.check(s, pocket, kind, amountCents, when);
    return (await this.append(pocketId, kind, amountCents, when, { note: note?.trim() || undefined })).id;
  }

  async create(input: PocketInput) {
    const s = await this.state();
    if (!(await this.repos.profiles.get(input.profileId))) throw appError("profile_not_found");
    const initial = input.initialCents ?? 0;
    if (!(initial >= 0)) throw appError("invalid_amount");
    if (input.legacyRef) {
      const existing = s.pockets.find((p) => p.legacyRef === input.legacyRef);
      if (existing) return existing.id; // já importado: não repete a reserva inicial
    }
    const account = s.accounts.find((a) => a.id === input.accountId);
    if (!account || !isConsumption(account)) throw appError("account_not_allowed");
    const name = input.name.trim();
    if (name.length < 1 || name.length > NAME_MAX) throw nameError();
    const date = input.date || this.ctx.today();
    if (initial > 0) {
      const free = this.freeOf(s, account.id);
      if (initial > free) {
        throw appError("insufficient_free", { account_id: account.id, free_cents: free, requested_cents: initial, shortfall_cents: initial - free });
      }
      if (date > this.ctx.today()) throw appError("future_date");
    }
    const pocket = await this.repos.pockets.create({
      name,
      description: input.description?.trim() || undefined,
      icon: input.icon || "piggy-bank",
      color: input.color || "#4f46e5",
      profileId: input.profileId,
      accountId: input.accountId,
      status: "active",
      createdAt: new Date().toISOString(),
      legacyRef: input.legacyRef || undefined,
    });
    if (initial > 0) await this.append(pocket.id, "reserve", initial, date, { note: "Saldo inicial" });
    return pocket.id;
  }

  async update(pocketId: ID, patch: PocketPatch) {
    const pocket = this.pocketOf(await this.state(), pocketId);
    const next: Partial<Omit<Pocket, "id">> = {};
    if ("name" in patch) {
      const name = (patch.name ?? "").trim();
      if (name.length < 1 || name.length > NAME_MAX) throw nameError();
      next.name = name;
    }
    if ("description" in patch) next.description = patch.description?.trim() || undefined;
    if ("icon" in patch && patch.icon) next.icon = patch.icon;
    if ("color" in patch && patch.color) next.color = patch.color;
    if ("profileId" in patch && patch.profileId) {
      if (!(await this.repos.profiles.get(patch.profileId))) throw appError("profile_not_found");
      next.profileId = patch.profileId;
    }
    await this.repos.pockets.update(pocket.id, next);
  }

  async setArchived(pocketId: ID, archived: boolean) {
    const s = await this.state();
    const pocket = this.pocketOf(s, pocketId);
    if (archived && pocket.status === "active") {
      const balance = s.balances.get(pocket.id) ?? 0;
      if (balance !== 0) throw appError("pocket_has_balance", { pocket_id: pocket.id, balance_cents: balance });
    }
    if (!archived && pocket.status === "archived") {
      const account = s.accounts.find((a) => a.id === pocket.accountId);
      if (!account || !isConsumption(account)) throw appError("account_not_allowed");
    }
    await this.repos.pockets.update(pocket.id, { status: archived ? "archived" : "active" });
  }

  reserve(input: PocketAmountInput) {
    return this.write(input.pocketId, "reserve", input.amountCents, input.date, input.note);
  }

  withdraw(input: PocketAmountInput) {
    return this.write(input.pocketId, "withdraw", input.amountCents, input.date, input.note);
  }

  async transfer(input: PocketTransferInput) {
    const s = await this.state();
    const from = this.pocketOf(s, input.fromPocketId);
    const to = this.pocketOf(s, input.toPocketId);
    if (from.id === to.id) throw appError("same_pocket");
    if (from.accountId !== to.accountId) throw appError("different_accounts");
    const date = input.date || this.ctx.today();
    this.check(s, from, "transfer_out", input.amountCents, date);
    if (to.status === "archived") throw appError("pocket_archived");
    const group = crypto.randomUUID();
    const note = input.note?.trim() || undefined;
    await this.append(from.id, "transfer_out", input.amountCents, date, { transferGroupId: group, note });
    await this.append(to.id, "transfer_in", input.amountCents, date, { transferGroupId: group, note });
    return group;
  }

  async spend(input: PocketSpendInput): Promise<PocketSpendResult> {
    const s = await this.state();
    const pocket = this.pocketOf(s, input.pocketId);
    if (!(input.amountCents > 0)) throw appError("invalid_amount");
    const from = input.amountFromPocketCents ?? input.amountCents;
    if (from <= 0 || from > input.amountCents) throw appError("amount_from_pocket_invalid");
    if (!input.categoryId) throw appError("category_required");
    const date = input.date || this.ctx.today();
    if (date > this.ctx.today()) throw appError("future_date");

    this.check(s, pocket, "use", from, date);
    // Lastro sobre o resultado FINAL (despesa inteira sai do saldo; só a parte usada sai da reserva).
    const account = s.accounts.find((a) => a.id === pocket.accountId);
    const balanceAfter = (account ? accountBalance(account, s.transactions) : 0) - input.amountCents;
    const reservedAfter = (s.reserved.get(pocket.accountId) ?? 0) - from;
    if (input.amountCents > from && reservedAfter > 0 && balanceAfter < reservedAfter) {
      throw appError("reserve_shortfall", {
        account_id: pocket.accountId,
        shortfall_cents: reservedAfter - balanceAfter,
        reserved_cents: reservedAfter,
        balance_cents: balanceAfter,
      });
    }

    const tx = await this.repos.transactions.create({
      kind: "expense",
      description: input.description.trim(),
      amountCents: input.amountCents,
      date,
      paidAt: date,
      status: "paid",
      accountId: pocket.accountId,
      categoryId: input.categoryId,
      profileId: input.profileId || pocket.profileId,
      notes: input.notes?.trim() || undefined,
      tags: input.tags ?? [],
    });
    const movement = await this.append(pocket.id, "use", from, date, { transactionId: tx.id, note: input.description.trim().slice(0, 300) });
    return { transactionId: tx.id, movementId: movement.id, fromPocketCents: from, fromAccountCents: input.amountCents - from };
  }

  async reverseUse(transactionId: ID, note?: string) {
    const s = await this.state();
    const tx = s.transactions.find((t) => t.id === transactionId);
    if (!tx) throw appError("transaction_not_found");
    const use = s.movements.find((m) => m.kind === "use" && m.transactionId === transactionId);
    if (!use) throw appError("no_pocket_use");
    if (s.movements.some((m) => m.reversesId === use.id)) throw appError("already_reversed");
    const pocket = this.pocketOf(s, use.pocketId);
    if (pocket.status === "archived") throw appError("pocket_archived");
    // O estorno devolve SÓ o que o uso tirou; o cancelamento devolve a despesa INTEIRA ao saldo. Nada é apagado.
    const reversal = await this.append(pocket.id, "use_reversal", use.amountCents, this.ctx.today(), {
      transactionId,
      reversesId: use.id,
      note: note?.trim() || undefined,
    });
    await this.repos.transactions.update(transactionId, { status: "canceled", paidAt: undefined });
    return reversal.id;
  }

  async linkGoal(goalId: ID, pocketId: ID | null) {
    const goal = await this.repos.goals.get(goalId);
    if (!goal) throw appError("goal_not_found");
    if (pocketId === null) {
      await this.repos.goals.update(goalId, { pocketId: undefined });
      return;
    }
    if (!(await this.repos.pockets.get(pocketId))) throw appError("pocket_not_found");
    const taken = (await this.repos.goals.list()).some((g) => g.id !== goalId && g.pocketId === pocketId && g.status !== "canceled");
    if (taken) throw appError("pocket_already_linked");
    // Ligou: o valor informado à mão deixa de existir e NÃO volta ao desligar.
    await this.repos.goals.update(goalId, { pocketId, manualAmountCents: 0 });
  }
}
