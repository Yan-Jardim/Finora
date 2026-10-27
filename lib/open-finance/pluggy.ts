/**
 * Cliente mínimo da API da Pluggy (https://docs.pluggy.ai), só com o que a validação de Open Finance usa:
 * autenticar, ler a conexão (item) e listar as contas com saldo. Sem estado global e com `fetch` injetável (testes).
 * Roda SÓ no servidor: recebe Client ID/Secret, que nunca podem chegar ao navegador.
 */

export const PLUGGY_API_URL = "https://api.pluggy.ai";

export interface PluggyCredentials {
  clientId: string;
  clientSecret: string;
}

export interface PluggyItem {
  id: string;
  /** UPDATED, UPDATING, LOGIN_ERROR, OUTDATED, WAITING_USER_INPUT… */
  status: string;
  connector?: { name?: string } | null;
  lastUpdatedAt?: string | null;
  error?: { code?: string; message?: string } | null;
}

export interface PluggyAccount {
  id: string;
  type: "BANK" | "CREDIT";
  subtype?: string | null;
  name: string;
  marketingName?: string | null;
  number?: string | null;
  /** Em reais (float). No cartão: valor da fatura atual. */
  balance: number;
  currencyCode?: string | null;
  bankData?: { transferNumber?: string | null } | null;
  creditData?: { creditLimit?: number | null; availableCreditLimit?: number | null } | null;
}

export class PluggyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PluggyError";
  }
}

type FetchLike = typeof fetch;

export function createPluggyClient(credentials: PluggyCredentials, fetchImpl: FetchLike = fetch) {
  let apiKey: string | null = null;

  async function call<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (auth) headers["X-API-KEY"] = await key();
    let response: Response;
    try {
      response = await fetchImpl(`${PLUGGY_API_URL}${path}`, { ...init, headers, cache: "no-store" });
    } catch {
      throw new PluggyError("Sem conexão com a Pluggy. Tente novamente mais tarde.");
    }
    if (!response.ok) throw new PluggyError(httpMessage(response.status), response.status);
    return (await response.json()) as T;
  }

  /** A chave da API vale ~2 h; uma por cliente basta para uma sincronização. */
  async function key(): Promise<string> {
    if (apiKey) return apiKey;
    const body = await call<{ apiKey?: string }>("/auth", { method: "POST", body: JSON.stringify(credentials) }, false);
    if (!body.apiKey) throw new PluggyError("A Pluggy não devolveu a chave de acesso.");
    apiKey = body.apiKey;
    return apiKey;
  }

  return {
    getItem: (itemId: string) => call<PluggyItem>(`/items/${encodeURIComponent(itemId)}`),
    listAccounts: async (itemId: string) =>
      (await call<{ results?: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`)).results ?? [],
  };
}

export type PluggyClient = ReturnType<typeof createPluggyClient>;

function httpMessage(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return "A Pluggy recusou as credenciais. Confira o Client ID e o Client Secret na Vercel.";
    case 404:
      return "Conexão não encontrada na Pluggy. Confira o Item ID.";
    case 429:
      return "Muitas consultas à Pluggy. Tente de novo em alguns minutos.";
    default:
      return status >= 500 ? "A Pluggy está instável no momento. Tente mais tarde." : `A Pluggy recusou a consulta (HTTP ${status}).`;
  }
}
