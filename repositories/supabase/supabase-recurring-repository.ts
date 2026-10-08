import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecurringTransaction } from "@/domain/types";
import type { RecurringRepository } from "../types";
import { toFriendlyError } from "./errors";

type Row = Record<string, unknown>;

const orUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

/** Linha do banco -> template de domínio. Dinheiro em centavos; datas ISO. */
export function recurringFromRow(row: Row): RecurringTransaction {
  return {
    id: row.id as string,
    kind: row.kind as RecurringTransaction["kind"],
    description: row.description as string,
    amountCents: Number(row.amount_cents),
    profileId: row.profile_id as string,
    accountId: orUndefined(row.account_id as string | null),
    cardId: orUndefined(row.card_id as string | null),
    categoryId: row.category_id as string,
    tags: (row.tags as string[] | null) ?? [],
    notes: orUndefined(row.notes as string | null),
    frequency: row.frequency as RecurringTransaction["frequency"],
    interval: Number(row.interval_count),
    startDate: row.start_date as string,
    endDate: orUndefined(row.end_date as string | null),
    materializeFrom: row.materialize_from as string,
    active: row.is_active === true,
  };
}

/**
 * LEITURA dos templates de recorrência (RLS: só o household do usuário). São poucos por household, então vêm todos.
 * ESCRITAS ficam em SupabaseRecurrenceCommands (RPCs atômicas); o template nunca é excluído pelo cliente.
 */
export class SupabaseRecurringRepository implements RecurringRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<RecurringTransaction[]> {
    const { data, error } = await this.client
      .from("recurring_transactions")
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw toFriendlyError(error);
    return (data as Row[]).map(recurringFromRow);
  }

  async get(id: string): Promise<RecurringTransaction | undefined> {
    const { data, error } = await this.client.from("recurring_transactions").select("*").eq("id", id).maybeSingle();
    if (error) throw toFriendlyError(error);
    return data ? recurringFromRow(data as Row) : undefined;
  }
}
