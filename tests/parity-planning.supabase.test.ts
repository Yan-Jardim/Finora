/**
 * PARIDADE DO PLANEJAMENTO: o mesmo cenário (salário e contas recorrentes, parcelamento e recorrência no cartão, dívida
 * com parcelas atrasadas, contas pendentes/atrasadas, receitas futuras e transferência) é montado no motor LOCAL e no
 * SUPABASE REAL, e a projeção (`buildPlanning`) precisa ser IGUAL — no Supabase usando a MESMA janela de consulta da
 * tela (só itens em aberto até o fim do horizonte). Integração: só com o usuário descartável configurado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMonths, monthEnd, monthStart } from "@/domain/dates";
import { buildPlanning, compareSimulation, type Planning } from "@/domain/planning";
import { loadWorkspace } from "@/repositories/load-workspace";
import type { TransactionWindow } from "@/repositories/types";
import { addDays, ENABLED, input, makeLocal, makeSupabase, today, type Side, type SupabaseSide } from "./support/parity-harness";

const first = today.slice(0, 7);
const last = addMonths(`${first}-01`, 11).slice(0, 7);
/** A janela que a tela de Planejamento pede. */
const PLAN_WINDOW: TransactionWindow = {
  from: monthStart(first),
  to: monthEnd(last),
  openOnly: { until: monthEnd(last), cardSince: monthStart(addMonths(`${first}-01`, -2).slice(0, 7)) },
};

/** Projeção sem ids (que diferem entre os lados). */
function normalize(p: Planning) {
  return {
    start: p.startBalanceCents,
    end: p.endBalanceCents,
    income: p.totalIncomeCents,
    outflow: p.totalOutflowCents,
    lowest: p.lowest,
    overdue: p.overdue,
    alerts: p.alerts.map((a) => [a.kind, a.severity, a.month ?? null, a.cents ?? null, a.count ?? null]),
    months: p.months.map((m) => ({
      month: m.month, start: m.startBalanceCents, income: m.incomeCents, outflow: m.outflowCents, end: m.endBalanceCents, buckets: m.buckets,
      items: m.items
        .map((i) => [i.type, i.direction, i.title, i.date, i.dueDate, i.amountCents, i.overdue, i.recurring, i.unlistedCents ?? null, (i.parts ?? []).map((x) => [x.title, x.date, x.amountCents, x.label ?? null])])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    })),
  };
}

