/**
 * PARIDADE DE RECORRÊNCIAS: o mesmo roteiro roda no motor LOCAL (domain/recurrence.ts + local-recurrence) e no SUPABASE
 * REAL (create/update/set_active/sync RPCs), e as ocorrências geradas, os totais do mês, o dashboard ("Disponível de
 * verdade" inclusive), saldos, faturas e limite precisam ser IGUAIS. Integração: só com o usuário descartável
 * configurado (veja tests/support/parity-harness.ts); sem ele, é pulado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMonths } from "@/domain/dates";
import type { RecurringTransaction } from "@/domain/types";
import type { RecurrenceInput } from "@/services/recurrence-commands";
import { ENABLED, makeLocal, makeSupabase, metrics, today, type Side, type SupabaseSide } from "./support/parity-harness";

/** Próxima data com dia 31 (>= hoje): âncora dos casos difíceis (meses curtos e fevereiro). */
function next31(from: string) {
  for (let i = 0; i < 12; i++) {
    const month = addMonths(`${from.slice(0, 7)}-01`, i).slice(0, 7);
    const [y, m] = month.split("-").map(Number);
    if (new Date(Date.UTC(y, m, 0)).getUTCDate() === 31 && `${month}-31` >= from) return `${month}-31`;
  }
  throw new Error("sem dia 31 no ano");
}

