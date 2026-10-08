import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invoice } from "@/domain/calculations";
import type { DebtInstallment, DebtSummary } from "@/domain/debts";
import type { FinanceSnapshot } from "@/domain/snapshot";
import type { FinanceReader } from "../types";
import { toFriendlyError } from "./errors";

type Row = Record<string, unknown>;

/**
 * Valores derivados vindos das VIEWS do banco (security_invoker: o RLS de quem consulta vale):
 *  - v_account_balances ....... saldo atual por conta (saldo inicial + movimentações pagas);
 *  - v_card_invoice_totals .... compras, pagamentos e valor em aberto por fatura;
 *  - v_card_usage ............. limite utilizado/disponível por cartão (fuso do household).
 * O navegador não recalcula o histórico. As faturas são poucas (cartões x meses), então vêm todas.
 */
export class SupabaseFinanceReader implements FinanceReader {
  constructor(private readonly client: SupabaseClient) {}

  async snapshot(): Promise<FinanceSnapshot> {
    const [balances, invoices, usage, debtSummary, debtInst, pocketBal, reserves] = await Promise.all([
      this.client.from("v_account_balances").select("account_id, balance_cents"),
      this.client
        .from("v_card_invoice_totals")
        .select("card_id, due_month, due_date, closing_date, total_cents, paid_cents, open_cents, is_paid")
        .order("due_month", { ascending: true }),
      this.client.from("v_card_usage").select("card_id, used_cents"),
      this.client.from("v_debt_summary").select("*"),
      this.client.from("v_debt_installments").select("*").order("debt_id").order("number"),
      this.client.from("v_pocket_balances").select("pocket_id, balance_cents"),
      this.client.from("v_account_reserves").select("account_id, reserved_cents"),
    ]);
    for (const result of [balances, invoices, usage, debtSummary, debtInst, pocketBal, reserves]) if (result.error) throw toFriendlyError(result.error);

    return {
      accountBalances: new Map((balances.data as Row[]).map((r) => [r.account_id as string, Number(r.balance_cents)])),
      pocketBalances: new Map((pocketBal.data as Row[]).map((r) => [r.pocket_id as string, Number(r.balance_cents)])),
      accountReserved: new Map((reserves.data as Row[]).map((r) => [r.account_id as string, Number(r.reserved_cents)])),
      invoices: (invoices.data as Row[]).map(
        (r): Invoice => ({
          cardId: r.card_id as string,
          dueMonth: (r.due_month as string).slice(0, 7),
          dueDate: r.due_date as string,
          closingDate: r.closing_date as string,
          totalCents: Number(r.total_cents),
          paidCents: Number(r.paid_cents),
          openCents: Number(r.open_cents),
          paid: r.is_paid === true,
        }),
      ),
      usedLimits: new Map((usage.data as Row[]).map((r) => [r.card_id as string, Number(r.used_cents)])),
      debts: (debtSummary.data as Row[]).map(
        (r): DebtSummary => ({
          debtId: r.debt_id as string,
          principalCents: Number(r.principal_cents),
          totalCents: Number(r.total_cents),
          paidCents: Number(r.paid_cents),
          remainingCents: Number(r.remaining_cents),
          financialCostCents: Number(r.financial_cost_cents),
          progressPercent: Number(r.progress_percent),
          installmentsCount: r.installments_count == null ? null : Number(r.installments_count),
          installmentsPaid: Number(r.installments_paid),
          installmentsOpen: Number(r.installments_open),
          nextDueDate: (r.next_due_date as string | null) ?? undefined,
          nextOpenCents: r.next_open_cents == null ? undefined : Number(r.next_open_cents),
          paymentsCount: Number(r.payments_count),
          settledAt: (r.settled_at as string | null) ?? undefined,
          settlementDiscountCents: r.settlement_discount_cents == null ? undefined : Number(r.settlement_discount_cents),
          status: r.derived_status as DebtSummary["status"],
        }),
      ),
      debtInstallments: (debtInst.data as Row[]).map(
        (r): DebtInstallment => ({
          debtId: r.debt_id as string,
          number: Number(r.number),
          dueDate: r.due_date as string,
          amountCents: Number(r.amount_cents),
          paidCents: Number(r.paid_cents),
          openCents: Number(r.open_cents),
          status: r.status as DebtInstallment["status"],
          overdue: r.is_overdue === true,
        }),
      ),
    };
  }

  async tags(): Promise<string[]> {
    const { data, error } = await this.client.from("tags").select("name").order("name", { ascending: true });
    if (error) throw toFriendlyError(error);
    return (data as Row[]).map((r) => r.name as string);
  }
}
