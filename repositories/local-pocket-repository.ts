import type { Pocket, PocketMovement } from "@/domain/types";
import type { LocalStorageRepository } from "./local-storage-repository";
import type { PocketMovementQuery, PocketRepository } from "./types";

/**
 * LEITURA de cofrinhos no modo local, sobre dois armazenamentos (cadastro e histórico). As escritas NÃO passam por aqui:
 * o motor local (services/local-pocket.ts) usa os armazenamentos diretamente, como o banco só deixa escrever por RPC.
 */
export class LocalPocketRepository implements PocketRepository {
  constructor(
    readonly pocketStore: LocalStorageRepository<Pocket>,
    readonly movementStore: LocalStorageRepository<PocketMovement>,
  ) {}

  list() {
    return this.pocketStore.list();
  }

  get(id: string) {
    return this.pocketStore.get(id);
  }

  /** Mesmo critério do banco: data e instante de criação, mais recente primeiro. */
  async movements(query: PocketMovementQuery = {}): Promise<PocketMovement[]> {
    const all = await this.movementStore.list();
    return all
      .filter((m) => !query.pocketId || m.pocketId === query.pocketId)
      .filter((m) => !query.kinds || query.kinds.includes(m.kind))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, query.limit ?? 200);
  }
}
