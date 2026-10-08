import { describe, expect, it } from "vitest";
import { isSafeToRetry, resilientFetch } from "@/lib/supabase/resilient-fetch";

const res = (status: number) => new Response(status === 200 ? "{}" : "<html>Bad Gateway</html>", { status });
const scripted = (...steps: (number | Error)[]) => {
  const calls: { url: string; method: string }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return res(step);
  }) as typeof fetch;
  return { calls, f: resilientFetch({ fetchImpl: impl, sleep: async () => {} }) };
};

describe("fetch resiliente (falhas transitórias do gateway)", () => {
  it("leitura (GET): repete em 502/503/504 e devolve o sucesso", async () => {
    const { f, calls } = scripted(502, 504, 200);
    expect((await f("https://x/rest/v1/accounts")).status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it("leitura: repete quando a conexão cai (Failed to fetch / CORS do gateway) e desiste depois de 2 repetições", async () => {
    const ok = scripted(new TypeError("Failed to fetch"), 200);
    expect((await ok.f("https://x/rest/v1/accounts")).status).toBe(200);
    const down = scripted(502);
    expect((await down.f("https://x/rest/v1/accounts")).status).toBe(502); // devolve o último erro
    expect(down.calls).toHaveLength(3);
    const dead = scripted(new TypeError("Failed to fetch"));
    await expect(dead.f("https://x/rest/v1/accounts")).rejects.toThrow("Failed to fetch");
    expect(dead.calls).toHaveLength(3);
  });

  it("ESCRITAS nunca são repetidas (a primeira tentativa pode ter chegado ao banco): RPC, PATCH, DELETE, POST", async () => {
    for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
      const { f, calls } = scripted(502, 200);
      expect((await f("https://x/rest/v1/rpc/pocket_reserve", { method })).status).toBe(502);
      expect(calls).toHaveLength(1);
    }
    const net = scripted(new TypeError("Failed to fetch"), 200);
    await expect(net.f("https://x/rest/v1/rpc/create_transaction", { method: "POST" })).rejects.toThrow();
    expect(net.calls).toHaveLength(1);
  });

  it("login (POST /auth/v1/token) é repetido; outros endpoints de auth não", async () => {
    expect(isSafeToRetry("POST", "https://x/auth/v1/token?grant_type=password")).toBe(true);
    expect(isSafeToRetry("POST", "https://x/auth/v1/signup")).toBe(false);
    expect(isSafeToRetry("POST", "https://x/auth/v1/logout")).toBe(false);
    const { f, calls } = scripted(502, 200);
    expect((await f("https://x/auth/v1/token?grant_type=password", { method: "POST" })).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("cancelamento (AbortSignal): não repete e propaga o abort, mesmo durante a espera", async () => {
    const controller = new AbortController();
    const calls: number[] = [];
    const f = resilientFetch({
      fetchImpl: (async () => {
        calls.push(1);
        return res(502);
      }) as typeof fetch,
      sleep: async () => controller.abort(), // cancelado enquanto espera o backoff
    });
    await expect(f("https://x/rest/v1/accounts", { signal: controller.signal })).rejects.toBeTruthy();
    expect(calls).toHaveLength(1);
    const pre = new AbortController();
    pre.abort();
    const aborting = resilientFetch({ fetchImpl: (async (_u: unknown, init?: RequestInit) => { if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError"); return res(200); }) as typeof fetch, sleep: async () => {} });
    await expect(aborting("https://x/rest/v1/accounts", { signal: pre.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("backoff limitado e sem laço infinito: no máximo retries+1 tentativas, com esperas 400ms, 800ms", async () => {
    const waits: number[] = [];
    let n = 0;
    const f = resilientFetch({ retries: 2, baseDelayMs: 400, fetchImpl: (async () => (n++, res(503))) as typeof fetch, sleep: async (ms) => void waits.push(ms) });
    expect((await f("https://x/rest/v1/accounts")).status).toBe(503);
    expect(n).toBe(3);
    expect(waits).toEqual([400, 800]);
  });

  it("erros de regra (4xx) e respostas normais não são repetidos", async () => {
    const { f, calls } = scripted(400);
    expect((await f("https://x/rest/v1/accounts")).status).toBe(400);
    expect(calls).toHaveLength(1);
  });
});
