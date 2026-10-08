import type { SupabaseClient } from "@supabase/supabase-js";
import type { Debt, DebtStatus } from "@/domain/types";
import { toFriendlyError } from "@/repositories/supabase/errors";
import type { DebtCommands, DebtInput, DebtPatch, DebtPaymentInput, SettleResult } from "./debt-commands";

/**
 * Comandos de dívida sobre o Supabase: cada operação financeira é UMA RPC atômica (SECURITY INVOKER, com RLS).
 * Pagar e quitar criam a transação e validam o saldo devido NO MESMO comando, com a dívida travada: ou tudo, ou nada.
 * O cliente não calcula pago/restante nem faz sequência de escritas.
 */
export class SupabaseDebtCommands implements DebtCommands {
  constructor(private readonly client: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw toFriendlyError(error);
    return data as T;
  }

  async create(input: DebtInput) {
    return this.rpc<string>("create_debt", {
      p_name: input.name,
      p_principal_cents: input.principalCents,
      p_total_cents: input.totalCents,
      p_profile_id: input.profileId,
      p_kind: input.kind,
      p_creditor: input.creditor,
      p_notes: input.notes,
      p_installments: input.installments || undefined,
      p_first_due_date: input.firstDueDate || undefined,
      p_payment_account_id: input.paymentAccountId || undefined,
      p_category_id: input.categoryId || undefined,
    });
  }

  async update(debt: Debt, patch: DebtPatch) {
    // undefined no domínio = limpar (NULL); JSON.stringify descartaria a chave.
    const body: Record<string, unknown> = {};
    if ("name" in patch) body.name = patch.name;
    if ("creditor" in patch) body.creditor = patch.creditor ?? null;
    if ("kind" in patch) body.kind = patch.kind;
    if ("notes" in patch) body.notes = patch.notes ?? null;
    if ("profileId" in patch) body.profile_id = patch.profileId;
    if ("categoryId" in patch) body.category_id = patch.categoryId || null;
    if ("paymentAccountId" in patch) body.payment_account_id = patch.paymentAccountId || null;
    if ("principalCents" in patch) body.principal_cents = patch.principalCents;
    if ("totalCents" in patch) body.total_cents = patch.totalCents;
    if ("installments" in patch) body.installments_count = patch.installments || null;
    if ("firstDueDate" in patch) body.first_due_date = patch.firstDueDate || null;
    await this.rpc<null>("update_debt", { p_id: debt.id, p_patch: body });
  }

  pay(input: DebtPaymentInput) {
    return this.rpc<string>("pay_debt", {
      p_debt_id: input.debtId,
      p_account_id: input.accountId,
      p_amount_cents: input.amountCents,
      p_date: input.date,
    });
  }

  async settle(input: DebtPaymentInput): Promise<SettleResult> {
    const r = await this.rpc<{ projected_cents: number; paid_cents: number; discount_cents: number }>("settle_debt", {
      p_debt_id: input.debtId,
      p_account_id: input.accountId,
      p_amount_cents: input.amountCents,
      p_date: input.date,
    });
    return { projectedCents: Number(r.projected_cents), paidCents: Number(r.paid_cents), discountCents: Number(r.discount_cents) };
  }

  async setStatus(debt: Debt, status: DebtStatus) {
    await this.rpc<null>("set_debt_status", { p_id: debt.id, p_status: status });
  }

  async reopen(debt: Debt) {
    await this.rpc<null>("reopen_debt", { p_id: debt.id });
  }
}
