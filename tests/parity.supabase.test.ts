/**
 * TESTES DE PARIDADE: o mesmo roteiro financeiro roda no motor LOCAL (regras no cliente, localStorage falso) e no
 * SUPABASE REAL (RPCs + views, com RLS), e os resultados financeiros precisam ser IGUAIS: saldos, limite, faturas,
 * totais do mês, dashboard (inclusive "Disponível de verdade") e a própria lista de movimentações.
 *
 * Integração: só roda com credenciais de um usuário de TESTE DESCARTÁVEL (@test.invalid) em `.env.e2e.local`
 * (E2E_EMAIL/E2E_PASSWORD) + `.env.local` (URL e chave publishable). Sem elas, o bloco é PULADO.
 * Cria um household próprio ("Casa Paridade") e, ao final, remove SOMENTE esse household (cascata), com a sessão do
 * próprio usuário de teste — nunca service_role, nunca a conta pessoal.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMonths, monthEnd, monthStart } from "@/domain/dates";
import { yearMonth } from "@/domain/calculations";
import type { Transaction } from "@/domain/types";
import { createDataSource } from "@/repositories";
import { addDays, ENABLED, input, makeLocal, makeSupabase, metrics, today, type Side, type SupabaseSide } from "./support/parity-harness";

// ---------------------------------------------------------------- roteiro

describe.skipIf(!ENABLED)("paridade motor local x Supabase (usuário descartável)", { timeout: 180_000 }, () => {
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
  /** Executa a mesma operação nos dois lados; devolve os resultados. */
  const both = async <T,>(fn: (s: Side) => Promise<T>) => {
    const out = [] as T[];
    for (const s of sides()) {
      out.push(await fn(s));
      await s.refresh();
    }
    return out as [T, T];
  };
  const find = (s: Side, desc: string, n?: number) =>
    s.data.transactions.find((t) => t.description === desc && (n === undefined || t.installment?.number === n))!;

  beforeAll(async () => {
    local = makeLocal();
    sb = await makeSupabase();
    remote = sb.side;
    await local.refresh();
  });

  afterAll(async () => {
    // Limpa SOMENTE o household criado por este teste (cascata), com a sessão do próprio usuário descartável.
    if (sb) await sb.cleanup();
  });

  it("estado inicial idêntico (saldo inicial; sem faturas; sem limite usado)", async () => {
    await same("inicial");
    expect(metrics(remote).balances).toEqual({ A: 100000, B: 0, INV: 500000 });
  });

  it("1-4. receita paga, despesa paga com tags, despesa prevista e despesa vencida", async () => {
    await both((s) => s.commands.create(input(s, { kind: "income", description: "Salário", amountCents: 500000, accountId: s.ids.accA, categoryId: s.ids.catSalario })));
    await both((s) => s.commands.create(input(s, { description: "Mercado", amountCents: 120000, accountId: s.ids.accA, categoryId: s.ids.catMercado, tags: ["Casa", "Mensal"] })));
    await both((s) => s.commands.create(input(s, { description: "Viagem futura", amountCents: 80000, date: addDays(today, 20), status: "planned", paidAt: undefined, accountId: s.ids.accA, categoryId: s.ids.catLazer })));
    await both((s) => s.commands.create(input(s, { description: "Conta de luz", amountCents: 45000, date: addDays(today, -3), dueDate: addDays(today, -1), status: "pending", paidAt: undefined, accountId: s.ids.accA, categoryId: s.ids.catMercado })));
    await same("receitas/despesas");
  });

  it("5-6. transferência entre contas e aporte em investimento (patrimônio inalterado pela transferência)", async () => {
    const before = metrics(remote).dashboard.summary.netWorthCents;
    await both((s) => s.commands.create(input(s, { kind: "transfer", description: "A para B", amountCents: 100000, accountId: s.ids.accA, toAccountId: s.ids.accB })));
    await same("transferência");
    expect(metrics(remote).dashboard.summary.netWorthCents).toBe(before);
    await both((s) => s.commands.create(input(s, { kind: "transfer", description: "A para Invest", amountCents: 50000, accountId: s.ids.accA, toAccountId: s.ids.accInvest })));
    await same("transferência p/ investimento");
  });

  it("7-9. compra no cartão (à vista, futura) e compra parcelada — consomem limite, não mexem na conta", async () => {
    const balanceBefore = metrics(remote).balances;
    const card = (s: Side, over: Partial<Omit<Transaction, "id">>) =>
      s.commands.create(input(s, { kind: "credit_card_purchase", status: "pending", paidAt: undefined, cardId: s.ids.card, categoryId: s.ids.catMercado, ...over }));
    await both((s) => card(s, { description: "Jantar", amountCents: 30000, date: addDays(today, -1) }));
    await both((s) => card(s, { description: "Passagem", amountCents: 20000, date: addDays(today, 35), status: "planned" }));
    const [a, b] = await both((s) =>
      s.commands.createInstallmentPurchase({ description: "Notebook", totalCents: 90001, installments: 3, date: addDays(today, -1), cardId: s.ids.card, profileId: s.ids.profile, categoryId: s.ids.catLazer, tags: ["Trabalho"] }),
    );
    expect(b.count).toBe(a.count);
    await same("cartão e parcelamento");
    expect(metrics(remote).balances).toEqual(balanceBefore); // compra no cartão nunca reduz a conta
    const m = metrics(remote);
    expect(m.card.invoices.length).toBeGreaterThanOrEqual(3);
    expect(m.card.invoices.reduce((s, i) => s + i.total, 0)).toBe(30000 + 20000 + 90001); // o agrupador NÃO soma
  });

  it("10-11. pagamento parcial e total da fatura com conta escolhida (não a padrão do cartão)", async () => {
    const dueMonth = metrics(local).card.invoices.find((i) => i.open > 0)!.m;
    const balancesBefore = metrics(remote).balances;
    await both((s) => s.commands.payInvoice({ cardId: s.ids.card, dueMonth, accountId: s.ids.accB, amountCents: 10000, date: today }));
    await same("pagamento parcial");
    const after = metrics(remote);
    expect(after.balances.B).toBe((balancesBefore.B as number) - 10000); // saiu da conta ESCOLHIDA (B), não da padrão (A)
    expect(after.balances.A).toBe(balancesBefore.A);
    expect(after.dashboard.summary.spentCents).toBe(metrics(local).dashboard.summary.spentCents); // pagar fatura não vira despesa

    const open = after.card.invoices.find((i) => i.m === dueMonth)!.open;
    // saldo da B precisa cobrir: reforça a conta (transferência) antes de quitar
    await both((s) => s.commands.create(input(s, { kind: "transfer", description: "Reforço B", amountCents: open, accountId: s.ids.accA, toAccountId: s.ids.accB })));
    await both((s) => s.commands.payInvoice({ cardId: s.ids.card, dueMonth, accountId: s.ids.accB, amountCents: open, date: today }));
    await same("pagamento total");
    expect(metrics(remote).card.invoices.find((i) => i.m === dueMonth)).toMatchObject({ open: 0, isPaid: true });
  });

  it("regras: pagar a mais, fatura sem valor, mexer em compra de fatura paga — ambos recusam e nada muda", async () => {
    const dueMonth = metrics(local).card.invoices.find((i) => i.isPaid)!.m;
    const open = metrics(local).card.invoices.find((i) => i.open > 0)!;
    const frozen = metrics(local);
    for (const s of sides()) {
      await expect(s.commands.payInvoice({ cardId: s.ids.card, dueMonth: open.m, accountId: s.ids.accA, amountCents: open.open + 1, date: today }), `${s.name}: pagar a mais`).rejects.toThrow();
      await expect(s.commands.payInvoice({ cardId: s.ids.card, dueMonth, accountId: s.ids.accA, amountCents: 100, date: today }), `${s.name}: fatura quitada`).rejects.toThrow();
      const jantar = find(s, "Jantar");
      await expect(s.commands.update(jantar, { description: "alterada" }), `${s.name}: editar compra de fatura paga`).rejects.toThrow();
      await expect(s.commands.delete(jantar), `${s.name}: excluir compra de fatura paga`).rejects.toThrow();
      await expect(s.commands.setStatus(jantar, "canceled"), `${s.name}: cancelar compra de fatura paga`).rejects.toThrow();
      await expect(s.commands.delete(find(s, "Notebook", 1), "this"), `${s.name}: excluir parcela de fatura paga`).rejects.toThrow();
    }
    await same("nada mudou após recusas");
    expect(metrics(remote)).toEqual(frozen);
  });

  it("12-14. editar, mudar status e tags (substitui) numa movimentação comum", async () => {
    await both((s) => s.commands.update(find(s, "Mercado"), { description: "Mercado do mês", amountCents: 130000, notes: "obs", tags: ["Casa", "Extra"] }));
    await same("edição + tags");
    await both((s) => s.commands.setStatus(find(s, "Conta de luz"), "paid"));
    await same("marcar como pago");
    await both((s) => s.commands.setStatus(find(s, "Mercado do mês"), "pending"));
    await same("voltar a pendente");
    await both((s) => s.commands.update(find(s, "Mercado do mês"), { tags: [] }));
    await same("limpar tags");
    await both((s) => s.commands.update(find(s, "Viagem futura"), { date: addDays(today, 60), status: "planned" }));
    await same("data da despesa prevista");
  });

  it("15-17. compra no cartão: mudar data move de fatura/estado; cancelar e reativar; parcelas (esta / esta e próximas)", async () => {
    await both((s) => s.commands.update(find(s, "Passagem"), { date: addDays(today, 70) }));
    await same("compra no cartão com outra data");
    await both((s) => s.commands.setStatus(find(s, "Passagem"), "canceled"));
    await same("compra cancelada");
    await both((s) => s.commands.setStatus(find(s, "Passagem"), "planned"));
    await same("compra reativada");

    await both((s) => s.commands.update(find(s, "Notebook", 2), { description: "Notebook Pro", tags: ["Trabalho", "Pro"] }, "future"));
    await same("editar esta e as próximas");
    await both((s) => s.commands.update(find(s, "Notebook Pro", 3), { amountCents: 40000 }, "this"));
    await same("editar valor de uma parcela");
    await both((s) => s.commands.setStatus(find(s, "Notebook Pro", 3), "canceled"));
    await same("cancelar parcela");
    await both((s) => s.commands.setStatus(find(s, "Notebook Pro", 3), "pending"));
    await same("reativar parcela");
  });

  it("18-19. exclusão: comum, parcelas por escopo (mantendo as de fatura paga) e o pagamento reabre a fatura", async () => {
    const [d1, d2] = await both((s) => s.commands.delete(find(s, "Conta de luz")));
    expect(d2).toEqual(d1);
    await same("excluir despesa");

    const [p1, p2] = await both((s) => s.commands.previewScope(find(s, "Notebook", 1), "all"));
    expect(p2).toEqual(p1);
    const [e1, e2] = await both((s) => s.commands.delete(find(s, "Notebook Pro", 3), "future"));
    expect(e2).toEqual(e1);
    await same("excluir esta e as próximas");

    // A parcela 1 está em fatura PAGA (travada): "compra inteira" a partir de uma parcela livre preserva a paga e
    // informa quantas foram mantidas — nos dois lados.
    const [all1, all2] = await both((s) => s.commands.delete(find(s, "Notebook Pro", 2), "all"));
    expect(all2).toEqual(all1);
    expect(all2.keptPaid).toBe(1);
    await same("compra inteira");

    const pay = (s: Side) => s.data.transactions.find((t) => t.kind === "card_payment")!;
    await both((s) => s.commands.delete(pay(s)));
    await both((s) => s.commands.delete(pay(s)));
    await same("excluir pagamentos reabre a fatura");
    expect(metrics(remote).card.invoices.every((i) => !i.isPaid || i.open === 0)).toBe(true);
  });

  it("filtros por período: a janela do banco devolve exatamente o que o filtro de mês local mostraria", async () => {
    await sync();
    for (const m of [yearMonth(today), yearMonth(addMonths(today, 1)), yearMonth(addMonths(today, 2))]) {
      const page = await createDataSource({ mode: "supabase", householdId: sb.householdId, client: sb.client }).repos.transactions.query({ from: monthStart(m), to: monthEnd(m) });
      const remoteMonth = page.items.map((t) => [t.date, t.description, t.amountCents, t.status, t.kind].join("|")).sort();
      const localMonth = local.data.transactions.filter((t) => yearMonth(t.date) === m).map((t) => [t.date, t.description, t.amountCents, t.status, t.kind].join("|")).sort();
      expect(remoteMonth, `mês ${m}`).toEqual(localMonth);
    }
  });

  it("dashboard: despesas realizadas == gráfico por categoria e sem dupla contagem de cartão/fatura", async () => {
    await same("final");
    const d = metrics(remote).dashboard;
    expect(d.chartEqualsSpent).toBe(true);
  });
});
