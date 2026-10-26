"use server";

import { unstable_rethrow } from "next/navigation";
import { requireHousehold } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { toFriendlyError } from "@/repositories/supabase/errors";
import { bankConnectionSchema, type BankConnectionFormValues } from "@/schemas/bank-connection";
import { configuredCredentialKeys, credentialsFor } from "./credentials";
import { createPluggyClient } from "./pluggy";
import { fetchConnections, isStale, itemStatusNotice } from "./sync";

/**
 * Server Actions do Open Finance. Rodam só no servidor, com a sessão de quem chamou (o RLS vale para tudo);
 * as credenciais da Pluggy vêm de variáveis de ambiente e nunca são devolvidas ao navegador.
 * Devolvem { ok, error } em vez de lançar: em produção o Next esconde a mensagem de erros lançados.
 */

export interface BankBalanceView {
  id: string;
  name: string;
  type: "BANK" | "CREDIT";
  number: string | null;
  balanceCents: number;
  creditLimitCents: number | null;
  availableLimitCents: number | null;
  currency: string;
  accountId: string | null;
  syncedAt: string;
}

export interface BankConnectionView {
  id: string;
  ownerProfileId: string;
  credentialKey: string;
  itemId: string;
  institution: string | null;
  status: string | null;
  statusNotice: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  balances: BankBalanceView[];
}

export interface OpenFinanceState {
  connections: BankConnectionView[];
  /** Chaves com credenciais configuradas no servidor (só os nomes). */
  credentialKeys: string[];
}

export type ActionResult = { ok: true; state: OpenFinanceState } | { ok: false; error: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

const fail = (error: unknown): ActionResult => {
  // Sessão expirada: requireHousehold redireciona para o login, e esse redirect do Next não pode ser engolido aqui.
  unstable_rethrow(error);
  const message =
    error && typeof error === "object" && "message" in error
      ? toFriendlyError(error as { message: string; code?: string }).message
      : "Não foi possível concluir. Tente novamente.";
  return { ok: false, error: message };
};

async function loadState(supabase: Supabase): Promise<OpenFinanceState> {
  const [{ data: connections, error }, { data: balances, error: balancesError }] = await Promise.all([
    supabase.from("bank_connections").select("*").order("created_at"),
    supabase.from("bank_balances").select("*").order("type").order("name"),
  ]);
  if (error) throw error;
  if (balancesError) throw balancesError;

  return {
    credentialKeys: configuredCredentialKeys(),
    connections: (connections ?? []).map((c) => ({
      id: c.id,
      ownerProfileId: c.owner_profile_id,
      credentialKey: c.credential_key,
      itemId: c.item_id,
      institution: c.institution,
      status: c.status,
      statusNotice: itemStatusNotice(c.status),
      lastSyncedAt: c.last_synced_at,
      lastError: c.last_error,
      balances: (balances ?? [])
        .filter((b) => b.connection_id === c.id)
        .map((b) => ({
          id: b.id,
          name: b.name,
          type: b.type === "CREDIT" ? "CREDIT" : "BANK",
          number: b.number,
          balanceCents: b.balance_cents,
          creditLimitCents: b.credit_limit_cents,
          availableLimitCents: b.available_limit_cents,
          currency: b.currency,
          accountId: b.account_id,
          syncedAt: b.synced_at,
        })),
    })),
  };
}

/** Lê as conexões na Pluggy e grava cada resultado numa única RPC (atômica por conexão). */
async function syncConnections(supabase: Supabase, ids?: string[], onlyStale = false) {
  const { data, error } = await supabase.from("bank_connections").select("id, credential_key, item_id, last_synced_at");
  if (error) throw error;
  const now = new Date();
  const targets = (data ?? []).filter(
    (c) => (!ids || ids.includes(c.id)) && (!onlyStale || isStale(c.last_synced_at, now)),
  );
  if (targets.length === 0) return;

  const results = await fetchConnections(
    targets.map((c) => ({ id: c.id, credentialKey: c.credential_key, itemId: c.item_id })),
    (key) => {
      const credentials = credentialsFor(key);
      return credentials ? createPluggyClient(credentials) : null;
    },
  );
  for (const result of results) {
    const { error: rpcError } = await supabase.rpc("record_bank_sync", {
      p_connection_id: result.connectionId,
      p_status: result.status,
      p_institution: result.institution ?? undefined,
      p_error: result.error ?? undefined,
      p_accounts: result.accounts as unknown as Json,
    });
    if (rpcError) throw rpcError;
  }
}

export async function getOpenFinanceState(): Promise<ActionResult> {
  try {
    await requireHousehold();
    return { ok: true, state: await loadState(await createClient()) };
  } catch (error) {
    return fail(error);
  }
}

/** `onlyStale`: atualização automática ao abrir a tela (só conexões sem leitura nas últimas horas). */
export async function syncBankConnections(options: { onlyStale?: boolean } = {}): Promise<ActionResult> {
  try {
    await requireHousehold();
    const supabase = await createClient();
    await syncConnections(supabase, undefined, options.onlyStale);
    return { ok: true, state: await loadState(supabase) };
  } catch (error) {
    return fail(error);
  }
}

export async function addBankConnection(values: BankConnectionFormValues): Promise<ActionResult> {
  const parsed = bankConnectionSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  if (!configuredCredentialKeys().includes(parsed.data.credentialKey)) {
    return { ok: false, error: "Essas credenciais não estão configuradas no servidor." };
  }
  try {
    const { householdId } = await requireHousehold();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("bank_connections")
      .insert({
        household_id: householdId,
        owner_profile_id: parsed.data.ownerProfileId,
        credential_key: parsed.data.credentialKey,
        item_id: parsed.data.itemId,
      })
      .select("id")
      .single();
    if (error) throw error;
    // Primeira leitura já na conexão: se o Item ID estiver errado, o aviso aparece na hora.
    await syncConnections(supabase, [data.id]);
    return { ok: true, state: await loadState(supabase) };
  } catch (error) {
    return fail(error);
  }
}

export async function removeBankConnection(id: string): Promise<ActionResult> {
  try {
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.from("bank_connections").delete().eq("id", id);
    if (error) throw error;
    return { ok: true, state: await loadState(supabase) };
  } catch (error) {
    return fail(error);
  }
}

/** Liga (ou desliga, com null) um saldo do banco a uma conta do Finora, só para comparar. */
export async function linkBankBalance(balanceId: string, accountId: string | null): Promise<ActionResult> {
  try {
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.from("bank_balances").update({ account_id: accountId }).eq("id", balanceId);
    if (error) throw error;
    return { ok: true, state: await loadState(supabase) };
  } catch (error) {
    return fail(error);
  }
}
