import { describe, expect, it, vi } from "vitest";
import { configuredCredentialKeys, credentialsFor } from "@/lib/open-finance/credentials";
import { createPluggyClient, PLUGGY_API_URL, PluggyError, type PluggyAccount } from "@/lib/open-finance/pluggy";
import { institutionName } from "@/lib/open-finance/institutions";
import { fetchConnections, isStale, itemStatusNotice, planAccountLinks, toBalanceRow } from "@/lib/open-finance/sync";
import { preferBankBalances } from "@/repositories/supabase/supabase-finance-reader";
import { bankConnectionSchema } from "@/schemas/bank-connection";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const bank: PluggyAccount = { id: "acc-1", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta Corrente", number: "1234-5", balance: 1520.37, currencyCode: "BRL" };
const card: PluggyAccount = {
  id: "acc-2",
  type: "CREDIT",
  subtype: "CREDIT_CARD",
  name: "Mastercard Black",
  number: "4321",
  balance: 142.41,
  currencyCode: "BRL",
  creditData: { creditLimit: 518, availableCreditLimit: 513.1 },
};

describe("cliente Pluggy", () => {
  it("autentica uma vez e usa a chave nas consultas", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).replace(PLUGGY_API_URL, "");
      if (path === "/auth") {
        expect(JSON.parse(String(init?.body))).toEqual({ clientId: "id", clientSecret: "secret" });
        return json({ apiKey: "key-1" });
      }
      expect((init?.headers as Record<string, string>)["X-API-KEY"]).toBe("key-1");
      if (path === "/items/item-1") return json({ id: "item-1", status: "UPDATED", connector: { name: "Nubank" } });
      if (path === "/accounts?itemId=item-1") return json({ results: [bank, card] });
      return json({}, 404);
    });
    const client = createPluggyClient({ clientId: "id", clientSecret: "secret" }, fetchMock as typeof fetch);

    expect((await client.getItem("item-1")).connector?.name).toBe("Nubank");
    expect(await client.listAccounts("item-1")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth"))).toHaveLength(1);
  });

  it("traduz recusas da API sem vazar detalhes", async () => {
    const client = createPluggyClient({ clientId: "id", clientSecret: "errado" }, (async () => json({ message: "Unauthorized" }, 401)) as typeof fetch);
    await expect(client.getItem("x")).rejects.toThrow(PluggyError);
    await expect(client.getItem("x")).rejects.toThrow(/credenciais/);
  });

  it("falha de rede vira mensagem amigável", async () => {
    const client = createPluggyClient({ clientId: "id", clientSecret: "s" }, (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    await expect(client.listAccounts("x")).rejects.toThrow(/Sem conexão com a Pluggy/);
  });
});

describe("conversão de contas", () => {
  it("reais (float) viram centavos inteiros", () => {
    expect(toBalanceRow(bank)).toMatchObject({ external_account_id: "acc-1", type: "BANK", balance_cents: 152037, credit_limit_cents: null });
    expect(toBalanceRow(card)).toMatchObject({ type: "CREDIT", balance_cents: 14241, credit_limit_cents: 51800, available_limit_cents: 51310 });
  });

  it("usa o nome comercial quando existe e moeda BRL por padrão", () => {
    expect(toBalanceRow({ ...bank, marketingName: "NuConta", currencyCode: null })).toMatchObject({ name: "NuConta", currency: "BRL" });
  });
});

describe("status e atualização automática", () => {
  it("só avisa quando o banco precisa de atenção", () => {
    expect(itemStatusNotice("UPDATED")).toBeNull();
    expect(itemStatusNotice(null)).toBeNull();
    expect(itemStatusNotice("LOGIN_ERROR")).toMatch(/consentimento/);
    expect(itemStatusNotice("OUTDATED")).toMatch(/desatualizado/);
  });

  it("conexão é relida depois de 12 h ou se nunca foi lida", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(isStale(null, now)).toBe(true);
    expect(isStale("2026-10-26T01:00:00Z", now)).toBe(false);
    expect(isStale("2026-10-25T23:59:00Z", now)).toBe(true);
  });
});

describe("sincronização", () => {
  it("um banco com erro não derruba os outros; credencial ausente é avisada", async () => {
    const ok = { getItem: async () => ({ id: "a", status: "UPDATED", connector: { name: "Itaú" } }), listAccounts: async () => [bank] };
    const broken = {
      getItem: async () => {
        throw new PluggyError("Conexão não encontrada na Pluggy. Confira o Item ID.", 404);
      },
      listAccounts: async () => [],
    };
    const clientFor = vi.fn((key: string) => (key === "yan" ? ok : key === "camila" ? broken : null));

    const results = await fetchConnections(
      [
        { id: "c1", credentialKey: "yan", itemId: "a" },
        { id: "c2", credentialKey: "camila", itemId: "b" },
        { id: "c3", credentialKey: "outro", itemId: "c" },
        { id: "c4", credentialKey: "yan", itemId: "d" },
      ],
      clientFor,
    );

    expect(results.map((r) => [r.connectionId, r.status, r.error === null])).toEqual([
      ["c1", "UPDATED", true],
      ["c2", "ERROR", false],
      ["c3", "NOT_CONFIGURED", false],
      ["c4", "UPDATED", true],
    ]);
    expect(results[0]).toMatchObject({ institution: "Itaú", accounts: [{ balance_cents: 152037 }] });
    expect(results[1].error).toMatch(/Item ID/);
    // Um cliente (e uma autenticação) por credencial.
    expect(clientFor).toHaveBeenCalledTimes(3);
  });
});

