/**
 * `fetch` com nova tentativa para falhas TRANSITÓRIAS de rede/gateway (502/503/504 do Cloudflare à frente do Supabase, ou
 * conexão derrubada). Motivo: nesses casos o pedido nem chega ao projeto (o log da API não registra) e o navegador vê só
 * "Failed to fetch"/CORS, porque a resposta de erro do gateway não traz cabeçalhos CORS.
 *
 * SÓ repete o que é seguro repetir: leituras (GET/HEAD) e o login (POST /auth/v1/token). Escritas (RPCs, PATCH, DELETE
 * com efeito, POST em geral) NUNCA são repetidas automaticamente: se a primeira tentativa tiver chegado ao banco, repetir
 * duplicaria a operação. Para elas o erro continua indo ao usuário (mensagem amigável de "sem conexão").
 */
const TRANSIENT = new Set([502, 503, 504]);

const methodOf = (input: RequestInfo | URL, init?: RequestInit) => (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
const urlOf = (input: RequestInfo | URL) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

export function isSafeToRetry(method: string, url: string): boolean {
  if (method === "GET" || method === "HEAD") return true;
  return method === "POST" && /\/auth\/v1\/token(\?|$)/.test(url);
}

export interface ResilientOptions {
  retries?: number;
  /** Espera antes da n-ésima repetição: baseDelayMs * 2^(n-1). */
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function resilientFetch({ retries = 2, baseDelayMs = 400, fetchImpl, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: ResilientOptions = {}): typeof fetch {
  return async (input, init) => {
    const call = fetchImpl ?? fetch;
    const retryable = isSafeToRetry(methodOf(input, init), urlOf(input));
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await call(input, init);
        if (!retryable || !TRANSIENT.has(response.status) || attempt >= retries) return response;
      } catch (error) {
        if (!retryable || attempt >= retries || (error instanceof DOMException && error.name === "AbortError")) throw error;
      }
      // Cancelado durante a espera: não tenta de novo (nem espera mais).
      if (init?.signal?.aborted) throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
      await sleep(baseDelayMs * 2 ** attempt);
      if (init?.signal?.aborted) throw init.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
  };
}
