import type { Repository } from "@/repositories/types";
import { LocalAccountRepository } from "@/repositories/local-account-repository";
/**
 * Harness dos TESTES DE PARIDADE: monta os dois "lados" (motor LOCAL com localStorage falso x SUPABASE REAL com o
 * usuário descartável) e extrai métricas comparáveis. Integração: só roda com credenciais de um usuário @test.invalid
 * em `.env.e2e.local` (E2E_EMAIL/E2E_PASSWORD) + `.env.local` (URL e chave publishable); sem elas, ENABLED = false.
 *
 * O household "Casa Paridade" criado aqui é removido ao final (cascata), com a sessão do próprio usuário descartável —
 * nunca service_role, nunca a conta pessoal.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cardSummaryFrom, monthBreakdown, yearMonth } from "@/domain/calculations";
import { addMonths, monthEnd, monthStart, todayInZone } from "@/domain/dates";
import { goalProgress } from "@/domain/pockets";
import { snapshotBalance, snapshotCardInvoices, snapshotFree, snapshotOf, snapshotPocketBalance, snapshotReserved, snapshotUsedLimit } from "@/domain/snapshot";
import type { Account, Category, CreditCard, FinancialProfile, Goal, PocketMovement, Transaction, WorkspaceData } from "@/domain/types";
import { createDataSource, type DataSource } from "@/repositories";
import { loadWorkspace } from "@/repositories/load-workspace";
import { ALL_PROFILES, buildDashboard } from "@/services/dashboard-service";
import type { DebtCommands } from "@/services/debt-commands";
import { LocalDebtCommands } from "@/services/local-debt";
import { LocalPocketCommands } from "@/services/local-pocket";
import type { PocketCommands } from "@/services/pocket-commands";
import { LocalRecurrenceCommands } from "@/services/local-recurrence";
import { LocalTransactionCommands } from "@/services/local-transaction-commands";
import type { RecurrenceCommands } from "@/services/recurrence-commands";
import type { TransactionCommands } from "@/services/transaction-commands";
import { resilientFetch } from "@/lib/supabase/resilient-fetch";
import { createRepos, installFakeStorage } from "../helpers";

function readEnv(file: string): Record<string, string> {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(path.resolve(import.meta.dirname, "..", "..", file), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}
export const env = { ...readEnv(".env.local"), ...readEnv(".env.e2e.local") };
export const ENABLED = !!(
  env.NEXT_PUBLIC_SUPABASE_URL &&
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  env.E2E_EMAIL?.endsWith("@test.invalid") &&
  env.E2E_PASSWORD
);

export const TZ = "America/Sao_Paulo"; // padrão do household criado pelo bootstrap
export const today = todayInZone(TZ);
export const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** Cobre o horizonte de recorrências (12 meses) e um mês de folga. */
export const WINDOW = {
  from: monthStart(addMonths(today, -2).slice(0, 7)),
  to: monthEnd(addMonths(today, 14).slice(0, 7)),
  overdueBills: true,
  recent: { limit: 30, today },
};

export interface Ids {
  profile: string;
  catMercado: string;
  catLazer: string;
  catSalario: string;
  accA: string;
  accB: string;
  accInvest: string;
  card: string;
}
export interface Side {
  name: "local" | "supabase";
  ids: Ids;
  commands: TransactionCommands;
  recurrence: RecurrenceCommands;
  debt: DebtCommands;
  pocket: PocketCommands;
  /** Objetivos (CRUD por repositório; sem movimentação de dinheiro). */
  goals: Repository<Goal>;
  /** Contas (edição com guarda de lastro nos dois motores). */
  accounts: Repository<Account>;
  /** Histórico completo dos cofrinhos (local: do armazenamento; supabase: da tabela via RLS). */
  movements(): Promise<PocketMovement[]>;
  data: WorkspaceData;
  refresh(): Promise<void>;
}

const account = (id: string, name: string, profileId: string, over: Partial<Account> = {}): Account => ({
  id, name, ownerProfileId: profileId, type: "checking", initialBalanceCents: 0, color: "#000000", icon: "landmark",
  includeInNetWorth: true, active: true, ...over,
});

