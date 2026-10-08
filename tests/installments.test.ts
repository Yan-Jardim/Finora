import { describe, expect, it } from "vitest";
import { buildInstallments, splitCents, planScope } from "@/domain/installments";
import { sum } from "@/domain/calculations";
import { card, TODAY, tx } from "./helpers";

const input = {
  description: "Notebook",
  totalCents: 300000,
  installments: 10,
  date: "2026-10-15",
  cardId: card.id,
  profileId: "p-yan",
  tags: [],
};

describe("compra parcelada", () => {
  it("12. gera o número correto de parcelas, numeradas 1/N..N/N, ligadas à compra", () => {
    const parcels = buildInstallments(input, "ip-1", TODAY);
    expect(parcels).toHaveLength(10);
    expect(parcels.map((p) => p.installment?.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(parcels.map((p) => p.installment?.purchaseId))).toEqual(new Set(["ip-1"]));
    expect(parcels.every((p) => p.installment?.total === 10 && p.kind === "credit_card_purchase")).toBe(true);
  });

  it("13. a soma das parcelas é exatamente o valor da compra (R$ 1.000 / 3)", () => {
    expect(splitCents(100000, 3)).toEqual([33334, 33333, 33333]);
    for (const [total, n] of [[100000, 3], [100001, 7], [1, 2], [999999, 48], [300000, 10]] as const) {
      const parts = splitCents(total, n);
      expect(parts).toHaveLength(n);
      expect(sum(parts)).toBe(total);
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
    }
  });

  it("parcelas caem em meses consecutivos (e faturas consecutivas)", () => {
    const parcels = buildInstallments(input, "ip-1", TODAY);
    expect(parcels[0].date).toBe("2026-10-15");
    expect(parcels[1].date).toBe("2026-11-15");
    expect(parcels[9].date).toBe("2027-07-15");
    // compra futura: todas previstas
    expect(parcels.every((p) => p.status === "planned")).toBe(true);
    // compra já feita: 1ª parcela na fatura (pendente), demais previstas
    const made = buildInstallments({ ...input, date: "2026-10-03" }, "ip-2", TODAY);
    expect(made[0].status).toBe("pending");
    expect(made[1].status).toBe("planned");
  });

  it("dia 31 é ajustado ao último dia do mês", () => {
    const parcels = buildInstallments({ ...input, date: "2026-01-31", installments: 3 }, "ip", TODAY);
    expect(parcels.map((p) => p.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("só as parcelas contam: compra original não é transação (soma = valor da compra, não o dobro)", () => {
    const parcels = buildInstallments(input, "ip-1", TODAY);
    expect(sum(parcels.map((p) => p.amountCents))).toBe(input.totalCents);
  });
});

describe("escopo de edição/exclusão de parcelas", () => {
  const group = buildInstallments({ ...input, installments: 5 }, "ip-1", TODAY).map((p, i) =>
    tx({ ...p, id: `p${i + 1}` }),
  );
  const paid = new Set(["p1"]);
  const isProtected = (t: { id: string }) => paid.has(t.id);

  it("somente esta", () => {
    expect(planScope(group, group[2], "this", isProtected).affected.map((t) => t.id)).toEqual(["p3"]);
  });

  it("esta e as próximas", () => {
    expect(planScope(group, group[2], "future", isProtected).affected.map((t) => t.id)).toEqual(["p3", "p4", "p5"]);
  });

  it("compra inteira preserva parcelas pagas (nunca exclui em silêncio)", () => {
    const plan = planScope(group, group[3], "all", isProtected);
    expect(plan.affected.map((t) => t.id)).toEqual(["p2", "p3", "p4", "p5"]);
    expect(plan.keptPaid.map((t) => t.id)).toEqual(["p1"]);
  });
});
