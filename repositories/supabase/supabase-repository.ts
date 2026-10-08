import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account, Category, CreditCard, FinancialProfile } from "@/domain/types";
import { toFriendlyError } from "./errors";
import { accountMapper, categoryMapper, creditCardMapper, profileMapper, type EntityMapper } from "./mappers";
import type { Repository } from "../types";

type Row = Record<string, unknown>;

/**
 * Implementação do contrato Repository<T> sobre o Supabase. Quem restringe o acesso é o RLS:
 * o app usa só a chave publishable + a sessão do usuário (nunca service_role).
 * Todas as operações vão para o household informado (household_id é obrigatório nos inserts).
 */
export class SupabaseRepository<T extends { id: string }> implements Repository<T> {
  constructor(
    private readonly client: SupabaseClient,
    private readonly householdId: string,
    private readonly mapper: EntityMapper<T>,
  ) {}

  private get table() {
    return this.client.from(this.mapper.table);
  }

  async list(): Promise<T[]> {
    // created_at + id: ordem estável e igual à de criação (inclusive no seed de categorias).
    const { data, error } = await this.table
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw toFriendlyError(error);
    return (data as Row[]).map((row) => this.mapper.fromRow(row));
  }

  async get(id: string): Promise<T | undefined> {
    const { data, error } = await this.table.select("*").eq("id", id).maybeSingle();
    if (error) throw toFriendlyError(error);
    return data ? this.mapper.fromRow(data as Row) : undefined;
  }

  async create(input: Omit<T, "id">): Promise<T> {
    const { data, error } = await this.table
      .insert(this.mapper.toInsert(input, this.householdId))
      .select("*")
      .single();
    if (error) throw toFriendlyError(error);
    return this.mapper.fromRow(data as Row);
  }

  async createMany(inputs: Omit<T, "id">[]): Promise<T[]> {
    if (inputs.length === 0) return [];
    const { data, error } = await this.table
      .insert(inputs.map((input) => this.mapper.toInsert(input, this.householdId)))
      .select("*");
    if (error) throw toFriendlyError(error);
    return (data as Row[]).map((row) => this.mapper.fromRow(row));
  }

  async update(id: string, patch: Partial<Omit<T, "id">>): Promise<T> {
    const { data, error } = await this.table.update(this.mapper.toPatch(patch)).eq("id", id).select("*").single();
    if (error) throw toFriendlyError(error);
    return this.mapper.fromRow(data as Row);
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

// Classes nomeadas (o ponto único de troca em repositories/index.ts as instancia).
export class SupabaseProfileRepository extends SupabaseRepository<FinancialProfile> {
  constructor(client: SupabaseClient, householdId: string) {
    super(client, householdId, profileMapper);
  }
}

export class SupabaseCategoryRepository extends SupabaseRepository<Category> {
  constructor(client: SupabaseClient, householdId: string) {
    super(client, householdId, categoryMapper);
  }
}

export class SupabaseAccountRepository extends SupabaseRepository<Account> {
  constructor(client: SupabaseClient, householdId: string) {
    super(client, householdId, accountMapper);
  }
}

export class SupabaseCreditCardRepository extends SupabaseRepository<CreditCard> {
  constructor(client: SupabaseClient, householdId: string) {
    super(client, householdId, creditCardMapper);
  }
}

/** Categorias iniciais para households que ainda não têm nenhuma (RPC idempotente, respeita RLS). */
export async function seedDefaultCategories(client: SupabaseClient, householdId: string): Promise<number> {
  const { data, error } = await client.rpc("seed_default_categories", { p_household_id: householdId });
  if (error) throw toFriendlyError(error);
  return Number(data ?? 0);
}
