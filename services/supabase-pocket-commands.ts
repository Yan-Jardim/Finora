import type { SupabaseClient } from "@supabase/supabase-js";
import { toFriendlyError } from "@/repositories/supabase/errors";
import type {
  PocketAmountInput,
  PocketCommands,
  PocketInput,
  PocketPatch,
  PocketSpendInput,
  PocketSpendResult,
  PocketTransferInput,
} from "./pocket-commands";

/**
 * Comandos de cofrinho sobre o Supabase: cada operação financeira é UMA RPC atômica (SECURITY INVOKER, com RLS). O
 * frontend NÃO replica o que o banco garante (lastro, travas, atomicidade da despesa + uso, estorno): só chama a RPC e
 * traduz o erro. Nenhuma RPC recebe household_id (o banco o deriva do cofrinho/perfil/transação/objetivo).
 */
export class SupabasePocketCommands implements PocketCommands {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw toFriendlyError(error);
    return data as T;
  }

  create(input: PocketInput) {
    return this.rpc<string>("create_pocket", {
      p_profile_id: input.profileId,
      p_account_id: input.accountId,
      p_name: input.name,
      p_description: input.description || undefined,
      p_icon: input.icon || undefined,
      p_color: input.color || undefined,
      p_initial_cents: input.initialCents ?? 0,
      p_date: input.date || undefined,
      p_legacy_ref: input.legacyRef || undefined,
    });
  }

  async update(pocketId: string, patch: PocketPatch) {
    // undefined no domínio = limpar (NULL); JSON.stringify descartaria a chave.
    const body: Record<string, unknown> = {};
    if ("name" in patch) body.name = patch.name;
    if ("description" in patch) body.description = patch.description ?? null;
    if ("icon" in patch) body.icon = patch.icon;
    if ("color" in patch) body.color = patch.color;
    if ("profileId" in patch) body.profile_id = patch.profileId;
    await this.rpc<null>("update_pocket", { p_id: pocketId, p_patch: body });
  }

  async setArchived(pocketId: string, archived: boolean) {
    await this.rpc<null>("set_pocket_archived", { p_id: pocketId, p_archived: archived });
  }

  reserve(input: PocketAmountInput) {
    return this.rpc<string>("pocket_reserve", {
      p_pocket_id: input.pocketId,
      p_amount_cents: input.amountCents,
      p_date: input.date || undefined,
      p_note: input.note || undefined,
    });
  }

  withdraw(input: PocketAmountInput) {
    return this.rpc<string>("pocket_withdraw", {
      p_pocket_id: input.pocketId,
      p_amount_cents: input.amountCents,
      p_date: input.date || undefined,
      p_note: input.note || undefined,
    });
  }

  transfer(input: PocketTransferInput) {
    return this.rpc<string>("pocket_transfer", {
      p_from_pocket_id: input.fromPocketId,
      p_to_pocket_id: input.toPocketId,
      p_amount_cents: input.amountCents,
      p_date: input.date || undefined,
      p_note: input.note || undefined,
    });
  }

  async spend(input: PocketSpendInput): Promise<PocketSpendResult> {
    const r = await this.rpc<{ transaction_id: string; movement_id: string; from_pocket_cents: number; from_account_cents: number }>("spend_from_pocket", {
      p_pocket_id: input.pocketId,
      p_description: input.description,
      p_amount_cents: input.amountCents,
      p_amount_from_pocket: input.amountFromPocketCents ?? undefined,
      p_date: input.date || undefined,
      p_category_id: input.categoryId || undefined,
      p_profile_id: input.profileId || undefined,
      p_notes: input.notes || undefined,
      p_tags: input.tags ?? [],
    });
    return {
      transactionId: r.transaction_id,
      movementId: r.movement_id,
      fromPocketCents: Number(r.from_pocket_cents),
      fromAccountCents: Number(r.from_account_cents),
    };
  }

  reverseUse(transactionId: string, note?: string) {
    return this.rpc<string>("reverse_pocket_use", { p_transaction_id: transactionId, p_note: note || undefined });
  }

  async linkGoal(goalId: string, pocketId: string | null) {
    await this.rpc<null>("link_goal_pocket", { p_goal_id: goalId, p_pocket_id: pocketId });
  }
}