export function makeLocal(): Side {
  installFakeStorage();
  const repos = createRepos();
  const ids: Ids = { profile: "L-p", catMercado: "L-cm", catLazer: "L-cl", catSalario: "L-cs", accA: "L-a", accB: "L-b", accInvest: "L-i", card: "L-c" };
  const profile: FinancialProfile = { id: ids.profile, name: "Parity", color: "#4f46e5", kind: "individual", active: true };
  const cat = (id: string, name: string, kind: Category["kind"]): Category => ({ id, name, icon: "more", color: "#000000", kind, active: true });
  const base = {
    profiles: [profile],
    categories: [cat(ids.catMercado, "Mercado", "expense"), cat(ids.catLazer, "Lazer", "expense"), cat(ids.catSalario, "Salário", "income")],
    accounts: [
      account(ids.accA, "Conta A", profile.id, { initialBalanceCents: 100000 }),
      account(ids.accB, "Conta B", profile.id),
      account(ids.accInvest, "Invest", profile.id, { type: "investment", initialBalanceCents: 500000 }),
    ],
    creditCards: [{ id: ids.card, name: "Cartao P", accountId: ids.accA, ownerProfileId: profile.id, limitCents: 500000, closingDay: 28, dueDay: 5, color: "#000000", active: true } as CreditCard],
    installmentPurchases: [],
    pockets: [],
    pocketMovements: [],
    goals: [],
  };
  repos.accounts.replaceAll(base.accounts);
  repos.profiles.replaceAll(base.profiles);
  const side: Side = {
    name: "local",
    ids,
    data: { ...base, transactions: [], recurringTransactions: [], debts: [] },
    commands: undefined as unknown as TransactionCommands,
    recurrence: undefined as unknown as RecurrenceCommands,
    debt: undefined as unknown as DebtCommands,
    pocket: undefined as unknown as PocketCommands,
    goals: repos.goals,
    accounts: new LocalAccountRepository("accounts", () => [], () => ({ pockets: repos.pockets, pocketMovements: repos.pocketMovements, transactions: repos.transactions })),
    movements: () => repos.pocketMovements.list(),
    refresh: async () => {
      side.data = {
        ...base,
        accounts: await repos.accounts.list(),
        transactions: await repos.transactions.list(),
        recurringTransactions: await repos.recurring.list(),
        debts: await repos.debts.list(),
        pockets: await repos.pockets.list(),
        pocketMovements: await repos.pocketMovements.list(),
        goals: await repos.goals.list(),
      };
    },
  };
  side.commands = new LocalTransactionCommands(repos, { today: () => today, data: () => side.data });
  side.recurrence = new LocalRecurrenceCommands(repos, { today: () => today });
  side.debt = new LocalDebtCommands(repos, { today: () => today });
  side.pocket = new LocalPocketCommands(
    { pockets: repos.pockets, pocketMovements: repos.pocketMovements, goals: repos.goals, accounts: repos.accounts, profiles: repos.profiles, transactions: repos.transactions },
    { today: () => today },
  );
  return side;
}

export interface SupabaseSide {
  side: Side;
  /** Fonte de dados (para consultas específicas, ex.: janela do planejamento). */
  source: DataSource;
  client: SupabaseClient;
  householdId: string;
  /** Remove SOMENTE o household criado por este teste (cascata) e encerra a sessão. */
  cleanup(): Promise<void>;
}

