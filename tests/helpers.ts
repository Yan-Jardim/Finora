import type { Account, CreditCard, FinancialProfile, Transaction, WorkspaceData } from "@/domain/types";
import { LocalStorageRepository } from "@/repositories/local-storage-repository";
import { normalizeTransaction } from "@/domain/legacy";
import type { Debt, Goal, InstallmentPurchase, Pocket, PocketMovement, RecurringTransaction } from "@/domain/types";

export const TODAY = "2026-10-06";

export const yan: FinancialProfile = { id: "p-yan", name: "Yan", color: "#4f46e5", kind: "individual", active: true };
export const camila: FinancialProfile = { id: "p-camila", name: "Camila", color: "#db2777", kind: "individual", active: true };
export const casal: FinancialProfile = { id: "p-casal", name: "Casal", color: "#0d9488", kind: "shared", active: true };

const account = (id: string, ownerProfileId: string, over: Partial<Account> = {}): Account => ({
  id,
  name: id,
  ownerProfileId,
  type: "checking",
  initialBalanceCents: 100000, // R$ 1.000,00
  color: "#000000",
  icon: "landmark",
  includeInNetWorth: true,
  active: true,
  ...over,
});

export const nubank = account("a-nubank", yan.id);
export const mercadoPago = account("a-mp", yan.id, { initialBalanceCents: 0 });
export const santander = account("a-santander", camila.id);
export const invest = account("a-invest", yan.id, { type: "investment", initialBalanceCents: 500000 });

/** Fecha dia 20, vence dia 27. */
export const card: CreditCard = {
  id: "c-1",
  name: "Cartão Teste",
  accountId: nubank.id,
  ownerProfileId: yan.id,
  limitCents: 500000,
  closingDay: 20,
  dueDay: 27,
  color: "#000000",
  active: true,
};

let seq = 0;
export const tx = (over: Partial<Transaction>): Transaction => ({
  id: `t-${++seq}`,
  kind: "expense",
  description: "Teste",
  amountCents: 10000,
  date: TODAY,
  status: "paid",
  tags: [],
  profileId: yan.id,
  ...over,
});

export const workspace = (over: Partial<WorkspaceData> = {}): WorkspaceData => ({
  profiles: [yan, camila, casal],
  categories: [],
  accounts: [nubank, mercadoPago, santander, invest],
  creditCards: [card],
  transactions: [],
  installmentPurchases: [],
  recurringTransactions: [],
  debts: [],
  pockets: [],
  pocketMovements: [],
  goals: [],
  ...over,
});

// ---------- localStorage falso (para testar persistência sem navegador) ----------

export function installFakeStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  };
  return store;
}

/** Cria repositórios novos sobre o MESMO storage — equivale a recarregar a página. */
export function createRepos(seed: { transactions?: Transaction[]; accounts?: Account[]; profiles?: FinancialProfile[] } = {}) {
  return {
    accounts: new LocalStorageRepository<Account>("accounts", () => seed.accounts ?? []),
    profiles: new LocalStorageRepository<FinancialProfile>("profiles", () => seed.profiles ?? []),
    pockets: new LocalStorageRepository<Pocket>("pockets-v2", () => []),
    pocketMovements: new LocalStorageRepository<PocketMovement>("pocket-movements", () => []),
    goals: new LocalStorageRepository<Goal>("goals", () => []),
    transactions: new LocalStorageRepository<Transaction>("transactions", () => seed.transactions ?? [], normalizeTransaction),
    installmentPurchases: new LocalStorageRepository<InstallmentPurchase>("installment-purchases", () => []),
    recurring: new LocalStorageRepository<RecurringTransaction>("recurring", () => []),
    debts: new LocalStorageRepository<Debt>("debts", () => []),
  };
}
