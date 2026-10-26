import { PluggyError, type PluggyAccount, type PluggyClient } from "./pluggy";

/**
 * Regras puras da sincronização de saldos (sem I/O próprio): o que buscar, como converter e o que gravar.
 * A gravação é uma única RPC por conexão (record_bank_sync), feita por quem chama.
 */

export interface ConnectionToSync {
  id: string;
  credentialKey: string;
  itemId: string;
}

export interface BalanceRow {
  external_account_id: string;
  name: string;
  type: "BANK" | "CREDIT";
  subtype: string | null;
  number: string | null;
  balance_cents: number;
  credit_limit_cents: number | null;
  available_limit_cents: number | null;
  currency: string;
}

export interface ConnectionSyncResult {
  connectionId: string;
  status: string;
  institution: string | null;
  /** Mensagem amigável quando não deu para ler o banco; os últimos saldos bons continuam valendo. */
  error: string | null;
  accounts: BalanceRow[];
}

/** Atualização automática: a Pluggy atualiza a cada 24 h, então reler antes de 12 h quase nunca traz novidade. */
export const AUTO_SYNC_AFTER_HOURS = 12;

const toCents = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? null : Math.round(value * 100);

export function toBalanceRow(account: PluggyAccount): BalanceRow {
  return {
    external_account_id: account.id,
    name: (account.marketingName || account.name || "Conta").slice(0, 120),
    type: account.type === "CREDIT" ? "CREDIT" : "BANK",
    subtype: account.subtype ?? null,
    number: account.number ?? null,
    balance_cents: toCents(account.balance) ?? 0,
    credit_limit_cents: toCents(account.creditData?.creditLimit),
    available_limit_cents: toCents(account.creditData?.availableCreditLimit),
    currency: /^[A-Z]{3}$/.test(account.currencyCode ?? "") ? account.currencyCode! : "BRL",
  };
}

/** Status do item na Pluggy -> aviso para a tela (null = tudo certo). */
export function itemStatusNotice(status: string | null | undefined): string | null {
  switch (status) {
    case null:
    case undefined:
    case "UPDATED":
    case "UPDATING":
      return null;
    case "LOGIN_ERROR":
    case "WAITING_USER_INPUT":
      return "O banco pede uma nova autorização. Renove o consentimento no Meu Pluggy.";
    case "OUTDATED":
      return "A última atualização no banco falhou; o saldo pode estar desatualizado.";
    default:
      return `Status na Pluggy: ${status}.`;
  }
}

export function isStale(lastSyncedAt: string | null, now: Date, hours = AUTO_SYNC_AFTER_HOURS): boolean {
  if (!lastSyncedAt) return true;
  const last = new Date(lastSyncedAt).getTime();
  return Number.isNaN(last) || now.getTime() - last >= hours * 3_600_000;
}

/**
 * Lê cada conexão na Pluggy. Uma conexão com problema não derruba as outras: vira um resultado com `error`.
 * `clientFor` devolve null quando a credencial não está configurada no servidor.
 */
export async function fetchConnections(
  connections: ConnectionToSync[],
  clientFor: (credentialKey: string) => PluggyClient | null,
): Promise<ConnectionSyncResult[]> {
  const clients = new Map<string, PluggyClient | null>();
  const results: ConnectionSyncResult[] = [];

  for (const connection of connections) {
    if (!clients.has(connection.credentialKey)) clients.set(connection.credentialKey, clientFor(connection.credentialKey));
    const client = clients.get(connection.credentialKey);
    if (!client) {
      results.push({
        connectionId: connection.id,
        status: "NOT_CONFIGURED",
        institution: null,
        error: `Credenciais "${connection.credentialKey}" não configuradas no servidor.`,
        accounts: [],
      });
      continue;
    }
    try {
      const item = await client.getItem(connection.itemId);
      const accounts = await client.listAccounts(connection.itemId);
      results.push({
        connectionId: connection.id,
        status: item.status,
        institution: item.connector?.name ?? null,
        error: null,
        accounts: accounts.map(toBalanceRow),
      });
    } catch (error) {
      results.push({
        connectionId: connection.id,
        status: "ERROR",
        institution: null,
        error: error instanceof PluggyError ? error.message : "Não foi possível ler este banco agora.",
        accounts: [],
      });
    }
  }
  return results;
}
