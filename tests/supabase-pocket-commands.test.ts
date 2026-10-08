import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/repositories/supabase/errors";
import { SupabasePocketCommands } from "@/services/supabase-pocket-commands";

type Call = { fn: string; args: Record<string, unknown> };

function fake(opts: { rpc?: Record<string, unknown>; error?: { code?: string; message: string; details?: string } } = {}) {
  const calls: Call[] = [];
  let direct = 0;
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return opts.error ? { data: null, error: opts.error } : { data: opts.rpc?.[fn] ?? null, error: null };
    },
    from() {
      direct++;
      throw new Error("escrita/leitura direta não é esperada nos comandos de cofrinho");
    },
  } as unknown as SupabaseClient;
  return { client, calls, direct: () => direct };
}

describe("SupabasePocketCommands — cada operação é UMA RPC atômica", () => {
  it("create → create_pocket (sem household_id; opcionais omitidos)", async () => {
    const f = fake({ rpc: { create_pocket: "p1" } });
    const id = await new SupabasePocketCommands(f.client).create({ name: "Viagem", profileId: "pr", accountId: "ac", initialCents: 500, legacyRef: "legacy:k1" });
    expect(id).toBe("p1");
    expect(f.calls).toEqual([{ fn: "create_pocket", args: expect.objectContaining({ p_profile_id: "pr", p_account_id: "ac", p_name: "Viagem", p_initial_cents: 500, p_legacy_ref: "legacy:k1" }) }]);
    expect(Object.keys(f.calls[0].args)).not.toContain("p_household_id");
  });

  it("update → update_pocket com patch (undefined da descrição vira null = limpar)", async () => {
    const f = fake();
    await new SupabasePocketCommands(f.client).update("p1", { name: "Novo", description: undefined, profileId: "pr2" });
    expect(f.calls[0]).toEqual({ fn: "update_pocket", args: { p_id: "p1", p_patch: { name: "Novo", description: null, profile_id: "pr2" } } });
  });

  it("archive / reserve / withdraw / transfer / reverse / link usam as RPCs certas", async () => {
    const f = fake({ rpc: { pocket_reserve: "m1", pocket_withdraw: "m2", pocket_transfer: "g1", reverse_pocket_use: "m3" } });
    const c = new SupabasePocketCommands(f.client);
    await c.setArchived("p1", true);
    expect(await c.reserve({ pocketId: "p1", amountCents: 100, date: "2026-10-06", note: "n" })).toBe("m1");
    expect(await c.withdraw({ pocketId: "p1", amountCents: 50 })).toBe("m2");
    expect(await c.transfer({ fromPocketId: "a", toPocketId: "b", amountCents: 10 })).toBe("g1");
    expect(await c.reverseUse("t1", "desisti")).toBe("m3");
    await c.linkGoal("g", null);
    expect(f.calls.map((x) => x.fn)).toEqual(["set_pocket_archived", "pocket_reserve", "pocket_withdraw", "pocket_transfer", "reverse_pocket_use", "link_goal_pocket"]);
    expect(f.calls[0].args).toEqual({ p_id: "p1", p_archived: true });
    expect(f.calls[1].args).toEqual({ p_pocket_id: "p1", p_amount_cents: 100, p_date: "2026-10-06", p_note: "n" });
    expect(f.calls[3].args).toMatchObject({ p_from_pocket_id: "a", p_to_pocket_id: "b", p_amount_cents: 10 });
    expect(f.calls[4].args).toEqual({ p_transaction_id: "t1", p_note: "desisti" });
    expect(f.calls[5].args).toEqual({ p_goal_id: "g", p_pocket_id: null });
  });

  it("spend → spend_from_pocket e o resultado vira camelCase", async () => {
    const f = fake({ rpc: { spend_from_pocket: { transaction_id: "t", movement_id: "m", from_pocket_cents: 3000, from_account_cents: 2000 } } });
    const r = await new SupabasePocketCommands(f.client).spend({ pocketId: "p1", description: "Padaria", amountCents: 5000, amountFromPocketCents: 3000, categoryId: "cat", tags: ["x"] });
    expect(r).toEqual({ transactionId: "t", movementId: "m", fromPocketCents: 3000, fromAccountCents: 2000 });
    expect(f.calls[0]).toEqual({ fn: "spend_from_pocket", args: expect.objectContaining({ p_pocket_id: "p1", p_amount_cents: 5000, p_amount_from_pocket: 3000, p_category_id: "cat", p_tags: ["x"] }) });
  });

  it("nada é replicado no frontend: nenhuma leitura/escrita direta nas tabelas", async () => {
    const f = fake({ rpc: { create_pocket: "p", spend_from_pocket: { transaction_id: "t", movement_id: "m", from_pocket_cents: 1, from_account_cents: 0 } } });
    const c = new SupabasePocketCommands(f.client);
    await c.create({ name: "x", profileId: "a", accountId: "b" });
    await c.spend({ pocketId: "p", description: "x", amountCents: 1, categoryId: "c" });
    expect(f.direct()).toBe(0);
  });

  it("erro do banco vira AppError traduzido, com código e valores", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fake({ error: { code: "P0001", message: "insufficient_pocket", details: "shortfall_cents=250;balance_cents=1000" } });
    const err = await new SupabasePocketCommands(f.client).withdraw({ pocketId: "p", amountCents: 1250 }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("insufficient_pocket");
    expect(err.message).toBe("O cofrinho tem só R$ 10,00: faltam R$ 2,50.");
  });
});