export async function makeSupabase(): Promise<SupabaseSide> {
  const wsName = "ws";
  const { default: ws } = await import(wsName); // Node 20 não tem WebSocket nativo (o realtime do supabase-js exige)
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws },
    // O gateway (Cloudflare) devolve 502 esporádicos que nem chegam ao projeto: repete só leituras/login (escritas nunca).
    global: { fetch: resilientFetch({ retries: 4, baseDelayMs: 500 }) },
  });
  const login = await client.auth.signInWithPassword({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD });
  if (login.error) throw new Error("login do usuário de teste falhou: " + login.error.message);

  // Resíduo de uma execução anterior (paridade que falhou no meio ou E2E): o usuário é DESCARTÁVEL (@test.invalid, guard em
  // ENABLED) e só enxerga o próprio household; removemos o que sobrou para poder criar o nosso.
  const { data: leftovers } = await client.from("households").select("id");
  for (const h of leftovers ?? []) await client.from("households").delete().eq("id", h.id);

  const boot = await client.rpc("bootstrap_household", { p_household_name: "Casa Paridade", p_display_name: "Parity", p_create_couple_profile: false });
  if (boot.error) throw new Error("bootstrap_household: " + boot.error.message);
  const householdId = boot.data as string;

  const source = createDataSource({ mode: "supabase", householdId, client });
  const [profile] = await source.repos.profiles.list();
  const categories = await source.repos.categories.list();
  const named = (name: string) => categories.find((c) => c.name === name && !c.parentId)!.id;
  const { SupabaseAccountRepository, SupabaseCreditCardRepository } = await import("@/repositories/supabase/supabase-repository");
  const accRepo = new SupabaseAccountRepository(client, householdId);
  const mk = (name: string, over: Partial<Account>) => accRepo.create({ ...account("", name, profile.id, over) } as Omit<Account, "id">);
  const accA = await mk("Conta A", { initialBalanceCents: 100000 });
  const accB = await mk("Conta B", {});
  const accInvest = await mk("Invest", { type: "investment", initialBalanceCents: 500000 });
  const card = await new SupabaseCreditCardRepository(client, householdId).create({
    name: "Cartao P", accountId: accA.id, ownerProfileId: profile.id, limitCents: 500000, closingDay: 28, dueDay: 5, color: "#000000", active: true,
  });

  const ids: Ids = {
    profile: profile.id, catMercado: named("Mercado"), catLazer: named("Lazer"), catSalario: named("Salário"),
    accA: accA.id, accB: accB.id, accInvest: accInvest.id, card: card.id,
  };
  const side: Side = {
    name: "supabase",
    ids,
    data: undefined as unknown as WorkspaceData,
    commands: undefined as unknown as TransactionCommands,
    recurrence: undefined as unknown as RecurrenceCommands,
    debt: undefined as unknown as DebtCommands,
    pocket: undefined as unknown as PocketCommands,
    goals: source.repos.goals,
    accounts: source.repos.accounts,
    movements: () => source.repos.pockets.movements({ limit: 5000 }),
    refresh: async () => {
      side.data = await loadWorkspace(source, WINDOW);
    },
  };
  side.commands = source.createCommands({ today: () => today, data: () => side.data });
  side.recurrence = source.createRecurrenceCommands({ today: () => today });
  side.debt = source.createDebtCommands({ today: () => today });
  side.pocket = source.createPocketCommands({ today: () => today });
  await side.refresh();
  return {
    side,
    source,
    client,
    householdId,
    cleanup: async () => {
      if (householdId) await client.from("households").delete().eq("id", householdId);
      await client.auth.signOut();
    },
  };
}

