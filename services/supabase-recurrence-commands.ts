import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecurringTransaction } from "@/domain/types";
import { toFriendlyError } from "@/repositories/supabase/errors";
import {
  type RecurrenceCommands,
  type RecurrenceInput,
  type RecurrencePatch,
  type RecurrenceUpdateOptions,
  type SyncResult,
} from "./recurrence-commands";

type Counts = Partial<Record<keyof SyncResult | "updated" | "id", unknown>>;

const toSync = (c: Counts | null): SyncResult => ({
  created: Number(c?.created ?? 0),
  revived: Number(c?.revived ?? 0),
  canceled: Number(c?.canceled ?? 0),
  promoted: Number(c?.promoted ?? 0),
});

/**
 * Comandos de recorrência sobre o Supabase: cada operação é UMA RPC atômica (SECURITY INVOKER, com RLS).
 * O cliente não faz sequência de inserts/updates: criar, editar daqui para frente, pausar e sincronizar acontecem
 * dentro do banco, onde a geração é idempotente (índice único (recurring_transaction_id, occurrence_date)).
 */
export class SupabaseRecurrenceCommands implements RecurrenceCommands {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc(fn: string, args: Record<string, unknown>): Promise<Counts> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw toFriendlyError(error);
    return (data ?? {}) as Counts;
  }

  async create(input: RecurrenceInput) {
    const result = await this.rpc("create_recurring_transaction", {
      p_kind: input.kind,
      p_description: input.description,
      p_amount_cents: input.amountCents,
      p_profile_id: input.profileId,
      p_frequency: input.frequency,
      p_start_date: input.startDate,
      p_category_id: input.categoryId,
      p_interval: input.interval,
      p_end_date: input.endDate || undefined,
      p_account_id: input.accountId || undefined,
      p_card_id: input.cardId || undefined,
      p_notes: input.notes,
      p_tags: input.tags,
    });
    return { id: String(result.id), ...toSync(result) };
  }

  async update(rule: RecurringTransaction, patch: RecurrencePatch, options: RecurrenceUpdateOptions = {}) {
    // undefined no domínio = limpar (NULL); JSON.stringify descartaria a chave.
    const body: Record<string, unknown> = {};
    if ("description" in patch) body.description = patch.description;
    if ("amountCents" in patch) body.amount_cents = patch.amountCents;
    if ("profileId" in patch) body.profile_id = patch.profileId;
    if ("accountId" in patch) body.account_id = patch.accountId || null;
    if ("cardId" in patch) body.card_id = patch.cardId || null;
    if ("categoryId" in patch) body.category_id = patch.categoryId;
    if ("notes" in patch) body.notes = patch.notes ?? null;
    if ("frequency" in patch) body.frequency = patch.frequency;
    if ("interval" in patch) body.interval_count = patch.interval;
    if ("startDate" in patch) body.start_date = patch.startDate;
    if ("endDate" in patch) body.end_date = patch.endDate || null;
    const result = await this.rpc("update_recurring_transaction", {
      p_id: rule.id,
      p_patch: body,
      p_tags: "tags" in patch ? (patch.tags ?? []) : undefined,
      p_apply_to_future: options.applyToFuture ?? true,
    });
    return { updated: Number(result.updated ?? 0), ...toSync(result) };
  }

  async setActive(rule: RecurringTransaction, active: boolean) {
    return toSync(await this.rpc("set_recurring_transaction_active", { p_id: rule.id, p_active: active }));
  }

  async sync() {
    return toSync(await this.rpc("sync_recurring_transactions", {}));
  }
}