describe.skipIf(!ENABLED)("paridade de recorrências: motor local x Supabase (usuário descartável)", { timeout: 240_000 }, () => {
  let local: Side;
  let remote: Side;
  let sb: SupabaseSide;
  const sides = () => [local, remote];
  const sync = async () => {
    for (const s of sides()) await s.refresh();
  };
  const same = async (label: string) => {
    await sync();
    expect(metrics(remote), label).toEqual(metrics(local));
  };
  /** Mesma operação nos dois lados; compara os resultados (contagens) e devolve o do Supabase. */
  const both = async <T,>(fn: (s: Side) => Promise<T>, label?: string) => {
    const [a, b] = [await fn(local), await fn(remote)];
    await sync();
    if (label) expect(b, label).toEqual(a);
    return b;
  };
  const rule = (s: Side, desc: string): RecurringTransaction => s.data.recurringTransactions.find((r) => r.description === desc)!;
  const occ = (s: Side, desc: string) =>
    s.data.transactions.filter((t) => t.recurringId === rule(s, desc)?.id).sort((a, b) => a.date.localeCompare(b.date));
  const input = (s: Side, over: Partial<RecurrenceInput>): RecurrenceInput => ({
    kind: "expense", description: "Internet", amountCents: 12000, profileId: s.ids.profile, accountId: s.ids.accA, categoryId: s.ids.catMercado,
    tags: [], frequency: "monthly", interval: 1, startDate: today, ...over,
  });
  // O id muda de lado para lado: resultados comparáveis ignoram o id.
  const counts = <T extends object>(r: T) => {
    const { id, ...rest } = r as T & { id?: string };
    void id;
    return rest;
  };

  beforeAll(async () => {
    local = makeLocal();
    sb = await makeSupabase();
    remote = sb.side;
    await local.refresh();
  });
  afterAll(async () => {
    if (sb) await sb.cleanup();
  });

  it("criar: mensal, semanal a cada 2, anual, dia 31 e receita — mesmas ocorrências, mesmos totais", async () => {
    await both((s) => s.recurrence.create(input(s, { tags: ["Casa", "Fixa"], notes: "obs" })).then(counts), "Internet");
    await both((s) => s.recurrence.create(input(s, { description: "Academia", amountCents: 10000, frequency: "weekly", interval: 2, categoryId: s.ids.catLazer })).then(counts), "Academia");
    await both((s) => s.recurrence.create(input(s, { description: "IPVA", amountCents: 200000, frequency: "yearly", startDate: `${Number(today.slice(0, 4)) + 1}-01-15` })).then(counts), "IPVA");
    await both((s) => s.recurrence.create(input(s, { description: "Plano dia 31", amountCents: 9900, startDate: next31(today) })).then(counts), "dia 31");
    await both((s) => s.recurrence.create(input(s, { kind: "income", description: "Salário", amountCents: 1000000, startDate: addMonths(today, 1), categoryId: s.ids.catSalario })).then(counts), "Salário");
    await same("recorrências criadas");
    expect(occ(remote, "Internet")).toHaveLength(13);
    expect(occ(remote, "Plano dia 31").every((t) => t.date.slice(8) === String(new Date(Date.UTC(+t.date.slice(0, 4), +t.date.slice(5, 7), 0)).getUTCDate()).padStart(2, "0") || t.date.endsWith("-31"))).toBe(true);
  });

  it("idempotente: sincronizar várias vezes não duplica nem altera nada", async () => {
    const before = metrics(remote);
    for (let i = 0; i < 3; i++) {
      const [a, b] = [await local.recurrence.sync(), await remote.recurrence.sync()];
      expect(a).toEqual({ created: 0, revived: 0, canceled: 0, promoted: 0 });
      expect(b).toEqual(a);
    }
    await same("após 3 syncs");
    expect(metrics(remote)).toEqual(before);
  });

  it("compra recorrente no cartão: fatura certa, conta intacta, limite só da que já chegou", async () => {
    const balances = metrics(remote).balances;
    await both((s) => s.recurrence.create(input(s, { kind: "credit_card_purchase", description: "Netflix", amountCents: 5590, accountId: undefined, cardId: s.ids.card, categoryId: s.ids.catLazer })).then(counts), "Netflix");
    await same("cartão recorrente");
    const m = metrics(remote);
    expect(m.balances).toEqual(balances); // não reduz saldo
    expect(m.card.used).toBe(5590); // consome limite só a de hoje
    expect(m.card.invoices.reduce((sum, i) => sum + i.total, 0)).toBe(13 * 5590); // 13 ocorrências, sem duplicar
  });

  it("paga e cancelada pelo usuário ficam; editar a regra preserva o histórico e atualiza as futuras não pagas", async () => {
    await both(async (s) => {
      const [first, second] = occ(s, "Internet");
      await s.commands.setStatus(first, "paid");
      await s.commands.setStatus(second, "canceled");
    });
    await same("pagou a de hoje e cancelou a seguinte");
    await both((s) => s.recurrence.update(rule(s, "Internet"), { amountCents: 15000, description: "Internet 500MB", tags: ["Casa", "Nova"] }).then(counts), "editar regra");
    await same("regra editada");
    const list = occ(remote, "Internet 500MB").concat(occ(remote, "Internet"));
    expect(list.find((t) => t.status === "paid")).toMatchObject({ amountCents: 12000, description: "Internet" }); // paga: histórico intacto
    expect(list.find((t) => t.status === "canceled")).toMatchObject({ amountCents: 12000 }); // cancelada pelo usuário: intacta
    expect(list.filter((t) => t.status === "planned").every((t) => t.amountCents === 15000)).toBe(true);
    // só a regra (sem propagar)
    await both((s) => s.recurrence.update(rule(s, "Internet 500MB"), { amountCents: 16000 }, { applyToFuture: false }).then(counts), "só a regra");
    await same("apply_to_future=false");
  });

  it("mudar a agenda e voltar: futuras fora da agenda canceladas pela regra e reativadas, sem duplicar", async () => {
    await both((s) => s.recurrence.update(rule(s, "Academia"), { frequency: "monthly", interval: 1 }).then(counts), "semanal -> mensal");
    await same("agenda alterada");
    await both((s) => s.recurrence.update(rule(s, "Academia"), { frequency: "weekly", interval: 2 }).then(counts), "mensal -> semanal");
    await same("agenda restaurada");
  });

  it("pausar cancela só as futuras previstas; reativar volta; a cancelada pelo usuário continua cancelada", async () => {
    await both((s) => s.recurrence.setActive(rule(s, "Internet 500MB"), false), "pausar");
    await same("pausada");
    expect(occ(remote, "Internet 500MB").some((t) => t.status === "paid")).toBe(true); // histórico preservado
    const [a, b] = [await local.recurrence.sync(), await remote.recurrence.sync()];
    expect(a).toEqual({ created: 0, revived: 0, canceled: 0, promoted: 0 });
    expect(b).toEqual(a);
    await both((s) => s.recurrence.setActive(rule(s, "Internet 500MB"), true), "reativar");
    await same("reativada");
    expect(occ(remote, "Internet 500MB").filter((t) => t.status === "canceled" && !t.canceledByRule)).toHaveLength(1);
  });

  it("excluir uma ocorrência = pular: nem sync, nem edição, nem pausa a recriam", async () => {
    const target = (s: Side) => occ(s, "Academia")[3];
    const date = target(remote).occurrenceDate;
    await both((s) => s.commands.delete(target(s)));
    await both((s) => s.recurrence.sync());
    await both((s) => s.recurrence.update(rule(s, "Academia"), { amountCents: 11000 }));
    await both((s) => s.recurrence.setActive(rule(s, "Academia"), false));
    await both((s) => s.recurrence.setActive(rule(s, "Academia"), true));
    await same("pulada continua pulada");
    expect(occ(remote, "Academia").some((t) => t.occurrenceDate === date)).toBe(false);
  });

  it("dashboard: ocorrências entram como transações comuns; o template não soma; sem dupla contagem de cartão", async () => {
    await same("final");
    const d = metrics(remote).dashboard;
    expect(d.chartEqualsSpent).toBe(true);
    // os templates sozinhos não somam: remover as ocorrências do mês zeraria os totais (verificado no teste local)
    expect(remote.data.recurringTransactions.length).toBe(6);
  });
});

