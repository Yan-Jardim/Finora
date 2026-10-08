import { beforeEach, describe, expect, it } from "vitest";
import { accountBalance, cardUsedLimit, sum } from "@/domain/calculations";
import { describeSchedule, nextOccurrence, occurrenceDates, planSync, scheduleDates } from "@/domain/recurrence";
import type { RecurringTransaction } from "@/domain/types";
import { LocalRecurrenceCommands } from "@/services/local-recurrence";
import { LocalTransactionCommands } from "@/services/local-transaction-commands";
import { ALL_PROFILES, buildDashboard } from "@/services/dashboard-service";
import { card, createRepos, installFakeStorage, nubank, TODAY, workspace, yan } from "./helpers";

const rule = (over: Partial<RecurringTransaction> = {}): RecurringTransaction => ({
  id: "r1", kind: "expense", description: "Internet", amountCents: 12000, profileId: yan.id, accountId: nubank.id, categoryId: "moradia",
  tags: [], frequency: "monthly", interval: 1, startDate: "2026-10-10", materializeFrom: "2026-10-10", active: true, ...over,
});

describe("regra de datas (espelho de public.recurrence_dates)", () => {
  const dates = (frequency: RecurringTransaction["frequency"], interval: number, startDate: string, from: string, to: string) =>
    occurrenceDates({ frequency, interval, startDate }, from, to).join(" ");

  it("mensal dia 31: último dia válido do mês, sempre a partir da âncora (nunca encadeado)", () => {
    expect(dates("monthly", 1, "2026-10-31", "2026-10-01", "2027-03-31")).toBe("2026-10-31 2026-11-30 2026-12-31 2027-01-31 2027-02-28 2027-03-31");
  });
  it("fevereiro em ano bissexto", () => {
    expect(dates("monthly", 1, "2028-01-31", "2028-01-01", "2028-03-31")).toBe("2028-01-31 2028-02-29 2028-03-31");
    expect(dates("yearly", 1, "2028-02-29", "2028-01-01", "2031-12-31")).toBe("2028-02-29 2029-02-28 2030-02-28 2031-02-28");
  });
  it("virada de ano", () => {
    expect(dates("monthly", 1, "2026-11-15", "2026-11-01", "2027-02-28")).toBe("2026-11-15 2026-12-15 2027-01-15 2027-02-15");
  });
  it("interval = 2 (meses, semanas e anos)", () => {
    expect(dates("monthly", 2, "2026-10-10", "2026-10-01", "2027-04-30")).toBe("2026-10-10 2026-12-10 2027-02-10 2027-04-10");
    expect(dates("weekly", 2, "2026-10-05", "2026-10-01", "2026-11-30")).toBe("2026-10-05 2026-10-19 2026-11-02 2026-11-16 2026-11-30");
    expect(dates("yearly", 2, "2026-03-01", "2026-01-01", "2031-12-31")).toBe("2026-03-01 2028-03-01 2030-03-01");
  });
  it("semanal e anual (IPVA em janeiro); nunca antes da âncora", () => {
    expect(dates("weekly", 1, "2026-10-05", "2026-10-01", "2026-10-31")).toBe("2026-10-05 2026-10-12 2026-10-19 2026-10-26");
    expect(dates("yearly", 1, "2027-01-15", "2026-01-01", "2029-12-31")).toBe("2027-01-15 2028-01-15 2029-01-15");
  });
  it("janela longe da âncora", () => {
    expect(dates("monthly", 1, "2026-10-10", "2027-06-01", "2027-08-31")).toBe("2027-06-10 2027-07-10 2027-08-10");
  });
  it("intervalo inválido é recusado", () => {
    expect(() => occurrenceDates({ frequency: "monthly", interval: 0, startDate: "2026-01-01" }, "2026-01-01", "2026-12-31")).toThrow();
  });
});

