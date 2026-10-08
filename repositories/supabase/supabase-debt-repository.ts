import type { SupabaseClient } from "@supabase/supabase-js";
import type { Debt } from "@/domain/types";
import type { DebtRepository } from "../types";
import { toFriendlyError } from "./errors";

type Row = Record<string, unknown>;

const orUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

/** Linha do banco -> dívida de domínio. Dinheiro em centavos; datas ISO. */
export function debtFromRow(row: Row): Debt {
  return {
    id: row.id as string,
    name: row.name as string,
    creditor: orUndefined(row.creditor as string | null),
    kind: row.kind as Debt["kind"],
    profileId: row.profile_id as string,
    notes: orUndefined(row.notes as string | null),
    principalCents: Number(row.principal_cents),
    totalCents: Number(row.total_cents),
    installments: row.installments_count == null ? undefined : Number(row.installments_count),
    firstDueDate: orUndefined(row.first_due_date as string | null),
    paymentAccountId: orUndefined(row.payment_account_id as string | null),
    categoryId: orUndefined(row.category_id as string | null),
    status: row.status as Debt["status"],
    settledAt: orUndefined(row.settled_at as string | null),
    settlementDiscountCents: row.settlement_discount_cents == null ? undefined : Number(row.settlement_discount_cents),
  };
}

/**
 * LEITURA das dívidas (RLS: só o household do usuário). Poucas por household: vêm todas. Valores derivados
 * (pago, restante, parcelas) vêm das VIEWS (SupabaseFinanceReader); escritas, das RPCs (SupabaseDebtCommands).
 */
export class SupabaseDebtRepository implements DebtRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<Debt[]> {
    const { data, error } = await this.client
      .from("debts")
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw toFriendlyError(error);
    return (data as Row[]).map(debtFromRow);
  }

  async get(id: string): Promise<Debt | undefined> {
    const { data, error } = await this.client.from("debts").select("*").eq("id", id).maybeSingle();
    if (error) throw toFriendlyError(error);
    return data ? debtFromRow(data as Row) : undefined;
  }
}
