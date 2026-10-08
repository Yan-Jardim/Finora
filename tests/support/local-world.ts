import { buildReport, defaultFilters } from "@/domain/reports";
import { periodFor } from "@/domain/report-periods";
import { snapshotBalance, snapshotOf } from "@/domain/snapshot";
import type { Category, InstallmentPurchase, Transaction, WorkspaceData } from "@/domain/types";
import { LocalStorageRepository } from "@/repositories/local-storage-repository";
import { LocalDebtCommands } from "@/services/local-debt";
import { LocalPocketCommands } from "@/services/local-pocket";
import { LocalRecurrenceCommands } from "@/services/local-recurrence";
import { LocalTransactionCommands } from "@/services/local-transaction-commands";
import { ALL_PROFILES, buildDashboard } from "@/services/dashboard-service";
import { card, createRepos, installFakeStorage, invest, camila, mercadoPago, nubank, santander, TODAY, workspace, yan, casal } from "../helpers";

/** "Mundo" do motor local para testes de regra: repositórios + comandos + leituras derivadas (saldo, dashboard, relatório). */
export const CAT = "mercado";
export const categories: Category[] = [
  { id: CAT, name: "Mercado", icon: "more", color: "#111111", kind: "expense", active: true },
  { id: "salario", name: "Salário", icon: "more", color: "#222222", kind: "income", active: true },
];
export const ACCOUNTS = [nubank, mercadoPago, santander, invest];

export function world() {
  installFakeStorage();
  const repos = createRepos({ accounts: ACCOUNTS, profiles: [yan, camila, casal] });
  const ip = new LocalStorageRepository<InstallmentPurchase>("installment-purchases", () => []);
  const full = { ...repos, installmentPurchases: ip, recurring: repos.recurring };
  let current: WorkspaceData = workspace();
  const ctx = { today: () => TODAY, data: () => current };
  const tx = new LocalTransactionCommands(full, ctx);
  const debts = new LocalDebtCommands(full, { today: () => TODAY });
  const recurrence = new LocalRecurrenceCommands(full, { today: () => TODAY });
  const pocket = new LocalPocketCommands(
    { pockets: repos.pockets, pocketMovements: repos.pocketMovements, goals: repos.goals, accounts: repos.accounts, profiles: repos.profiles, transactions: repos.transactions },
    { today: () => TODAY },
  );
  const load = async () => {
    current = workspace({
      categories,
      accounts: await repos.accounts.list(),
      transactions: await repos.transactions.list(),
      installmentPurchases: await ip.list(),
      recurringTransactions: await repos.recurring.list(),
      debts: await repos.debts.list(),
      pockets: await repos.pockets.list(),
      pocketMovements: await repos.pocketMovements.list(),
      goals: await repos.goals.list(),
    });
    return current;
  };
  const snap = async () => snapshotOf(await load(), TODAY);
  const dash = async () => buildDashboard(await load(), { profileId: ALL_PROFILES, month: TODAY.slice(0, 7) }, "Yan", TODAY);
  const report = async (over = {}) => buildReport({ data: await load(), pocketMovements: current.pocketMovements, today: TODAY }, { ...defaultFilters(periodFor("month", TODAY)), ...over });
  const netWorth = async () => (await report()).netWorth.financialCents;
  const balance = async (id: string) => {
    const data = await load();
    return snapshotBalance(snapshotOf(data, TODAY), data.accounts.find((a) => a.id === id)!);
  };
  return { repos, tx, debts, recurrence, pocket, load, snap, dash, report, netWorth, balance, data: () => current };
}

export const expense = (over: Partial<Omit<Transaction, "id">> = {}): Omit<Transaction, "id"> => ({
  kind: "expense", description: "Despesa", amountCents: 10000, date: TODAY, status: "paid", paidAt: TODAY, tags: [], profileId: yan.id, accountId: nubank.id, categoryId: CAT, ...over,
});
export const purchase = (over: Partial<Omit<Transaction, "id">> = {}) => expense({ kind: "credit_card_purchase", status: "pending", paidAt: undefined, accountId: undefined, cardId: card.id, date: "2026-10-03", ...over });

