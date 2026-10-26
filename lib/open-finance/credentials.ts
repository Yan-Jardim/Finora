import type { PluggyCredentials } from "./pluggy";

/**
 * Credenciais da Pluggy por pessoa, lidas de variáveis de ambiente do servidor (nunca do banco nem do navegador):
 *   PLUGGY_<CHAVE>_CLIENT_ID e PLUGGY_<CHAVE>_CLIENT_SECRET   (ex.: PLUGGY_YAN_CLIENT_ID)
 * O banco guarda só a <chave> em minúsculas (bank_connections.credential_key).
 */

type Env = Record<string, string | undefined>;

const PATTERN = /^PLUGGY_([A-Z][A-Z0-9_]{0,29})_CLIENT_ID$/;

export function credentialsFor(key: string, env: Env = process.env): PluggyCredentials | null {
  const upper = key.toUpperCase();
  const clientId = env[`PLUGGY_${upper}_CLIENT_ID`]?.trim();
  const clientSecret = env[`PLUGGY_${upper}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Chaves com o par completo configurado (só os nomes; os valores nunca saem do servidor). */
export function configuredCredentialKeys(env: Env = process.env): string[] {
  return Object.keys(env)
    .map((name) => PATTERN.exec(name)?.[1])
    .filter((key): key is string => !!key)
    .map((key) => key.toLowerCase())
    .filter((key) => credentialsFor(key, env) !== null)
    .sort();
}
