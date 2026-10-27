import type { PluggyAccount } from "./pluggy";

/**
 * Nome do banco de uma conexão. Pelo Meu Pluggy o conector se chama "MeuPluggy" para todos os bancos, então o nome
 * vem do código COMPE no número de transferência da conta ("341/7471/00089066-0" -> Itaú).
 */
const BANKS_BY_CODE: Record<string, string> = {
  "001": "Banco do Brasil",
  "033": "Santander",
  "077": "Inter",
  "104": "Caixa",
  "208": "BTG Pactual",
  "212": "Banco Original",
  "237": "Bradesco",
  "260": "Nubank",
  "290": "PagBank",
  "323": "Mercado Pago",
  "336": "C6 Bank",
  "341": "Itaú",
  "380": "PicPay",
  "403": "Cora",
  "748": "Sicredi",
  "756": "Sicoob",
};

/** Nome genérico do agregador (ou ausente): não serve como nome do banco. */
export const isAggregatorName = (name: string | null | undefined) => !name || /pluggy/i.test(name);

export function institutionName(connectorName: string | null | undefined, accounts: PluggyAccount[]): string | null {
  if (!isAggregatorName(connectorName)) return connectorName ?? null;
  for (const account of accounts) {
    const code = account.bankData?.transferNumber?.split("/")[0]?.trim().padStart(3, "0");
    if (code && BANKS_BY_CODE[code]) return BANKS_BY_CODE[code];
  }
  const first = accounts.find((a) => a.type === "BANK") ?? accounts[0];
  return first ? (first.marketingName || first.name).replace(/\s*\(.*\)\s*$/, "").slice(0, 80) : (connectorName ?? null);
}