describe.skipIf(!ENABLED)("paridade do planejamento: motor local x Supabase (usuário descartável)", { timeout: 240_000 }, () => {
  let local: Side;
  let remote: Side;
  let sb: SupabaseSide;
  const both = async <T,>(fn: (s: Side) => Promise<T>) => {
    await fn(local);
    await fn(remote);
    await local.refresh();
    await remote.refresh();
  };
  const planOf = async (side: Side, months = 12, profile = "all") => {
    const data = side.name === "local" ? (await side.refresh(), side.data) : await loadWorkspace(sb.source, PLAN_WINDOW);
    return buildPlanning(data, { profileId: profile === "all" ? "all" : side.ids.profile, months }, today);
  };

  beforeAll(async () => {
    local = makeLocal();
    sb = await makeSupabase();
    remote = sb.side;
    await local.refresh();

    const rec = { profileId: "", tags: [] as string[], frequency: "monthly" as const, interval: 1 };
    await both((s) => s.recurrence.create({ ...rec, profileId: s.ids.profile, kind: "income", description: "Salário", amountCents: 1000000, accountId: s.ids.accA, categoryId: s.ids.catSalario, startDate: addDays(today, 3) }));
    await both((s) => s.recurrence.create({ ...rec, profileId: s.ids.profile, kind: "expense", description: "Internet", amountCents: 12000, accountId: s.ids.accA, categoryId: s.ids.catMercado, startDate: addDays(today, 5) }));
    await both((s) => s.recurrence.create({ ...rec, profileId: s.ids.profile, kind: "credit_card_purchase", description: "Netflix", amountCents: 5590, cardId: s.ids.card, categoryId: s.ids.catLazer, startDate: today }));
    await both((s) => s.commands.create(input(s, { description: "IPTU", amountCents: 80000, date: addDays(today, 40), status: "planned", paidAt: undefined, accountId: s.ids.accA, categoryId: s.ids.catMercado })));
    await both((s) => s.commands.create(input(s, { description: "Conta atrasada", amountCents: 45000, date: addDays(today, -10), dueDate: addDays(today, -3), status: "pending", paidAt: undefined, accountId: s.ids.accA, categoryId: s.ids.catMercado })));
    await both((s) => s.commands.create(input(s, { kind: "income", description: "Bônus", amountCents: 300000, date: addDays(today, 70), status: "planned", paidAt: undefined, accountId: s.ids.accA, categoryId: s.ids.catSalario })));
    await both((s) => s.commands.create(input(s, { kind: "transfer", description: "Aporte", amountCents: 50000, date: addDays(today, 20), status: "planned", paidAt: undefined, accountId: s.ids.accA, toAccountId: s.ids.accInvest })));
    await both((s) => s.commands.create(input(s, { description: "Já paga", amountCents: 20000, accountId: s.ids.accA, categoryId: s.ids.catMercado })));
    await both((s) => s.commands.createInstallmentPurchase({ description: "TV", totalCents: 300001, installments: 6, date: addDays(today, -1), cardId: s.ids.card, profileId: s.ids.profile, categoryId: s.ids.catLazer, tags: [] }));
    await both(async (s) => {
      const id = await s.debt.create({ name: "Empréstimo", kind: "loan", profileId: s.ids.profile, principalCents: 800000, totalCents: 1030000, installments: 13, firstDueDate: addMonths(`${first}-12`, -3) });
      await s.debt.pay({ debtId: id, accountId: s.ids.accA, amountCents: 79231, date: today });
    });
  });
  afterAll(async () => {
    if (sb) await sb.cleanup();
  });

  it("projeção de 12 meses idêntica (todos, e a pessoa)", async () => {
    for (const profile of ["all", "me"]) {
      expect(normalize(await planOf(remote, 12, profile)), `perfil ${profile}`).toEqual(normalize(await planOf(local, 12, profile)));
    }
  });

  it("períodos menores e itens-chave: sem dupla contagem de cartão, dívida e pagos", async () => {
    for (const months of [1, 3, 6]) {
      expect(normalize(await planOf(remote, months)), `${months} meses`).toEqual(normalize(await planOf(local, months)));
    }
    const p = await planOf(remote);
    const all = p.months.flatMap((m) => m.items);
    expect(all.some((i) => i.title === "Já paga")).toBe(false); // despesa paga já está no saldo
    expect(all.filter((i) => i.type === "invoice").every((i) => i.title.startsWith("Fatura"))).toBe(true);
    expect(all.some((i) => i.title === "TV" || i.title.startsWith("TV —"))).toBe(false); // parcelas do cartão só pela fatura
    expect(all.some((i) => i.title === "Netflix")).toBe(false); // recorrência no cartão idem
    const debt = all.filter((i) => i.type === "debt");
    expect(debt.reduce((s, i) => s + i.amountCents, 0)).toBe(1030000 - 79231); // o pago saiu da projeção
    expect(p.overdue.count).toBeGreaterThanOrEqual(1); // a conta atrasada + parcelas de dívida vencidas
  });

  it("simulador: mesmo resultado nos dois lados e nenhuma movimentação criada", async () => {
    const sim = (s: Side) => ({ description: "Notebook", totalCents: 400000, installments: 10, date: today, method: "card" as const, cardId: s.ids.card });
    const countBefore = remote.data.transactions.length;
    const a = compareSimulation(local.data, { profileId: "all", months: 12 }, today, sim(local));
    const data = await loadWorkspace(sb.source, PLAN_WINDOW);
    const b = compareSimulation(data, { profileId: "all", months: 12 }, today, sim(remote));
    expect(b.months).toEqual(a.months);
    expect(b.newNegativeMonths).toEqual(a.newNegativeMonths);
    await remote.refresh();
    expect(remote.data.transactions.length).toBe(countBefore); // simular não grava
  });
});
