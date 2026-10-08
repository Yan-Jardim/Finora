import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { friendlyDbMessage } from "@/repositories/supabase/errors";
import { accountMapper, categoryMapper, creditCardMapper, profileMapper } from "@/repositories/supabase/mappers";
import {
  SupabaseAccountRepository,
  SupabaseCategoryRepository,
  SupabaseCreditCardRepository,
  SupabaseProfileRepository,
  seedDefaultCategories,
} from "@/repositories/supabase/supabase-repository";
import { createDataSource } from "@/repositories";
import { LocalStorageRepository } from "@/repositories/local-storage-repository";
import { SupabaseGoalRepository, SupabasePocketRepository } from "@/repositories/supabase/supabase-pocket-repository";
import { SupabaseTransactionRepository } from "@/repositories/supabase/supabase-transaction-repository";
import { SupabasePocketCommands } from "@/services/supabase-pocket-commands";
import { LocalTransactionCommands } from "@/services/local-transaction-commands";
import { SupabaseTransactionCommands } from "@/services/supabase-transaction-commands";
import { workspace } from "./helpers";

const HOUSEHOLD = "11111111-1111-1111-1111-111111111111";

/** Cliente Supabase falso: registra cada chamada encadeada e devolve um resultado configurado. */
function fakeClient(result: { data?: unknown; error?: { code?: string; message: string } | null } = { data: [], error: null }) {
  const calls: { table?: string; ops: [string, unknown[]][]; rpc?: [string, unknown] }[] = [];
  const client = {
    from(table: string) {
      const entry = { table, ops: [] as [string, unknown[]][] };
      calls.push(entry);
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "insert", "update", "delete", "eq", "in", "order", "single", "maybeSingle"]) {
        builder[op] = (...args: unknown[]) => {
          entry.ops.push([op, args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: result.data ?? null, error: result.error ?? null });
      return builder;
    },
    rpc(name: string, args: unknown) {
      calls.push({ ops: [], rpc: [name, args] });
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const op = (call: { ops: [string, unknown[]][] }, name: string) => call.ops.find(([n]) => n === name)?.[1];

describe("mapeadores domínio <-> banco", () => {
  it("perfil: is_active <-> active, avatar opcional", () => {
    const row = { id: "p1", name: "Ana", kind: "individual", color: "#4f46e5", is_active: false, avatar_url: null, household_id: HOUSEHOLD };
    expect(profileMapper.fromRow(row)).toEqual({ id: "p1", name: "Ana", kind: "individual", color: "#4f46e5", active: false, avatarUrl: undefined });
    expect(profileMapper.toInsert({ name: "Casal", kind: "shared", color: "#0d9488", active: true }, HOUSEHOLD)).toEqual({
      name: "Casal",
      kind: "shared",
      color: "#0d9488",
      is_active: true,
      household_id: HOUSEHOLD,
    });
  });

  it("categoria: parentId <-> parent_id; limpar o pai grava NULL", () => {
    const row = { id: "c1", name: "Aluguel", kind: "expense", icon: "home", color: "#6366f1", is_active: true, parent_id: "c0" };
    expect(categoryMapper.fromRow(row).parentId).toBe("c0");
    expect(categoryMapper.fromRow({ ...row, parent_id: null }).parentId).toBeUndefined();
    expect(categoryMapper.toPatch({ parentId: undefined })).toEqual({ parent_id: null });
    expect(categoryMapper.toPatch({ name: "Novo" })).toEqual({ name: "Novo" }); // só o que veio no patch
  });

  it("conta: centavos inteiros, nunca float; saldo atual não existe no modelo", () => {
    const row = {
      id: "a1", name: "Nubank", institution: null, owner_profile_id: "p1", type: "digital",
      initial_balance_cents: 123456, color: "#8a05be", icon: "smartphone", include_in_net_worth: true, is_active: true,
    };
    const account = accountMapper.fromRow(row);
    expect(account.initialBalanceCents).toBe(123456);
    expect(Number.isInteger(account.initialBalanceCents)).toBe(true);
    expect(account.institution).toBeUndefined();
    expect(Object.keys(account).some((k) => /balance/i.test(k) && k !== "initialBalanceCents")).toBe(false);
    expect(accountMapper.toPatch({ institution: undefined, initialBalanceCents: -5000 })).toEqual({
      institution: null,
      initial_balance_cents: -5000,
    });
  });

  it("cartão: conta de pagamento, limite em centavos e só os 4 últimos dígitos", () => {
    const row = {
      id: "k1", name: "Nubank", owner_profile_id: "p1", payment_account_id: "a1", brand: "visa",
      limit_cents: 800000, closing_day: 3, due_day: 10, last4: "4821", color: "#8a05be", is_active: true,
    };
    expect(creditCardMapper.fromRow(row)).toMatchObject({ accountId: "a1", limitCents: 800000, last4: "4821", brand: "visa" });
    const insert = creditCardMapper.toInsert(
      { name: "X", ownerProfileId: "p1", accountId: "a1", limitCents: 1000, closingDay: 3, dueDay: 10, color: "#000000", active: true },
      HOUSEHOLD,
    );
    expect(insert).toMatchObject({ payment_account_id: "a1", limit_cents: 1000, household_id: HOUSEHOLD });
    expect(Object.keys(insert).some((k) => /cvv|pan|number/i.test(k))).toBe(false);
  });
});

describe("conta padrão de pagamento do cartão é opcional", () => {
  const row = {
    id: "k1", name: "Nubank", owner_profile_id: "p1", payment_account_id: null, brand: null,
    limit_cents: 800000, closing_day: 3, due_day: 10, last4: null, color: "#8a05be", is_active: true,
  };
  it("banco -> domínio: NULL vira ausente", () => {
    expect(creditCardMapper.fromRow(row).accountId).toBeUndefined();
  });
  it("domínio -> banco: sem conta grava NULL; limpar a conta no update também", () => {
    const insert = creditCardMapper.toInsert(
      { name: "X", ownerProfileId: "p1", limitCents: 1000, closingDay: 3, dueDay: 10, color: "#000000", active: true },
      HOUSEHOLD,
    );
    expect(insert.payment_account_id).toBeUndefined(); // omitido -> o banco grava NULL
    expect(creditCardMapper.toPatch({ accountId: undefined })).toEqual({ payment_account_id: null });
    expect(creditCardMapper.toPatch({ accountId: "a9" })).toEqual({ payment_account_id: "a9" });
  });
});

describe("SupabaseRepository", () => {
  it("list: consulta a tabela certa em ordem estável e mapeia as linhas", async () => {
    const { client, calls } = fakeClient({
      data: [{ id: "a1", name: "Nubank", institution: "Nubank", owner_profile_id: "p1", type: "digital", initial_balance_cents: 100, color: "#000000", icon: "landmark", include_in_net_worth: true, is_active: true }],
    });
    const list = await new SupabaseAccountRepository(client, HOUSEHOLD).list();
    expect(calls[0].table).toBe("accounts");
    expect(calls[0].ops.filter(([n]) => n === "order").map(([, a]) => a[0])).toEqual(["created_at", "id"]);
    expect(list[0]).toMatchObject({ id: "a1", ownerProfileId: "p1", initialBalanceCents: 100 });
  });

  it("create: envia household_id e colunas em snake_case, e devolve o registro mapeado", async () => {
    const { client, calls } = fakeClient({ data: { id: "k1", name: "Cartão", owner_profile_id: "p1", payment_account_id: "a1", brand: null, limit_cents: 5000, closing_day: 5, due_day: 12, last4: null, color: "#000000", is_active: true } });
    const repo = new SupabaseCreditCardRepository(client, HOUSEHOLD);
    const card = await repo.create({ name: "Cartão", ownerProfileId: "p1", accountId: "a1", limitCents: 5000, closingDay: 5, dueDay: 12, color: "#000000", active: true });
    expect(calls[0].table).toBe("credit_cards");
    expect(op(calls[0], "insert")?.[0]).toMatchObject({ household_id: HOUSEHOLD, payment_account_id: "a1", limit_cents: 5000, is_active: true });
    expect(card.id).toBe("k1");
  });

  it("update: ativa/desativa e limpa campos opcionais (NULL), sempre por id", async () => {
    const { client, calls } = fakeClient({ data: { id: "a1", name: "N", institution: null, owner_profile_id: "p1", type: "cash", initial_balance_cents: 0, color: "#000000", icon: "banknote", include_in_net_worth: true, is_active: false } });
    await new SupabaseAccountRepository(client, HOUSEHOLD).update("a1", { active: false, institution: undefined });
    expect(op(calls[0], "update")?.[0]).toEqual({ is_active: false, institution: null });
    expect(op(calls[0], "eq")).toEqual(["id", "a1"]);
  });

  it("remove / removeMany filtram por id(s); lote vazio não chama o banco", async () => {
    const { client, calls } = fakeClient();
    const repo = new SupabaseCategoryRepository(client, HOUSEHOLD);
    await repo.remove("c1");
    await repo.removeMany(["c1", "c2"]);
    await repo.removeMany([]);
    expect(calls).toHaveLength(2);
    expect(op(calls[0], "delete")).toBeDefined();
    expect(op(calls[1], "in")).toEqual(["id", ["c1", "c2"]]);
  });

  it("erros do banco viram mensagens amigáveis", async () => {
    const dup = fakeClient({ error: { code: "23505", message: 'duplicate key value violates unique constraint "accounts_household_name_key"' } });
    await expect(new SupabaseAccountRepository(dup.client, HOUSEHOLD).create({ name: "X", ownerProfileId: "p", type: "cash", initialBalanceCents: 0, color: "#000000", icon: "x", includeInNetWorth: true, active: true })).rejects.toThrow("Já existe uma conta com esse nome.");

    const inUse = fakeClient({ error: { code: "23503", message: 'update or delete on table "accounts" violates foreign key constraint "credit_cards_payment_account_fk"' } });
    await expect(new SupabaseAccountRepository(inUse.client, HOUSEHOLD).remove("a1")).rejects.toThrow(/em uso/);

    const rls = fakeClient({ error: { code: "42501", message: "new row violates row-level security policy" } });
    await expect(new SupabaseProfileRepository(rls.client, HOUSEHOLD).list()).rejects.toThrow("Você não tem permissão");
  });

  it("seedDefaultCategories chama a RPC com o household", async () => {
    const { client, calls } = fakeClient({ data: 23 });
    expect(await seedDefaultCategories(client, HOUSEHOLD)).toBe(23);
    expect(calls[0].rpc).toEqual(["seed_default_categories", { p_household_id: HOUSEHOLD }]);
  });
});

describe("tradução de erros", () => {
  it("regras de categoria vindas dos triggers", () => {
    expect(friendlyDbMessage({ code: "P0001", message: "category_parent_must_be_root" })).toMatch(/um nível/);
    expect(friendlyDbMessage({ code: "P0001", message: "category_kind_incompatible" })).toMatch(/compatível/);
    expect(friendlyDbMessage({ code: "P0001", message: "category_has_children" })).toMatch(/subcategorias/);
  });
  it("rede e códigos desconhecidos", () => {
    expect(friendlyDbMessage({ message: "TypeError: Failed to fetch" })).toMatch(/conexão/);
    expect(friendlyDbMessage({ code: "XX000", message: "boom" })).toMatch(/Não foi possível/);
  });
});

describe("ponto único de escolha (repositories/index.ts)", () => {
  it("modo local usa localStorage para tudo", () => {
    const source = createDataSource({ mode: "local" });
    expect(source.repos.accounts).toBeInstanceOf(LocalStorageRepository);
    expect(source.admin).toBeDefined();
    expect(source.seedDefaultCategories).toBeUndefined();
    expect(source.finance).toBeUndefined();
    expect(source.createCommands({ today: () => "2026-10-06", data: () => workspace() })).toBeInstanceOf(LocalTransactionCommands);
  });

  it("modo supabase usa Supabase nos cadastros E nas movimentações; só as reservas seguem locais (por household)", () => {
    const { client } = fakeClient();
    const source = createDataSource({ mode: "supabase", householdId: HOUSEHOLD, client });
    expect(source.repos.profiles).toBeInstanceOf(SupabaseProfileRepository);
    expect(source.repos.categories).toBeInstanceOf(SupabaseCategoryRepository);
    expect(source.repos.accounts).toBeInstanceOf(SupabaseAccountRepository);
    expect(source.repos.creditCards).toBeInstanceOf(SupabaseCreditCardRepository);
    expect(source.repos.transactions).toBeInstanceOf(SupabaseTransactionRepository);
    expect(source.repos.pockets).toBeInstanceOf(SupabasePocketRepository);
    expect(source.repos.goals).toBeInstanceOf(SupabaseGoalRepository);
    expect(source.createPocketCommands({ today: () => "2026-10-06" })).toBeInstanceOf(SupabasePocketCommands);
    expect(source.finance).toBeDefined();
    expect(source.createCommands({ today: () => "2026-10-06", data: () => workspace() })).toBeInstanceOf(SupabaseTransactionCommands);
    // restaurar/zerar demonstração NUNCA existe com dados reais
    expect(source.admin).toBeUndefined();
    expect(source.seedDefaultCategories).toBeTypeOf("function");
  });

  it("modo supabase exige household e cliente", () => {
    expect(() => createDataSource({ mode: "supabase" })).toThrow();
  });
});
