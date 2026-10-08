import type { Repository } from "./types";

const PREFIX = "finora:v1:";

/**
 * Implementação em localStorage. Só toca `window.localStorage` dentro dos métodos,
 * que são chamados no navegador (efeitos/handlers) — nunca durante o SSR.
 * Na primeira leitura (chave ausente) grava o seed; depois disso o seed é ignorado.
 */
export class LocalStorageRepository<T extends { id: string }> implements Repository<T> {
  constructor(
    private readonly name: string,
    private readonly seed: () => T[],
    /** Migra registros gravados por versões antigas (deve ser idempotente). */
    private readonly normalize: (item: T) => T = (item) => item,
  ) {}

  private get key() {
    return PREFIX + this.name;
  }

  private read(): T[] {
    if (typeof window === "undefined") throw new Error("LocalStorageRepository só pode ser usado no navegador.");
    const raw = window.localStorage.getItem(this.key);
    if (raw === null) {
      const seeded = this.seed();
      this.write(seeded);
      return seeded;
    }
    try {
      return (JSON.parse(raw) as T[]).map(this.normalize);
    } catch {
      return [];
    }
  }

  private write(items: T[]) {
    window.localStorage.setItem(this.key, JSON.stringify(items));
  }

  /** Usado pelo WorkspaceAdmin local para zerar/restaurar. */
  replaceAll(items: T[]) {
    this.write(items);
  }

  async list() {
    return this.read();
  }

  async get(id: string) {
    return this.read().find((item) => item.id === id);
  }

  async create(input: Omit<T, "id">) {
    const item = { ...input, id: crypto.randomUUID() } as T;
    this.write([...this.read(), item]);
    return item;
  }

  async createMany(inputs: Omit<T, "id">[]) {
    const created = inputs.map((input) => ({ ...input, id: crypto.randomUUID() }) as T);
    this.write([...this.read(), ...created]);
    return created;
  }

  async update(id: string, patch: Partial<Omit<T, "id">>) {
    const items = this.read();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("Registro não encontrado.");
    const updated = { ...items[index], ...patch } as T;
    items[index] = updated;
    this.write(items);
    return updated;
  }

  async remove(id: string) {
    this.write(this.read().filter((item) => item.id !== id));
  }

  async removeMany(ids: string[]) {
    const set = new Set(ids);
    this.write(this.read().filter((item) => !set.has(item.id)));
  }
}
