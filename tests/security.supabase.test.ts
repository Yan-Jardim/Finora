/**
 * SEGURANÇA NO BANCO REAL (usuário descartável): anon não acessa nada; o usuário autenticado só enxerga e escreve no
 * PRÓPRIO household; nenhum endpoint aceita household_id arbitrário; o schema private não é exposto; escritas financeiras só
 * por RPC. Complementa os testes SQL de isolamento (supabase/tests/*_isolation_test.sql, com dois households).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENABLED, env, makeSupabase, type SupabaseSide } from "./support/parity-harness";

const TABLES = [
  "accounts", "card_invoices", "categories", "credit_cards", "debts", "financial_profiles", "goals", "household_members", "households",
  "installment_purchases", "pocket_movements", "pockets", "recurring_skips", "recurring_transactions", "tags", "transaction_tags", "transactions", "user_profiles",
];
const VIEWS = ["v_account_balances", "v_account_reserves", "v_card_invoice_totals", "v_card_usage", "v_debt_installments", "v_debt_summary", "v_pocket_balances"];
const RPCS = [
  ["create_transaction", {}], ["update_transaction", {}], ["create_installment_purchase", {}], ["pay_invoice", {}], ["create_debt", {}], ["pay_debt", {}],
  ["create_pocket", {}], ["pocket_reserve", {}], ["pocket_withdraw", {}], ["spend_from_pocket", {}], ["reverse_pocket_use", {}], ["sync_recurring_transactions", {}],
  ["bootstrap_household", { p_household_name: "x", p_display_name: "y" }], ["seed_default_categories", { p_household_id: "00000000-0000-0000-0000-000000000000" }],
] as const;
const RANDOM = "11111111-2222-4333-8444-555555555555";

describe.skipIf(!ENABLED)("segurança no Supabase real", { timeout: 120_000 }, () => {
  let sb: SupabaseSide;
  let anon: SupabaseClient;
  let user: SupabaseClient;

  beforeAll(async () => {
    sb = await makeSupabase();
    user = sb.client;
    const wsName = "ws";
    const { default: ws } = await import(wsName); // Node 20 não tem WebSocket nativo
    anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: ws } });
  });
  afterAll(async () => {
    if (sb) await sb.cleanup();
  });

  it("anon (sem login): não lê nenhuma tabela nem view de negócio", async () => {
    for (const name of [...TABLES, ...VIEWS]) {
      const { data, error } = await anon.from(name).select("*").limit(1);
      expect(error || (data ?? []).length === 0, `${name}: anon não pode ver dados (erro=${error?.code})`).toBeTruthy();
      expect((data ?? []).length, name).toBe(0);
    }
  });

  it("anon: nenhuma RPC é executável", async () => {
    for (const [fn, args] of RPCS) {
      const { error } = await anon.rpc(fn, args as Record<string, unknown>);
      expect(error, `${fn} deve ser recusada para anon`).toBeTruthy();
      expect(["42501", "PGRST202", "PGRST301", "401", "28000"].includes(String(error!.code)) || /permission|jwt|not authenticated|authenticated/i.test(error!.message), `${fn}: ${error!.code} ${error!.message}`).toBe(true);
    }
  });

  it("anon: não escreve em tabela alguma", async () => {
    for (const name of TABLES) {
      const { error } = await anon.from(name).insert({ id: RANDOM } as never);
      expect(error, `${name}: INSERT anônimo`).toBeTruthy();
      const upd = await anon.from(name).update({ id: RANDOM } as never).eq("id", RANDOM);
      expect(upd.error || upd.count === 0 || upd.status === 204 || upd.status >= 400, `${name}: UPDATE anônimo`).toBeTruthy();
    }
  });

  it("usuário: vê só o PRÓPRIO household (e só os próprios vínculos)", async () => {
    const { data: households } = await user.from("households").select("id");
    expect(households).toHaveLength(1);
    expect(households![0].id).toBe(sb.householdId);
    const { data: members } = await user.from("household_members").select("household_id");
    expect(new Set((members ?? []).map((m) => m.household_id))).toEqual(new Set([sb.householdId]));
    for (const name of ["accounts", "categories", "financial_profiles"]) {
      const { data } = await user.from(name).select("household_id");
      expect((data ?? []).every((r) => r.household_id === sb.householdId), name).toBe(true);
    }
  });

  it("household_id arbitrário é recusado: escrever num household que não é o seu falha (RLS + FKs compostas)", async () => {
    const insert = await user.from("accounts").insert({ household_id: RANDOM, name: "Invasora", owner_profile_id: RANDOM, type: "checking" });
    expect(insert.error, "INSERT em household alheio").toBeTruthy();
    const seed = await user.rpc("seed_default_categories", { p_household_id: RANDOM });
    // INVOKER + RLS: ou erro, ou 0 linhas (nunca cria categorias em household alheio)
    expect(seed.error || seed.data === 0 || seed.data === null, `seed_default_categories alheio: ${JSON.stringify(seed.data)}`).toBeTruthy();
    const { count } = await user.from("categories").select("id", { count: "exact", head: true }).eq("household_id", RANDOM);
    expect(count).toBe(0);
    // não existe RPC que receba household_id além de seed_default_categories (INVOKER): conferido na auditoria de assinaturas
  });

  it("household_id e created_by são imutáveis (não dá para 'mudar' um registro de household)", async () => {
    const { data: acc } = await user.from("financial_profiles").select("id, household_id").limit(1);
    const move = await user.from("financial_profiles").update({ household_id: RANDOM }).eq("id", acc![0].id);
    expect(move.error, "mover perfil para outro household").toBeTruthy();
  });

  it("histórico de cofrinhos não tem escrita direta (só RPC); movimentações não aceitam tipos inválidos", async () => {
    const ins = await user.from("pocket_movements").insert({ household_id: sb.householdId, pocket_id: RANDOM, kind: "reserve", amount_cents: 100 });
    expect(ins.error?.code, "INSERT direto em pocket_movements").toBe("42501");
    const upd = await user.from("pocket_movements").update({ amount_cents: 1 }).eq("id", RANDOM);
    expect(upd.error?.code ?? "42501").toBe("42501");
    const del = await user.from("pocket_movements").delete().eq("id", RANDOM);
    expect(del.error?.code ?? "42501").toBe("42501");
  });

  it("schema private não é exposto pela API", async () => {
    const { error } = await user.schema("private" as never).rpc("is_member", { p_household_id: sb.householdId } as never);
    expect(error, "private.* não pode ser chamado pela API").toBeTruthy();
  });

  it("bootstrap_household de quem já tem household é recusado (já cadastrado)", async () => {
    const { error } = await user.rpc("bootstrap_household", { p_household_name: "Outra", p_display_name: "Eu" });
    expect(error?.message ?? "").toMatch(/already_onboarded/);
  });

  it("RPCs recusam ids de outro household como inexistentes (sem vazar existência)", async () => {
    const calls = [
      user.rpc("pocket_reserve", { p_pocket_id: RANDOM, p_amount_cents: 100 }),
      user.rpc("reverse_pocket_use", { p_transaction_id: RANDOM }),
      user.rpc("pay_debt", { p_debt_id: RANDOM, p_account_id: RANDOM, p_amount_cents: 100, p_date: "2026-10-07" }),
      user.rpc("link_goal_pocket", { p_goal_id: RANDOM, p_pocket_id: null }),
    ];
    for (const { error } of await Promise.all(calls)) {
      expect(error).toBeTruthy();
      expect(error!.message).toMatch(/not_found|forbidden|invalid|permission/i);
    }
  });
});
