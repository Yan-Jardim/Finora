import { debtPaid } from "@/domain/debts";
import type { Debt, DebtStatus, Transaction } from "@/domain/types";
import { friendlyDbMessage } from "@/repositories/supabase/errors";
import type { Repository } from "@/repositories/types";
import type { DebtCommands, DebtContext, DebtInput, DebtPatch, DebtPaymentInput, SettleResult } from "./debt-commands";
import { assertBacked, type ReserveGuardRepos } from "./reserve-guard";

/**
 * MOTOR LOCAL de dívidas (localStorage): mesmas regras e mesmas mensagens do banco. Os pagamentos são transações
 * (debt_payment, paga, com debtId); pago/restante/progresso são derivados delas (domain/debts.ts) — nunca gravados.
 */
export interface DebtRepos extends ReserveGuardRepos {
  debts: Repository<Debt>;
  transactions: Repository<Transaction>;
}

const fail = (code: string): never => {
  throw new Error(friendlyDbMessage({ message: code }));
};

const label = (prefix: string, name: string) => `${prefix} — ${name}`.slice(0, 80);

function validate(draft: Omit<Debt, "id">) {
  if (!draft.name.trim()) throw new Error("Informe o nome da dívida.");
  if (!(draft.principalCents > 0)) throw new Error("Informe quanto recebeu/deve.");
  if (!(draft.totalCents > 0)) throw new Error("Informe quanto vai pagar no total.");
  if (draft.totalCents < draft.principalCents) throw new Error("O total a pagar não pode ser menor que o valor original.");
  if (!!draft.installments !== !!draft.firstDueDate || (draft.installments !== undefined && (draft.installments < 1 || draft.installments > 120))) {
    fail("invalid_installments");
  }
}

export class LocalDebtCommands implements DebtCommands {
  constructor(
    private readonly repos: DebtRepos,
    private readonly ctx: DebtContext,
  ) {}

  private async load(id: string) {
    return (await this.repos.debts.get(id)) ?? fail("debt_not_found");
  }

  private async paidOf(debtId: string) {
    return debtPaid(debtId, await this.repos.transactions.list()).cents;
  }

  async create(input: DebtInput) {
    const draft: Omit<Debt, "id"> = {
      name: input.name.trim(),
      creditor: input.creditor?.trim() || undefined,
      kind: input.kind,
      profileId: input.profileId,
      notes: input.notes?.trim() || undefined,
      principalCents: input.principalCents,
      totalCents: input.totalCents,
      installments: input.installments || undefined,
      firstDueDate: input.firstDueDate || undefined,
      paymentAccountId: input.paymentAccountId || undefined,
      categoryId: input.categoryId || undefined,
      status: "active",
    };
    validate(draft);
    return (await this.repos.debts.create(draft)).id;
  }

  async update(debt: Debt, patch: DebtPatch) {
    const current = await this.load(debt.id);
    const money = ["principalCents", "totalCents", "installments", "firstDueDate"].some((k) => k in patch);
    if (money && current.settledAt) fail("debt_settled_locked");
    const next: Debt = {
      ...current,
      ...patch,
      name: "name" in patch ? (patch.name ?? "").trim() : current.name,
      creditor: "creditor" in patch ? patch.creditor?.trim() || undefined : current.creditor,
      notes: "notes" in patch ? patch.notes?.trim() || undefined : current.notes,
      installments: "installments" in patch ? patch.installments || undefined : current.installments,
      firstDueDate: "firstDueDate" in patch ? patch.firstDueDate || undefined : current.firstDueDate,
      paymentAccountId: "paymentAccountId" in patch ? patch.paymentAccountId || undefined : current.paymentAccountId,
      categoryId: "categoryId" in patch ? patch.categoryId || undefined : current.categoryId,
    };
    if (next.totalCents < (await this.paidOf(debt.id))) fail("total_below_paid");
    const { id, ...draft } = next;
    void id;
    validate(draft);
    await this.repos.debts.update(debt.id, draft);
  }

  private async register(input: DebtPaymentInput, debt: Debt, prefix: string) {
    const payment: Omit<Transaction, "id"> = {
      kind: "debt_payment",
      description: label(prefix, debt.name),
      amountCents: input.amountCents,
      date: input.date,
      paidAt: input.date,
      status: "paid",
      categoryId: debt.categoryId,
      tags: [],
      accountId: input.accountId,
      profileId: debt.profileId,
      debtId: debt.id,
    };
    // Lastro dos cofrinhos: pagar dívida não pode deixar reserva sem saldo (o app NÃO libera a reserva sozinho).
    await assertBacked(this.repos, { after: { ...payment, id: "novo" } });
    const tx = await this.repos.transactions.create(payment);
    return tx.id;
  }

  async pay(input: DebtPaymentInput) {
    const debt = await this.load(input.debtId);
    if (debt.status === "canceled") fail("debt_canceled");
    if (debt.settledAt) fail("debt_settled_locked");
    if (!(input.amountCents > 0)) fail("invalid_amount");
    const remaining = debt.totalCents - (await this.paidOf(debt.id));
    if (remaining <= 0) fail("debt_already_paid");
    if (input.amountCents > remaining) fail("payment_exceeds_remaining");
    return this.register(input, debt, "Pagamento");
  }

  async settle(input: DebtPaymentInput): Promise<SettleResult> {
    const debt = await this.load(input.debtId);
    if (debt.status === "canceled") fail("debt_canceled");
    if (debt.settledAt) fail("debt_settled_locked");
    if (!(input.amountCents >= 0)) fail("invalid_amount");
    const projected = debt.totalCents - (await this.paidOf(debt.id));
    if (projected <= 0) fail("debt_already_paid");
    if (input.amountCents > projected) fail("payment_exceeds_remaining");
    if (input.amountCents > 0) await this.register(input, debt, "Quitação");
    await this.repos.debts.update(debt.id, { settledAt: input.date, settlementDiscountCents: projected - input.amountCents });
    return { projectedCents: projected, paidCents: input.amountCents, discountCents: projected - input.amountCents };
  }

  async setStatus(debt: Debt, status: DebtStatus) {
    const current = await this.load(debt.id);
    if (current.settledAt) fail("debt_settled_locked");
    if (status === "canceled") {
      const hasPayments = (await this.repos.transactions.list()).some((t) => t.debtId === debt.id && t.kind === "debt_payment");
      if (hasPayments) fail("debt_has_payments");
    }
    await this.repos.debts.update(debt.id, { status });
  }

  async reopen(debt: Debt) {
    const current = await this.load(debt.id);
    if (!current.settledAt) fail("debt_not_settled");
    await this.repos.debts.update(debt.id, { settledAt: undefined, settlementDiscountCents: undefined });
  }
}
