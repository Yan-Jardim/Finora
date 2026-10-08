import { describe, expect, it } from "vitest";
import { sum } from "@/domain/calculations";
import type { Category } from "@/domain/types";
import { ALL_PROFILES, buildDashboard } from "@/services/dashboard-service";
import { buildInstallments } from "@/domain/installments";
import { card, casal, camila, nubank, santander, TODAY, tx, workspace, yan } from "./helpers";

const cat = (id: string, name: string, parentId?: string): Category => ({
  id,
  name,
  icon: "more",
  color: "#000000",
  kind: "expense",
  parentId,
  active: true,
});

const categories = [cat("moradia", "Moradia"), cat("aluguel", "Aluguel", "moradia"), cat("mercado", "Mercado"), cat("lazer", "Lazer")];

const installments = buildInstallments(
  { description: "Notebook", totalCents: 300000, installments: 10, date: "2026-10-03", cardId: card.id, profileId: yan.id, categoryId: "lazer", tags: [] },
  "ip-1",
  TODAY,
).map((p, i) => tx({ ...p, id: `inst-${i + 1}` }));

const transactions = [
  tx({ kind: "income", amountCents: 900000, accountId: nubank.id, profileId: yan.id }),
  tx({ kind: "income", amountCents: 600000, accountId: santander.id, profileId: camila.id }),
  tx({ kind: "expense", amountCents: 320000, accountId: nubank.id, profileId: casal.id, categoryId: "aluguel" }), // subcategoria
  tx({ kind: "expense", amountCents: 48790, accountId: nubank.id, profileId: casal.id, categoryId: "mercado" }),
  tx({ kind: "expense", amountCents: 12000, accountId: santander.id, profileId: camila.id, categoryId: "mercado", status: "pending", date: "2026-10-20" }),
  tx({ kind: "expense", amountCents: 450000, accountId: nubank.id, profileId: yan.id, categoryId: "lazer", status: "planned", date: "2026-12-10" }),
  tx({ kind: "credit_card_purchase", amountCents: 21400, cardId: card.id, profileId: yan.id, categoryId: "lazer", status: "pending", date: "2026-10-04" }),
  tx({ kind: "transfer", amountCents: 100000, accountId: nubank.id, toAccountId: santander.id, profileId: yan.id }),
  ...installments,
];

const data = workspace({ categories, transactions });
const view = (profileId = ALL_PROFILES) => buildDashboard(data, { profileId, month: "2026-10" }, "Yan", TODAY);

describe("dashboard", () => {
  it("15. Despesas realizadas = soma do gráfico por categoria (com subcategorias agrupadas)", () => {
    const v = view();
    const chartTotal = sum(v.spendingByCategory.map((c) => c.amountCents));
    expect(chartTotal).toBe(v.summary.spentCents);
    // aluguel (subcategoria) aparece dentro de Moradia
    expect(v.spendingByCategory.find((c) => c.name === "Moradia")?.amountCents).toBe(320000);
    expect(v.spendingByCategory.some((c) => c.name === "Aluguel")).toBe(false);
  });

  it("15b. o gráfico bate com o card em TODAS as visões de perfil", () => {
    for (const id of [ALL_PROFILES, yan.id, camila.id, casal.id]) {
      const v = view(id);
      expect(sum(v.spendingByCategory.map((c) => c.amountCents))).toBe(v.summary.spentCents);
    }
  });

  it("transferência não entra em receitas nem despesas", () => {
    const v = view();
    expect(v.summary.incomeCents).toBe(1500000);
    // 3.200 + 487,90 + 214 + parcela 1 (300) = 4.201,90 — nada de transferência (1.000)
    expect(v.summary.spentCents).toBe(320000 + 48790 + 21400 + 30000);
  });

  it("separa realizadas, pendentes e previstas", () => {
    const v = view();
    expect(v.summary.plannedPendingCents).toBe(12000); // conta pendente
    expect(v.summary.plannedFutureCents).toBe(0); // parcela 2 (nov) e passagem (dez) estão fora do mês
  });

  it("16. filtro de perfil: cada visão só vê o que é dela e as partes somam o todo", () => {
    const all = view();
    const parts = [yan.id, camila.id, casal.id].map(view);
    expect(sum(parts.map((p) => p.summary.spentCents))).toBe(all.summary.spentCents);
    expect(sum(parts.map((p) => p.summary.incomeCents))).toBe(all.summary.incomeCents);
    expect(view(camila.id).summary.incomeCents).toBe(600000);
    expect(view(casal.id).summary.incomeCents).toBe(0);
    // contas por dono: saldo da Camila não inclui contas do Yan
    expect(view(camila.id).summary.balanceCents).toBe(100000 + 600000 + 100000);
  });

  it("perfil inexistente cai em Todos", () => {
    expect(view("nao-existe").filters.profileId).toBe(ALL_PROFILES);
  });

  it("Disponível de verdade: compra no cartão é descontada uma única vez (pela fatura)", () => {
    const before = view();
    // Compra no cartão NÃO reduz o saldo...
    const balance = before.summary.balanceCents;
    const withoutPurchase = buildDashboard(
      workspace({ categories, transactions: transactions.filter((t) => t.id !== transactions[6].id) }),
      { profileId: ALL_PROFILES, month: "2026-10" },
      "Yan",
      TODAY,
    );
    expect(withoutPurchase.summary.balanceCents).toBe(balance);
    // ...e reduz o disponível exatamente uma vez (valor da compra, via fatura).
    expect(withoutPurchase.summary.availableCents - before.summary.availableCents).toBe(21400);
    expect(before.availableBreakdown.invoicesCents).toBe(21400 + 30000); // compra + parcela 1 (mesma fatura de out/27)
  });

  it("pagar a fatura não muda o disponível nem cria despesa", () => {
    const payment = tx({
      kind: "card_payment",
      amountCents: 51400,
      accountId: nubank.id,
      cardId: card.id,
      invoiceMonth: "2026-10",
      profileId: yan.id,
    });
    const before = view();
    const after = buildDashboard(
      workspace({ categories, transactions: [...transactions, payment] }),
      { profileId: ALL_PROFILES, month: "2026-10" },
      "Yan",
      TODAY,
    );
    expect(after.summary.balanceCents).toBe(before.summary.balanceCents - 51400);
    expect(after.availableBreakdown.invoicesCents).toBe(0);
    expect(after.summary.availableCents).toBe(before.summary.availableCents);
    expect(after.summary.spentCents).toBe(before.summary.spentCents);
  });
});
