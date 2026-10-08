import type { Account, Category, CreditCard, FinancialProfile } from "@/domain/types";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Mapeamento domínio (camelCase, "active") <-> linhas do banco (snake_case, "is_active").
 * Puro e sem I/O: coberto por testes. Dinheiro continua em centavos (bigint no banco).
 */

type Tables = Database["public"]["Tables"];
type Row = Record<string, unknown>;

interface Field {
  /** Chave no objeto de domínio. */
  key: string;
  /** Coluna no banco. */
  column: string;
  /** Campo opcional no domínio: `undefined` vira NULL ao gravar. */
  nullable?: boolean;
}

export interface EntityMapper<T extends { id: string }> {
  /** Tabela no schema public. */
  table: "financial_profiles" | "categories" | "accounts" | "credit_cards";
  fromRow(row: Row): T;
  /** Linha para INSERT (inclui household_id). */
  toInsert(input: Omit<T, "id">, householdId: string): Row;
  /** Colunas para UPDATE (somente as chaves presentes no patch). */
  toPatch(patch: Partial<Omit<T, "id">>): Row;
}

/** Converte apenas as chaves PRESENTES: `{ institution: undefined }` limpa a coluna (NULL). */
function toColumns(source: object, fields: Field[]): Row {
  const out: Row = {};
  for (const { key, column, nullable } of fields) {
    if (!(key in source)) continue;
    const value = (source as Row)[key];
    out[column] = value === undefined && nullable ? null : value;
  }
  return out;
}

function mapper<T extends { id: string }>(
  table: EntityMapper<T>["table"],
  fields: Field[],
  fromRow: (row: Row) => T,
): EntityMapper<T> {
  return {
    table,
    fromRow,
    toInsert: (input, householdId) => ({ ...toColumns(input, fields), household_id: householdId }),
    toPatch: (patch) => toColumns(patch, fields),
  };
}

type ProfileRow = Tables["financial_profiles"]["Row"];
export const profileMapper = mapper<FinancialProfile>(
  "financial_profiles",
  [
    { key: "name", column: "name" },
    { key: "kind", column: "kind" },
    { key: "color", column: "color" },
    { key: "active", column: "is_active" },
    { key: "avatarUrl", column: "avatar_url", nullable: true },
  ],
  (r) => {
    const row = r as unknown as ProfileRow;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      color: row.color,
      active: row.is_active,
      avatarUrl: row.avatar_url ?? undefined,
    };
  },
);

type CategoryRow = Tables["categories"]["Row"];
export const categoryMapper = mapper<Category>(
  "categories",
  [
    { key: "name", column: "name" },
    { key: "kind", column: "kind" },
    { key: "icon", column: "icon" },
    { key: "color", column: "color" },
    { key: "active", column: "is_active" },
    { key: "parentId", column: "parent_id", nullable: true },
  ],
  (r) => {
    const row = r as unknown as CategoryRow;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      icon: row.icon,
      color: row.color,
      active: row.is_active,
      parentId: row.parent_id ?? undefined,
    };
  },
);

type AccountRow = Tables["accounts"]["Row"];
export const accountMapper = mapper<Account>(
  "accounts",
  [
    { key: "name", column: "name" },
    { key: "institution", column: "institution", nullable: true },
    { key: "ownerProfileId", column: "owner_profile_id" },
    { key: "type", column: "type" },
    { key: "initialBalanceCents", column: "initial_balance_cents" },
    { key: "color", column: "color" },
    { key: "icon", column: "icon" },
    { key: "includeInNetWorth", column: "include_in_net_worth" },
    { key: "active", column: "is_active" },
  ],
  (r) => {
    const row = r as unknown as AccountRow;
    return {
      id: row.id,
      name: row.name,
      institution: row.institution ?? undefined,
      ownerProfileId: row.owner_profile_id,
      type: row.type,
      initialBalanceCents: Number(row.initial_balance_cents),
      color: row.color,
      icon: row.icon,
      includeInNetWorth: row.include_in_net_worth,
      active: row.is_active,
    };
  },
);

type CardRow = Tables["credit_cards"]["Row"];
export const creditCardMapper = mapper<CreditCard>(
  "credit_cards",
  [
    { key: "name", column: "name" },
    { key: "ownerProfileId", column: "owner_profile_id" },
    { key: "accountId", column: "payment_account_id", nullable: true },
    { key: "brand", column: "brand", nullable: true },
    { key: "limitCents", column: "limit_cents" },
    { key: "closingDay", column: "closing_day" },
    { key: "dueDay", column: "due_day" },
    { key: "last4", column: "last4", nullable: true },
    { key: "color", column: "color" },
    { key: "active", column: "is_active" },
  ],
  (r) => {
    const row = r as unknown as CardRow;
    return {
      id: row.id,
      name: row.name,
      ownerProfileId: row.owner_profile_id,
      accountId: row.payment_account_id ?? undefined,
      brand: row.brand ?? undefined,
      limitCents: Number(row.limit_cents),
      closingDay: row.closing_day,
      dueDay: row.due_day,
      last4: row.last4 ?? undefined,
      color: row.color,
      active: row.is_active,
    };
  },
);
