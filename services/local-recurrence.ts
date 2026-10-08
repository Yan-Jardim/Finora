import { occurrenceStatus, planSync, MAX_RECURRENCE_INTERVAL } from "@/domain/recurrence";
import type { ISODate, RecurringTransaction, Transaction } from "@/domain/types";
import { normalizeTags } from "@/lib/tags";
import type { Repository } from "@/repositories/types";
import {
  EMPTY_SYNC,
  type RecurrenceCommands,
  type RecurrenceContext,
  type RecurrenceInput,
  type RecurrencePatch,
  type RecurrenceUpdateOptions,
  type SyncResult,
} from "./recurrence-commands";

/**
 * MOTOR LOCAL de recorrências: mesmas regras do banco (domain/recurrence.ts é o espelho de recurrence_dates e
 * sync_recurring), sobre localStorage. Serve ao modo demo, aos testes e de referência para os testes de paridade.
 */
export interface RecurrenceRepos {
  recurring: Repository<RecurringTransaction>;
  transactions: Repository<Transaction>;
}

const fail = (message: string): never => {
  throw new Error(message);
};

const max = (a: ISODate, b: ISODate) => (a > b ? a : b);

function validate(rule: Omit<RecurringTransaction, "id">) {
  if (!["income", "expense", "credit_card_purchase"].includes(rule.kind)) fail("Este tipo não pode ser recorrente.");
  if (!(rule.amountCents > 0)) fail("Informe um valor maior que zero.");
  if (!rule.categoryId) fail("Escolha a categoria.");
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > MAX_RECURRENCE_INTERVAL) {
    fail(`O intervalo deve ficar entre 1 e ${MAX_RECURRENCE_INTERVAL}.`);
  }
  if (rule.endDate && rule.endDate < rule.startDate) fail("A data final não pode ser anterior à data inicial.");
  if (rule.kind === "credit_card_purchase") {
    if (!rule.cardId || rule.accountId) fail("Compra recorrente no cartão usa só o cartão (sem conta).");
  } else if (!rule.accountId || rule.cardId) {
    fail("Receita e despesa recorrentes usam só a conta (sem cartão).");
  }
}

/** Sincroniza UMA regra (idempotente): reativa, cancela as fora da agenda, cria as que faltam, promove as que chegaram. */
export async function syncRule(repos: RecurrenceRepos, rule: RecurringTransaction, today: ISODate): Promise<SyncResult> {
  const plan = planSync(rule, await repos.transactions.list(), today);
  const promote = new Set(plan.promote);

  for (const id of plan.revive) {
    await repos.transactions.update(id, { status: promote.has(id) ? "pending" : "planned", canceledByRule: false });
  }
  for (const id of plan.cancel) await repos.transactions.update(id, { status: "canceled", canceledByRule: true });
  const created = await repos.transactions.createMany(
    plan.create.map<Omit<Transaction, "id">>((date) => ({
      kind: rule.kind,
      description: rule.description,
      amountCents: rule.amountCents,
      date,
      status: occurrenceStatus(date, today),
      categoryId: rule.categoryId,
      tags: [...rule.tags],
      accountId: rule.accountId,
      cardId: rule.cardId,
      profileId: rule.profileId,
      notes: rule.notes,
      recurringId: rule.id,
      occurrenceDate: date,
    })),
  );
  for (const id of plan.promote) if (!plan.revive.includes(id)) await repos.transactions.update(id, { status: "pending" });

  return { created: created.length, revived: plan.revive.length, canceled: plan.cancel.length, promoted: plan.promote.length };
}

/** Excluir uma ocorrência gerada = "pular": a regra não a recria (no banco: recurring_skips, via trigger). */
export async function recordSkip(repos: Pick<RecurrenceRepos, "recurring">, tx: Transaction) {
  if (!tx.recurringId || !tx.occurrenceDate) return;
  const rule = await repos.recurring.get(tx.recurringId);
  if (!rule) return;
  const skipped = new Set(rule.skippedDates ?? []);
  skipped.add(tx.occurrenceDate);
  await repos.recurring.update(rule.id, { skippedDates: [...skipped].sort() });
}

