import type { SupabaseClient } from "@supabase/supabase-js";
import type { Goal, Pocket, PocketMovement } from "@/domain/types";
import type { GoalRepository, PocketMovementQuery, PocketRepository } from "../types";
import { toFriendlyError } from "./errors";

type Row = Record<string, unknown>;

const orUndefined = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

export function pocketFromRow(row: Row): Pocket {
  return {
    id: row.id as string,
    name: row.name as string,
    description: orUndefined(row.description as string | null),
    icon: row.icon as string,
    color: row.color as string,
    profileId: row.profile_id as string,
    accountId: row.account_id as string,
    status: row.status as Pocket["status"],
    createdAt: row.created_at as string,
    legacyRef: orUndefined(row.legacy_ref as string | null),
  };
}

export function movementFromRow(row: Row): PocketMovement {
  return {
    id: row.id as string,
    pocketId: row.pocket_id as string,
    kind: row.kind as PocketMovement["kind"],
    amountCents: Number(row.amount_cents),
    date: row.movement_date as string,
    note: orUndefined(row.note as string | null),
    transactionId: orUndefined(row.transaction_id as string | null),
    transferGroupId: orUndefined(row.transfer_group_id as string | null),
    reversesId: orUndefined(row.reverses_id as string | null),
    createdAt: row.created_at as string,
  };
}

const MOVEMENTS_DEFAULT_LIMIT = 200;

/**
 * LEITURA de cofrinhos e do histórico (RLS: só o household do usuário). As escritas são RPCs
 * (SupabasePocketCommands): `pocket_movements` não tem privilégio de escrita para a API. O saldo vem de v_pocket_balances
 * (SupabaseFinanceReader), nunca daqui.
 */
export class SupabasePocketRepository implements PocketRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<Pocket[]> {
    const { data, error } = await this.client
      .from("pockets")
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw toFriendlyError(error);
    return (data as Row[]).map(pocketFromRow);
  }

  async get(id: string): Promise<Pocket | undefined> {
    const { data, error } = await this.client.from("pockets").select("*").eq("id", id).maybeSingle();
    if (error) throw toFriendlyError(error);
    return data ? pocketFromRow(data as Row) : undefined;
  }

  async movements(query: PocketMovementQuery = {}): Promise<PocketMovement[]> {
    let q = this.client.from("pocket_movements").select("*");
    if (query.pocketId) q = q.eq("pocket_id", query.pocketId);
    if (query.kinds) q = q.in("kind", query.kinds);
    const { data, error } = await q
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(query.limit ?? MOVEMENTS_DEFAULT_LIMIT);
    if (error) throw toFriendlyError(error);
    return (data as Row[]).map(movementFromRow);
  }
}

export function goalFromRow(row: Row): Goal {
  return {
    id: row.id as string,
    name: row.name as string,
    description: orUndefined(row.description as string | null),
    kind: row.kind as Goal["kind"],
    targetCents: Number(row.target_cents),
    deadline: orUndefined(row.deadline as string | null),
    profileId: row.profile_id as string,
    icon: row.icon as string,
    color: row.color as string,
    status: row.status as Goal["status"],
    pocketId: orUndefined(row.pocket_id as string | null),
    manualAmountCents: Number(row.manual_amount_cents),
  };
}

const GOAL_COLUMNS: { key: keyof Goal; column: string; nullable?: boolean }[] = [
  { key: "name", column: "name" },
  { key: "description", column: "description", nullable: true },
  { key: "kind", column: "kind" },
  { key: "targetCents", column: "target_cents" },
  { key: "deadline", column: "deadline", nullable: true },
  { key: "profileId", column: "profile_id" },
  { key: "icon", column: "icon" },
  { key: "color", column: "color" },
  { key: "status", column: "status" },
  { key: "pocketId", column: "pocket_id", nullable: true },
  { key: "manualAmountCents", column: "manual_amount_cents" },
];

/** Só as chaves PRESENTES; `undefined` num campo opcional limpa a coluna (NULL). */
function goalColumns(source: object): Row {
  const out: Row = {};
  for (const { key, column, nullable } of GOAL_COLUMNS) {
    if (!(key in source)) continue;
    const value = (source as Row)[key];
    out[column] = value === undefined && nullable ? null : value;
  }
  return out;
}

/**
 * CRUD de OBJETIVOS sobre o Supabase (RLS). Objetivos não movimentam dinheiro, então não precisam de RPC. Ligar um
 * cofrinho passa por `PocketCommands.linkGoal` (RPC link_goal_pocket).
 */
export class SupabaseGoalRepository implements GoalRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly householdId: string,
  ) {}

  private get table() {
    return this.client.from("goals");
  }

  async list(): Promise<Goal[]> {
    const { data, error } = await this.table.select("*").order("created_at", { ascending: true }).order("id", { ascending: true });
    if (error) throw toFriendlyError(error);
    return (data as Row[]).map(goalFromRow);
  }

  async get(id: string): Promise<Goal | undefined> {
    const { data, error } = await this.table.select("*").eq("id", id).maybeSingle();
    if (error) throw toFriendlyError(error);
    return data ? goalFromRow(data as Row) : undefined;
  }

  async create(input: Omit<Goal, "id">): Promise<Goal> {
    const { data, error } = await this.table
      .insert({ ...goalColumns(input), household_id: this.householdId })
      .select("*")
      .single();
    if (error) throw toFriendlyError(error);
    return goalFromRow(data as Row);
  }

  async createMany(inputs: Omit<Goal, "id">[]): Promise<Goal[]> {
    if (inputs.length === 0) return [];
    const { data, error } = await this.table.insert(inputs.map((i) => ({ ...goalColumns(i), household_id: this.householdId }))).select("*");
    if (error) throw toFriendlyError(error);
    return (data as Row[]).map(goalFromRow);
  }

  async update(id: string, patch: Partial<Omit<Goal, "id">>): Promise<Goal> {
    const { data, error } = await this.table.update(goalColumns(patch)).eq("id", id).select("*").single();
    if (error) throw toFriendlyError(error);
    return goalFromRow(data as Row);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.table.delete().eq("id", id);
    if (error) throw toFriendlyError(error);
  }

  async removeMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.table.delete().in("id", ids);
    if (error) throw toFriendlyError(error);
  }
}
