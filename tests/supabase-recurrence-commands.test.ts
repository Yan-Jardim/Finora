import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { friendlyDbMessage } from "@/repositories/supabase/errors";
import { recurringFromRow } from "@/repositories/supabase/supabase-recurring-repository";
import { transactionFromRow } from "@/repositories/supabase/transaction-mappers";
import { SupabaseRecurrenceCommands } from "@/services/supabase-recurrence-commands";
import type { RecurringTransaction } from "@/domain/types";

function fake(result: { data?: unknown; error?: { code?: string; message: string } } = { data: {} }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: result.data ?? null, error: result.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const rule: RecurringTransaction = {
  id: "r1", kind: "expense", description: "Internet", amountCents: 12000, profileId: "p", accountId: "a", categoryId: "c", tags: [],
  frequency: "monthly", interval: 1, startDate: "2026-10-10", materializeFrom: "2026-10-10", active: true,
};

describe("SupabaseRecurrenceCommands — tudo por RPC atômica", () => {
  it("criar: UMA chamada create_recurring_transaction com o horizonte e a geração dentro do banco", async () => {
    const f = fake({ data: { id: "new", created: 13, revived: 0, canceled: 0, promoted: 0 } });
    const result = await new SupabaseRecurrenceCommands(f.client).create({
      kind: "expense", description: "Internet", amountCents: 12000, profileId: "p", accountId: "a", categoryId: "c",
      tags: ["Casa"], frequency: "monthly", interval: 1, startDate: "2026-10-10",
    });
    expect(result).toEqual({ id: "new", created: 13, revived: 0, canceled: 0, promoted: 0 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toEqual({
      fn: "create_recurring_transaction",
      args: expect.objectContaining({ p_kind: "expense", p_amount_cents: 12000, p_frequency: "monthly", p_interval: 1, p_start_date: "2026-10-10", p_account_id: "a", p_tags: ["Casa"] }),
    });
    expect(f.calls[0].args.p_card_id).toBeUndefined();
  });

  it("editar: patch em snake_case (undefined = limpar), tags em parâmetro próprio e applyToFuture", async () => {
    const f = fake({ data: { updated: 11, created: 0, revived: 0, canceled: 0, promoted: 0 } });
    const result = await new SupabaseRecurrenceCommands(f.client).update(rule, { amountCents: 15000, endDate: undefined, interval: 2, tags: ["x"] }, { applyToFuture: false });
    expect(result.updated).toBe(11);
    expect(f.calls[0]).toEqual({
      fn: "update_recurring_transaction",
      args: { p_id: "r1", p_patch: { amount_cents: 15000, end_date: null, interval_count: 2 }, p_tags: ["x"], p_apply_to_future: false },
    });
  });

  it("sem 'tags' no patch, as tags não são tocadas; padrão aplica às futuras", async () => {
    const f = fake();
    await new SupabaseRecurrenceCommands(f.client).update(rule, { description: "Novo" });
    expect(f.calls[0].args.p_tags).toBeUndefined();
    expect(f.calls[0].args.p_apply_to_future).toBe(true);
  });

  it("pausar/reativar e sincronizar usam as RPCs próprias", async () => {
    const f = fake({ data: { created: 0, revived: 12, canceled: 0, promoted: 1 } });
    const cmds = new SupabaseRecurrenceCommands(f.client);
    expect(await cmds.setActive(rule, true)).toEqual({ created: 0, revived: 12, canceled: 0, promoted: 1 });
    await cmds.sync();
    expect(f.calls.map((c) => [c.fn, c.args])).toEqual([
      ["set_recurring_transaction_active", { p_id: "r1", p_active: true }],
      ["sync_recurring_transactions", {}],
    ]);
  });

  it("erros do banco viram mensagens amigáveis", async () => {
    const f = fake({ error: { code: "P0001", message: "invoice_paid_locked" } });
    await expect(new SupabaseRecurrenceCommands(f.client).setActive(rule, false)).rejects.toThrow("Esta fatura já está paga e não pode ser alterada.");
    expect(friendlyDbMessage({ code: "P0002", message: "recurring_not_found" })).toBe("Recorrência não encontrada.");
    expect(friendlyDbMessage({ code: "22023", message: "invalid_interval" })).toMatch(/1 e 24/);
    expect(friendlyDbMessage({ code: "23505", message: 'duplicate key value violates unique constraint "transactions_recurring_occurrence_key"' })).toMatch(/ocorrência/);
  });
});

describe("mapeamento", () => {
  it("template: centavos, intervalo, datas e tags", () => {
    expect(
      recurringFromRow({
        id: "r", kind: "credit_card_purchase", description: "Netflix", amount_cents: 5590, profile_id: "p", account_id: null, card_id: "c",
        category_id: "cat", tags: ["Lazer"], notes: null, frequency: "monthly", interval_count: 2, start_date: "2026-10-05", end_date: null,
        materialize_from: "2026-10-06", is_active: false,
      }),
    ).toMatchObject({ amountCents: 5590, interval: 2, cardId: "c", active: false, tags: ["Lazer"], materializeFrom: "2026-10-06" });
  });

  it("ocorrência gerada carrega o vínculo com a regra", () => {
    const t = transactionFromRow({
      id: "t", kind: "expense", description: "Internet", amount_cents: 12000, date: "2026-11-10", status: "planned", profile_id: "p",
      recurring_transaction_id: "r1", occurrence_date: "2026-11-10", canceled_by_rule: true, installment_purchase_id: null, installment_number: null,
    });
    expect(t).toMatchObject({ recurringId: "r1", occurrenceDate: "2026-11-10", canceledByRule: true });
  });
});