const sum = (a: SyncResult, b: SyncResult): SyncResult => ({
  created: a.created + b.created,
  revived: a.revived + b.revived,
  canceled: a.canceled + b.canceled,
  promoted: a.promoted + b.promoted,
});

export class LocalRecurrenceCommands implements RecurrenceCommands {
  constructor(
    private readonly repos: RecurrenceRepos,
    private readonly ctx: RecurrenceContext,
  ) {}

  async create(input: RecurrenceInput) {
    const today = this.ctx.today();
    const draft: Omit<RecurringTransaction, "id"> = {
      kind: input.kind,
      description: input.description.trim(),
      amountCents: input.amountCents,
      profileId: input.profileId,
      accountId: input.accountId || undefined,
      cardId: input.cardId || undefined,
      categoryId: input.categoryId,
      tags: normalizeTags(input.tags),
      notes: input.notes?.trim() || undefined,
      frequency: input.frequency,
      interval: input.interval,
      startDate: input.startDate,
      endDate: input.endDate || undefined,
      materializeFrom: max(input.startDate, today),
      active: true,
      skippedDates: [],
    };
    validate(draft);
    const rule = await this.repos.recurring.create(draft);
    return { id: rule.id, ...(await syncRule(this.repos, rule, today)) };
  }

  async update(rule: RecurringTransaction, patch: RecurrencePatch, options: RecurrenceUpdateOptions = {}) {
    const today = this.ctx.today();
    const current = (await this.repos.recurring.get(rule.id)) ?? fail("Recorrência não encontrada.");
    const scheduleChanged = "frequency" in patch || "interval" in patch || "startDate" in patch;
    const next: RecurringTransaction = {
      ...current,
      ...patch,
      accountId: "accountId" in patch ? patch.accountId || undefined : current.accountId,
      cardId: "cardId" in patch ? patch.cardId || undefined : current.cardId,
      notes: "notes" in patch ? patch.notes?.trim() || undefined : current.notes,
      endDate: "endDate" in patch ? patch.endDate || undefined : current.endDate,
      description: "description" in patch ? (patch.description ?? "").trim() : current.description,
      tags: "tags" in patch ? normalizeTags(patch.tags ?? []) : current.tags,
      materializeFrom: scheduleChanged ? max("startDate" in patch ? (patch.startDate as ISODate) : current.startDate, today) : current.materializeFrom,
    };
    const { id, ...draft } = next;
    void id;
    validate(draft);
    const saved = await this.repos.recurring.update(rule.id, draft);

    let updated = 0;
    if (options.applyToFuture ?? true) {
      const targets = (await this.repos.transactions.list()).filter(
        (t) => t.recurringId === rule.id && (t.status === "planned" || t.status === "pending") && !!t.occurrenceDate && t.occurrenceDate >= today,
      );
      for (const t of targets) {
        await this.repos.transactions.update(t.id, {
          description: saved.description,
          amountCents: saved.amountCents,
          profileId: saved.profileId,
          accountId: saved.accountId,
          cardId: saved.cardId,
          categoryId: saved.categoryId,
          notes: saved.notes,
          ...("tags" in patch ? { tags: [...saved.tags] } : {}),
        });
      }
      updated = targets.length;
    }
    return { updated, ...(await syncRule(this.repos, saved, today)) };
  }

  async setActive(rule: RecurringTransaction, active: boolean) {
    const today = this.ctx.today();
    const current = (await this.repos.recurring.get(rule.id)) ?? fail("Recorrência não encontrada.");
    const saved = await this.repos.recurring.update(rule.id, {
      active,
      materializeFrom: active ? max(current.materializeFrom, today) : current.materializeFrom,
    });
    return syncRule(this.repos, saved, today);
  }

  async sync() {
    const today = this.ctx.today();
    let total = EMPTY_SYNC;
    for (const rule of await this.repos.recurring.list()) total = sum(total, await syncRule(this.repos, rule, today));
    return total;
  }
}