/** Tudo que o usuário vê/depende, sem ids (que diferem entre os lados). */
export function metrics(side: Side) {
  const d = side.data;
  const { ids } = side;
  const roles = new Map<string, string>([[ids.accA, "A"], [ids.accB, "B"], [ids.accInvest, "INV"]]);
  const cats = new Map(d.categories.map((c) => [c.id, c.name]));
  const rules = new Map(d.recurringTransactions.map((r) => [r.id, r.description]));
  const debtNames = new Map(d.debts.map((x) => [x.id, x.name]));
  const snap = snapshotOf(d, today);
  const month = yearMonth(today);
  const card = d.creditCards.find((c) => c.id === ids.card)!;
  const summary = cardSummaryFrom(card, snapshotCardInvoices(snap, ids.card), snapshotUsedLimit(snap, card), today);
  const inMonth = d.transactions.filter((t) => yearMonth(t.date) === month);
  const b = monthBreakdown(inMonth, month, today);
  const dash = buildDashboard(d, { profileId: ALL_PROFILES, month }, "x", today);
  const rows = d.transactions
    .filter((t) => t.date >= WINDOW.from && t.date <= WINDOW.to)
    .map((t) => ({
      date: t.date, desc: t.description, kind: t.kind, cents: t.amountCents, status: t.status, paidAt: t.paidAt ?? null, due: t.dueDate ?? null,
      tags: [...t.tags].sort(), inst: t.installment ? `${t.installment.number}/${t.installment.total}` : null,
      cat: cats.get(t.categoryId ?? "") ?? null, acc: roles.get(t.accountId ?? "") ?? null, to: roles.get(t.toAccountId ?? "") ?? null,
      card: !!t.cardId, notes: t.notes ?? null,
      rule: rules.get(t.recurringId ?? "") ?? null, occ: t.occurrenceDate ?? null, byRule: !!t.canceledByRule,
      debt: debtNames.get(t.debtId ?? "") ?? null,
    }))
    .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  return {
    balances: Object.fromEntries(d.accounts.map((a) => [roles.get(a.id), snapshotBalance(snap, a)])),
    card: {
      used: summary.usedCents,
      available: summary.availableCents,
      invoices: snapshotCardInvoices(snap, ids.card).map((i) => ({ m: i.dueMonth, total: i.totalCents, paid: i.paidCents, open: i.openCents, isPaid: i.paid })),
      current: summary.current.openCents,
      next: summary.next.openCents,
    },
    month: {
      received: b.incomeReceivedCents, incomeOpen: b.incomeOpenCents, realized: b.realizedCents, pending: b.pendingCents, planned: b.plannedCents,
    },
    dashboard: {
      summary: dash.summary,
      available: dash.availableBreakdown,
      byCategory: dash.spendingByCategory.map((c) => [c.name, c.amountCents]).sort(),
      chartEqualsSpent: dash.spendingByCategory.reduce((s, c) => s + c.amountCents, 0) === dash.summary.spentCents,
      upcoming: dash.upcoming.map((u) => [u.date, u.title, u.amountCents, u.type, u.overdue]).sort(),
      cards: dash.cards.map((c) => [c.usedCents, c.availableCents, c.invoiceCents, c.nextInvoiceCents]),
    },
    recurring: d.recurringTransactions
      .map((r) => ({
        desc: r.description, kind: r.kind, cents: r.amountCents, freq: r.frequency, interval: r.interval, start: r.startDate,
        end: r.endDate ?? null, active: r.active, from: r.materializeFrom, tags: [...r.tags].sort(), notes: r.notes ?? null,
        acc: roles.get(r.accountId ?? "") ?? null, card: !!r.cardId, cat: cats.get(r.categoryId) ?? null,
      }))
      .sort((x, y) => x.desc.localeCompare(y.desc)),
    debts: d.debts
      .map((x) => {
        const sm = snap.debts.find((y) => y.debtId === x.id)!;
        return {
          name: x.name, kind: x.kind, status: x.status, principal: sm.principalCents, total: sm.totalCents, paid: sm.paidCents,
          remaining: sm.remainingCents, cost: sm.financialCostCents, progress: sm.progressPercent, count: sm.installmentsCount,
          instPaid: sm.installmentsPaid, instOpen: sm.installmentsOpen, nextDue: sm.nextDueDate ?? null, nextOpen: sm.nextOpenCents ?? null,
          payments: sm.paymentsCount, settledAt: sm.settledAt ?? null, discount: sm.settlementDiscountCents ?? null, derived: sm.status,
          installments: snap.debtInstallments
            .filter((i) => i.debtId === x.id)
            .map((i) => [i.number, i.dueDate, i.amountCents, i.paidCents, i.openCents, i.status, i.overdue]),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    list: rows,
  };
}

/**
 * Visão dos cofrinhos/objetivos SEM ids (que diferem entre os lados): cofrinhos com saldo derivado, reservado/livre por conta,
 * progresso dos objetivos e o histórico (com a despesa ligada pelo nome). Local e Supabase devem produzir o MESMO resultado.
 */
export async function pocketMetrics(side: Side) {
  await side.refresh();
  const d = side.data;
  const movements = await side.movements();
  const snap = snapshotOf({ ...d, pocketMovements: side.name === "local" ? movements : d.pocketMovements }, today);
  const roles = new Map<string, string>([[side.ids.accA, "A"], [side.ids.accB, "B"], [side.ids.accInvest, "INV"]]);
  const pocketName = new Map(d.pockets.map((p) => [p.id, p.name]));
  const txName = new Map(d.transactions.map((t) => [t.id, t.description]));
  return {
    pockets: d.pockets
      .map((p) => ({ name: p.name, status: p.status, account: roles.get(p.accountId), balance: snapshotPocketBalance(snap, p), legacy: p.legacyRef ?? null, desc: p.description ?? null, color: p.color }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    accounts: d.accounts
      .map((a) => ({ account: roles.get(a.id), balance: snapshotBalance(snap, a), reserved: snapshotReserved(snap, a.id), free: snapshotFree(snap, a) }))
      .sort((a, b) => String(a.account).localeCompare(String(b.account))),
    goals: d.goals
      .map((g) => ({ name: g.name, linked: g.pocketId ? pocketName.get(g.pocketId) : null, manual: g.manualAmountCents, progress: goalProgress(g, snap.pocketBalances) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    history: movements
      .map((m) => ({ pocket: pocketName.get(m.pocketId), kind: m.kind, cents: m.amountCents, date: m.date, note: m.note ?? null, tx: m.transactionId ? (txName.get(m.transactionId) ?? "?") : null, group: !!m.transferGroupId, reverses: !!m.reversesId }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

export const input = (side: Side, over: Partial<Omit<Transaction, "id">>): Omit<Transaction, "id"> => ({
  kind: "expense", description: "x", amountCents: 1000, date: today, status: "paid", paidAt: today, tags: [], profileId: side.ids.profile, ...over,
});
