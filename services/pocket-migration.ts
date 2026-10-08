import type { Account, ID, Pocket } from "@/domain/types";
import { AppError } from "@/repositories/supabase/errors";
import type { PocketCommands } from "./pocket-commands";

/**
 * MIGRAÇÃO dos cofrinhos ANTIGOS (`{ id, name, accountId, amountCents }`, que guardavam o saldo) para o modelo novo
 * (cofrinho + movimento inicial `reserve`; o saldo vira derivado do histórico).
 *
 * - IDEMPOTENTE: cada cofrinho antigo vira a referência `legacy:<id>`; importar de novo devolve o que já existe (no
 *   Supabase, `create_pocket` com `p_legacy_ref` garante o mesmo no banco). Nunca duplica a reserva.
 * - NÃO apaga a chave antiga do localStorage (somente leitura).
 * - RESPEITA O LASTRO: se o valor antigo não cabe no livre da conta, o cofrinho é criado SEM reserva e o relatório avisa
 *   quanto não pôde ser reservado (nada de reserva fictícia). Conta que não existe/não aceita cofrinho: não importa.
 */
export interface LegacyPocket {
  id: string;
  name: string;
  accountId: string;
  amountCents: number;
}

export interface PocketMigrationReport {
  /** Cofrinhos criados nesta execução (com a reserva antiga). */
  imported: number;
  /** Já importados antes (idempotência). */
  alreadyImported: number;
  /** Criados SEM a reserva antiga porque ela não cabe no livre da conta: o usuário precisa reservar de novo. */
  withoutReserve: { name: string; amountCents: number; reason: string }[];
  /** Não importados (conta inexistente/inválida, etc.). */
  failed: { name: string; reason: string }[];
  /** Quando rodou (ISO). */
  at: string;
}

const PREFIX = "finora:v1:";
/** Chave do armazenamento ANTIGO de cofrinhos (modo local). Nunca é apagada. */
export const LEGACY_LOCAL_POCKETS_KEY = `${PREFIX}pockets`;
/** Chaves do armazenamento NOVO (modo local). */
export const POCKET_STORE_NAME = "pockets-v2";
export const POCKET_MOVEMENT_STORE_NAME = "pocket-movements";

export const legacyRefOf = (legacyId: string) => `legacy:${legacyId}`;

const empty = (): PocketMigrationReport => ({ imported: 0, alreadyImported: 0, withoutReserve: [], failed: [], at: new Date().toISOString() });

/** Lê os cofrinhos antigos de uma chave do localStorage (somente leitura; ignora lixo). */
export function readLegacyPockets(storageKey: string): LegacyPocket[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is LegacyPocket =>
        !!p && typeof p.id === "string" && typeof p.name === "string" && typeof p.accountId === "string" && typeof p.amountCents === "number" && !("profileId" in p),
    );
  } catch {
    return [];
  }
}

export interface MigrationDeps {
  commands: PocketCommands;
  accounts: { list(): Promise<Account[]> };
  pockets: { list(): Promise<Pocket[]> };
}

export async function migrateLegacyPockets(legacy: LegacyPocket[], deps: MigrationDeps): Promise<PocketMigrationReport> {
  const report = empty();
  const [accounts, existing] = await Promise.all([deps.accounts.list(), deps.pockets.list()]);
  const have = new Set(existing.map((p) => p.legacyRef).filter((x): x is string => !!x));

  for (const old of legacy) {
    const ref = legacyRefOf(old.id);
    if (have.has(ref)) {
      report.alreadyImported++;
      continue;
    }
    const account = accounts.find((a) => a.id === old.accountId);
    if (!account) {
      report.failed.push({ name: old.name, reason: "A conta deste cofrinho não existe mais." });
      continue;
    }
    const base = { name: old.name, profileId: account.ownerProfileId as ID, accountId: account.id, legacyRef: ref };
    try {
      await deps.commands.create({ ...base, initialCents: Math.max(0, Math.round(old.amountCents)) });
      report.imported++;
    } catch (error) {
      if (error instanceof AppError && error.code === "insufficient_free") {
        // Sem lastro: cria o cofrinho vazio e avisa (a reserva antiga NÃO é recriada à força).
        try {
          await deps.commands.create({ ...base, initialCents: 0 });
          report.withoutReserve.push({ name: old.name, amountCents: old.amountCents, reason: error.message });
        } catch (second) {
          report.failed.push({ name: old.name, reason: second instanceof Error ? second.message : "Não foi possível importar." });
        }
      } else {
        report.failed.push({ name: old.name, reason: error instanceof Error ? error.message : "Não foi possível importar." });
      }
    }
  }
  return report;
}

/**
 * Modo LOCAL, ANTES da primeira carga (SEM importar nada): se há cofrinhos antigos e o armazenamento NOVO ainda não existe,
 * inicia o novo VAZIO (em vez de semear a demonstração por cima dos dados do usuário). A importação é uma AÇÃO EXPLÍCITA do
 * usuário (migrateLegacyPockets, pelo botão "Importar cofrinhos"); a chave antiga nunca é apagada.
 */
export function prepareLocalPockets(resetNewStores: () => void): void {
  if (readLegacyPockets(LEGACY_LOCAL_POCKETS_KEY).length > 0 && window.localStorage.getItem(`${PREFIX}${POCKET_STORE_NAME}`) === null) {
    resetNewStores();
  }
}