describe("credenciais por variável de ambiente", () => {
  const env = {
    PLUGGY_YAN_CLIENT_ID: "a",
    PLUGGY_YAN_CLIENT_SECRET: "b",
    PLUGGY_CAMILA_CLIENT_ID: "c",
    PLUGGY_CAMILA_CLIENT_SECRET: " ",
    OTHER: "x",
  };

  it("lista só as chaves com o par completo", () => {
    expect(configuredCredentialKeys(env)).toEqual(["yan"]);
    expect(credentialsFor("yan", env)).toEqual({ clientId: "a", clientSecret: "b" });
    expect(credentialsFor("camila", env)).toBeNull();
  });
});

describe("formulário de conexão", () => {
  it("aceita um Item ID da Pluggy e recusa lixo", () => {
    const base = { ownerProfileId: "p1", credentialKey: "yan" };
    expect(bankConnectionSchema.safeParse({ ...base, itemId: " 7a1b2c3d-0000-4e5f-9a8b-112233445566 " }).success).toBe(true);
    expect(bankConnectionSchema.safeParse({ ...base, itemId: "../items" }).success).toBe(false);
    expect(bankConnectionSchema.safeParse({ ...base, credentialKey: "Yan!", itemId: "abc" }).success).toBe(false);
  });
});

describe("nome do banco", () => {
  it("pelo Meu Pluggy, deduz o banco pelo código de transferência", () => {
    expect(institutionName("MeuPluggy", [{ ...bank, bankData: { transferNumber: "341/7471/00089066-0" } }])).toBe("Itaú");
    expect(institutionName("Nubank", [bank])).toBe("Nubank");
    expect(institutionName("MeuPluggy", [{ ...bank, name: "Conta Mercado Pago (PF)" }])).toBe("Conta Mercado Pago");
  });
});

describe("contas reais viram contas do Finora", () => {
  const connections = [
    { id: "c1", ownerProfileId: "p1", institution: "Itaú" },
    { id: "c2", ownerProfileId: "p1", institution: "MeuPluggy" },
  ];

  it("cria uma conta por banco, reaproveita nome livre e não duplica", () => {
    const plan = planAccountLinks({
      balances: [
        { id: "b1", connectionId: "c1", name: "Conta", number: "1", accountId: null },
        { id: "b2", connectionId: "c2", name: "Nubank (PF)", number: null, accountId: null },
        { id: "b3", connectionId: "c2", name: "Nubank (PF)", number: null, accountId: "a-ok" },
      ],
      connections,
      accounts: [{ id: "a-itau", name: "itaú" }],
    });
    expect(plan.link).toEqual([{ balanceId: "b1", accountId: "a-itau" }]);
    // Sem nome de banco confiável ("MeuPluggy"), usa o nome da conta e não grava a instituição genérica.
    expect(plan.create).toEqual([{ balanceId: "b2", name: "Nubank", institution: null, ownerProfileId: "p1" }]);
  });

  it("várias contas da mesma conexão levam o número no nome", () => {
    const plan = planAccountLinks({
      balances: [
        { id: "b1", connectionId: "c1", name: "Conta", number: "111", accountId: null },
        { id: "b2", connectionId: "c1", name: "Poupança", number: "222", accountId: null },
      ],
      connections,
      accounts: [],
    });
    expect(plan.create.map((c) => c.name)).toEqual(["Itaú 111", "Itaú 222"]);
  });
});

describe("mesmo banco em duas conexões", () => {
  it("a segunda conta ganha o número no nome em vez de ficar sem vínculo", () => {
    const connections = [
      { id: "c1", ownerProfileId: "yan", institution: "Nubank" },
      { id: "c2", ownerProfileId: "camila", institution: "Nubank" },
    ];
    const balances = [
      { id: "b1", connectionId: "c1", name: "Nu", number: "111", accountId: "a-nu" },
      { id: "b2", connectionId: "c2", name: "Nu", number: "222", accountId: null },
    ];
    const plan = planAccountLinks({ balances, connections, accounts: [{ id: "a-nu", name: "Nubank" }] });
    expect(plan.create).toEqual([{ balanceId: "b2", name: "Nubank 222", institution: "Nubank", ownerProfileId: "camila" }]);

    const fresh = planAccountLinks({ balances: balances.map((b) => ({ ...b, accountId: null })), connections, accounts: [] });
    expect(fresh.create.map((c) => c.name)).toEqual(["Nubank", "Nubank 222"]);
  });
});

describe("saldo do banco tem prioridade", () => {
  it("substitui o saldo calculado das contas ligadas e mantém as demais", () => {
    const derived = new Map([
      ["a1", 1000],
      ["a2", 500],
    ]);
    const result = preferBankBalances(derived, [
      { account_id: "a1", balance_cents: 365537 },
      { account_id: "a1", balance_cents: 100 },
    ]);
    expect(result.get("a1")).toBe(365637);
    expect(result.get("a2")).toBe(500);
    expect(derived.get("a1")).toBe(1000);
  });
});