describe("agenda: horizonte, pausa e fim", () => {
  it("gera de hoje até 12 meses à frente (13 ocorrências para mensal ancorado hoje)", () => {
    const r = rule({ startDate: TODAY, materializeFrom: TODAY });
    const dates = scheduleDates(r, TODAY);
    expect(dates).toHaveLength(13);
    expect(dates[0]).toBe(TODAY);
    expect(dates.at(-1)).toBe("2027-10-06");
  });
  it("pausada não gera nada; end_date limita; início no passado não reconstrói histórico", () => {
    expect(scheduleDates(rule({ active: false }), TODAY)).toEqual([]);
    expect(scheduleDates(rule({ endDate: "2026-12-31" }), TODAY)).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
    expect(scheduleDates(rule({ startDate: "2025-01-10", materializeFrom: TODAY }), TODAY)[0]).toBe("2026-10-10");
  });
  it("próxima ocorrência e descrição legível", () => {
    expect(nextOccurrence(rule(), "2026-10-11")).toBe("2026-11-10");
    expect(nextOccurrence(rule({ endDate: "2026-10-31" }), "2026-11-01")).toBeNull();
    expect(describeSchedule(rule())).toBe("Mensal • Todo dia 10");
    expect(describeSchedule(rule({ frequency: "yearly", startDate: "2027-01-15" }))).toBe("Anual • 15 de janeiro");
    expect(describeSchedule(rule({ frequency: "weekly", interval: 2, startDate: "2026-10-05" }))).toBe("A cada 2 semanas • segunda-feira");
  });
});

describe("motor local de recorrências", () => {
  let repos: ReturnType<typeof createRepos>;
  let recurrence: LocalRecurrenceCommands;
  let commands: LocalTransactionCommands;
  let today = TODAY;

  const base = {
    kind: "expense" as const, description: "Internet", amountCents: 12000, profileId: yan.id, accountId: nubank.id, categoryId: "moradia",
    tags: ["Casa"], frequency: "monthly" as const, interval: 1, startDate: TODAY,
  };
  const occ = async (id: string) => (await repos.transactions.list()).filter((t) => t.recurringId === id).sort((a, b) => a.date.localeCompare(b.date));
  const data = async () => workspace({ transactions: await repos.transactions.list(), recurringTransactions: await repos.recurring.list() });

  beforeEach(async () => {
    installFakeStorage();
    repos = createRepos();
    today = TODAY;
    recurrence = new LocalRecurrenceCommands(repos, { today: () => today });
    const snapshot = await data();
    commands = new LocalTransactionCommands(repos, { today: () => today, data: () => snapshot });
  });

  it("cria o template e as ocorrências (hoje = pendente; futuras = previstas) com os campos do template", async () => {
    const created = await recurrence.create(base);
    expect(created).toMatchObject({ created: 13, canceled: 0 });
    const list = await occ(created.id);
    expect(list).toHaveLength(13);
    expect(list[0].status).toBe("pending");
    expect(list.slice(1).every((t) => t.status === "planned")).toBe(true);
    expect(list.every((t) => t.description === "Internet" && t.amountCents === 12000 && t.accountId === nubank.id && t.tags[0] === "Casa")).toBe(true);
    expect(list.every((t) => t.recurringId === created.id && t.occurrenceDate === t.date)).toBe(true);
  });

  it("geração IDEMPOTENTE: sincronizar de novo (várias vezes) não duplica", async () => {
    const { id } = await recurrence.create(base);
    for (let i = 0; i < 3; i++) expect(await recurrence.sync()).toEqual({ created: 0, revived: 0, canceled: 0, promoted: 0 });
    const list = await occ(id);
    expect(new Set(list.map((t) => t.occurrenceDate)).size).toBe(list.length);
    // o plano de uma regra já sincronizada é vazio
    const [r] = await repos.recurring.list();
    expect(planSync(r, list, today)).toEqual({ create: [], revive: [], cancel: [], promote: [] });
  });

  it("o horizonte avança com o tempo; previstas cuja data chegou viram pendentes (sem cron)", async () => {
    const { id } = await recurrence.create(base);
    today = "2026-12-20"; // dois meses depois
    const result = await recurrence.sync();
    expect(result.created).toBe(2); // nov/2027 e dez/2027 entram no horizonte
    expect(result.promoted).toBe(2); // nov e dez/2026 chegaram
    const list = await occ(id);
    expect(list.filter((t) => t.date <= today).every((t) => t.status === "pending")).toBe(true);
    expect(list.at(-1)?.date).toBe("2027-12-06");
  });

  it("paga e cancelada pelo usuário nunca são alteradas pela sincronização", async () => {
    const { id } = await recurrence.create(base);
    const [first, second] = await occ(id);
    await repos.transactions.update(first.id, { status: "paid", paidAt: TODAY });
    await repos.transactions.update(second.id, { status: "canceled" });
    today = "2026-12-20";
    await recurrence.sync();
    await recurrence.setActive((await repos.recurring.list())[0], false);
    await recurrence.setActive((await repos.recurring.list())[0], true);
    const after = await occ(id);
    expect(after.find((t) => t.id === first.id)).toMatchObject({ status: "paid", amountCents: 12000 });
    const canceled = after.find((t) => t.id === second.id)!;
    expect(canceled.status).toBe("canceled");
    expect(canceled.canceledByRule).toBeFalsy(); // cancelada pelo USUÁRIO: a regra nunca a reativa
  });

  it("editar a regra NÃO reescreve o passado: pagas ficam; futuras não pagas recebem o novo valor", async () => {
    const { id } = await recurrence.create(base);
    const [paid, ...rest] = await occ(id);
    await repos.transactions.update(paid.id, { status: "paid", paidAt: TODAY });
    const [r] = await repos.recurring.list();
    const result = await recurrence.update(r, { amountCents: 15000, description: "Internet 500MB", tags: ["Nova"] });
    expect(result.updated).toBe(12);
    const after = await occ(id);
    expect(after[0]).toMatchObject({ amountCents: 12000, description: "Internet", tags: ["Casa"] });
    expect(after.slice(1).every((t) => t.amountCents === 15000 && t.description === "Internet 500MB" && t.tags[0] === "Nova")).toBe(true);
    expect(rest).toHaveLength(12);
  });

  it("applyToFuture=false: só a regra muda", async () => {
    const { id } = await recurrence.create(base);
    const [r] = await repos.recurring.list();
    await recurrence.update(r, { amountCents: 16000 }, { applyToFuture: false });
    expect((await occ(id)).every((t) => t.amountCents === 12000)).toBe(true);
    expect((await repos.recurring.list())[0].amountCents).toBe(16000);
  });

  it("mudar a agenda cancela (pela regra) as futuras fora dela e reativa ao voltar, sem duplicar", async () => {
    const { id } = await recurrence.create(base);
    let [r] = await repos.recurring.list();
    await recurrence.update(r, { frequency: "yearly" });
    let list = await occ(id);
    expect(list.filter((t) => t.status === "planned")).toHaveLength(1); // só a anual dentro do horizonte
    expect(list.filter((t) => t.canceledByRule).length).toBeGreaterThanOrEqual(10);
    [r] = await repos.recurring.list();
    await recurrence.update(r, { frequency: "monthly" });
    list = await occ(id);
    expect(list).toHaveLength(13);
    expect(list.slice(1).every((t) => t.status === "planned" && !t.canceledByRule)).toBe(true);
  });

  it("pausar cancela só as futuras previstas (reversível); reativar volta sem preencher o intervalo", async () => {
    const { id } = await recurrence.create(base);
    const [r] = await repos.recurring.list();
    const paused = await recurrence.setActive(r, false);
    expect(paused.canceled).toBe(12);
    let list = await occ(id);
    expect(list[0].status).toBe("pending"); // a de hoje (já chegou) permanece
    expect(list.slice(1).every((t) => t.status === "canceled" && t.canceledByRule)).toBe(true);
    expect(await recurrence.sync()).toEqual({ created: 0, revived: 0, canceled: 0, promoted: 0 });
    const resumed = await recurrence.setActive((await repos.recurring.list())[0], true);
    expect(resumed.revived).toBe(12);
    list = await occ(id);
    expect(list).toHaveLength(13);
    expect(list.slice(1).every((t) => t.status === "planned")).toBe(true);
  });

  it("excluir uma ocorrência gerada = pular: a regra não a recria", async () => {
    const { id } = await recurrence.create(base);
    const target = (await occ(id))[3];
    await commands.delete(target);
    expect(await recurrence.sync()).toMatchObject({ created: 0 });
    const [r] = await repos.recurring.list();
    await recurrence.update(r, { amountCents: 13000 });
    await recurrence.setActive((await repos.recurring.list())[0], false);
    await recurrence.setActive((await repos.recurring.list())[0], true);
    expect((await occ(id)).some((t) => t.occurrenceDate === target.occurrenceDate)).toBe(false);
    expect(await occ(id)).toHaveLength(12);
  });

  it("validações (iguais às do banco)", async () => {
    await expect(recurrence.create({ ...base, kind: "transfer" as never })).rejects.toThrow(/recorrente/);
    await expect(recurrence.create({ ...base, interval: 0 })).rejects.toThrow(/intervalo/);
    await expect(recurrence.create({ ...base, endDate: "2020-01-01" })).rejects.toThrow(/final/);
    await expect(recurrence.create({ ...base, accountId: undefined })).rejects.toThrow(/conta/);
    await expect(recurrence.create({ ...base, kind: "credit_card_purchase", cardId: card.id })).rejects.toThrow(/cartão/); // com conta
  });

  it("compra recorrente no cartão: não reduz saldo, consome limite só quando a data chega, não duplica", async () => {
    const { id } = await recurrence.create({ ...base, description: "Netflix", amountCents: 5590, kind: "credit_card_purchase", accountId: undefined, cardId: card.id, tags: [] });
    const list = await occ(id);
    const ws = await data();
    expect(accountBalance(nubank, ws.transactions)).toBe(nubank.initialBalanceCents); // saldo intacto
    expect(cardUsedLimit(card, ws.transactions, TODAY)).toBe(5590); // só a de hoje consome
    expect(list.every((t) => t.kind === "credit_card_purchase" && !t.accountId && t.cardId === card.id)).toBe(true);
    await recurrence.sync();
    expect(await occ(id)).toHaveLength(13);
  });

  it("o template NUNCA soma; ocorrências participam do dashboard como transações comuns", async () => {
    await recurrence.create({ ...base, kind: "income", description: "Salário", amountCents: 1000000, startDate: "2026-10-20", tags: [] });
    await recurrence.create({ ...base, description: "Internet", amountCents: 12000, startDate: "2026-10-10", tags: [] });
    const ws = await data();
    const view = buildDashboard(ws, { profileId: ALL_PROFILES, month: "2026-10" }, "x", TODAY);
    // salário de outubro (dia 20) = receita prevista "a receber"; internet (dia 10) = despesa prevista no mês
    expect(view.summary.incomePendingCents).toBe(1000000);
    expect(view.summary.incomeCents).toBe(0);
    expect(view.summary.plannedPendingCents + view.summary.plannedFutureCents).toBe(12000);
    // sem as ocorrências, os templates sozinhos não somam nada
    const onlyTemplates = buildDashboard({ ...ws, transactions: [] }, { profileId: ALL_PROFILES, month: "2026-10" }, "x", TODAY);
    expect(onlyTemplates.summary.plannedCents + onlyTemplates.summary.incomePendingCents + onlyTemplates.summary.spentCents).toBe(0);
    expect(sum(ws.transactions.map((t) => t.amountCents))).toBe(
      ws.transactions.filter((t) => t.kind === "income").reduce((s, t) => s + t.amountCents, 0) +
        ws.transactions.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amountCents, 0),
    );
    // pagar a ocorrência a realiza: receita recebida, saldo sobe
    const salary = ws.transactions.find((t) => t.description === "Salário" && t.date === "2026-10-20")!;
    await repos.transactions.update(salary.id, { status: "paid", paidAt: TODAY });
    const after = buildDashboard(await data(), { profileId: ALL_PROFILES, month: "2026-10" }, "x", TODAY);
    expect(after.summary.incomeCents).toBe(1000000);
    expect(after.summary.incomePendingCents).toBe(0);
  });
});
