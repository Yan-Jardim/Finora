"use client";

import { FlaskConical, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Field, Input, Select } from "@/components/forms/fields";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { compareSimulation, type PlanningFilters, type PurchaseSimulation, type SimulationComparison } from "@/domain/planning";
import { formatMoney } from "@/lib/format";
import { parseMoneyToCents } from "@/lib/money";
import { monthTitle } from "@/lib/planning-messages";
import { cn } from "@/lib/utils";

/**
 * Simulador: "e se eu comprar X em N vezes?". Roda só no navegador sobre a projeção — NUNCA grava movimentações.
 * A simulação alimenta o gráfico (linha tracejada) e some ao descartar.
 */
export function PurchaseSimulator({
  filters,
  onResult,
}: {
  filters: PlanningFilters;
  onResult: (result: SimulationComparison | null) => void;
}) {
  const { data, today } = useWorkspace();
  const cards = data.creditCards.filter((c) => c.active);
  const [form, setForm] = useState({ description: "", total: "", installments: "10", date: today, method: "card" as "card" | "cash", cardId: cards[0]?.id ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SimulationComparison | null>(null);

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const run = () => {
    const totalCents = parseMoneyToCents(form.total);
    const installments = Number(form.installments);
    if (totalCents === null || totalCents <= 0) return setError("Informe um valor maior que zero.");
    if (form.method === "card") {
      if (!form.cardId) return setError("Escolha o cartão (ou simule à vista).");
      if (!Number.isInteger(installments) || installments < 1 || installments > 48) return setError("Informe de 1 a 48 parcelas.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return setError("Informe uma data válida.");
    setError(null);
    const simulation: PurchaseSimulation = {
      description: form.description,
      totalCents,
      installments: form.method === "card" ? installments : 1,
      date: form.date,
      method: form.method,
      cardId: form.method === "card" ? form.cardId : undefined,
    };
    const result = compareSimulation(data, filters, today, simulation);
    setActive(result);
    onResult(result);
  };

  const discard = () => {
    setActive(null);
    setError(null);
    onResult(null);
  };

  const rows = useMemo(() => (active ? active.months.filter((m) => m.impactCents > 0) : []), [active]);

  return (
    <Card className="flex flex-col gap-4">
      <CardHeader title="Simulador de compra" description="Veja o impacto nos próximos meses. Nada é gravado: é só uma simulação." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="O que vai comprar" optional>
          {(p) => <Input {...p} placeholder="Ex.: Notebook" value={form.description} onChange={(e) => set("description", e.target.value)} />}
        </Field>
        <Field label="Valor total">
          {(p) => <Input {...p} inputMode="decimal" placeholder="4.000,00" value={form.total} onChange={(e) => set("total", e.target.value)} />}
        </Field>
        <Field label="Forma de pagamento">
          {(p) => (
            <Select {...p} value={form.method} onChange={(e) => set("method", e.target.value)}>
              <option value="card">Cartão de crédito</option>
              <option value="cash">À vista (da conta)</option>
            </Select>
          )}
        </Field>
        {form.method === "card" && (
          <>
            <Field label="Cartão">
              {(p) => (
                <Select {...p} value={form.cardId} onChange={(e) => set("cardId", e.target.value)}>
                  {cards.length === 0 && <option value="">Nenhum cartão</option>}
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Parcelas">
              {(p) => <Input {...p} inputMode="numeric" maxLength={2} value={form.installments} onChange={(e) => set("installments", e.target.value)} />}
            </Field>
          </>
        )}
        <Field label="Data da compra">
          {(p) => <Input {...p} type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />}
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={run}>
          <FlaskConical className="size-4" aria-hidden /> Simular
        </Button>
        {active && (
          <Button variant="secondary" onClick={discard}>
            <X className="size-4" aria-hidden /> Descartar simulação
          </Button>
        )}
      </div>

      {active && (
        <div className="flex flex-col gap-3 border-t border-border pt-4" aria-live="polite">
          <p className="text-sm">
            Efeito no saldo ao fim do período:{" "}
            <strong className="tabular-nums">{formatMoney(active.base.endBalanceCents)}</strong> →{" "}
            <strong className={cn("tabular-nums", active.withPurchase.endBalanceCents < 0 && "text-danger")}>{formatMoney(active.withPurchase.endBalanceCents)}</strong>
          </p>
          {active.fitsCardLimit === false && (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
              A compra é maior que o limite disponível do cartão ({formatMoney(active.cardAvailableCents ?? 0)}).
            </p>
          )}
          {active.newNegativeMonths.length > 0 && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              Com esta compra o saldo projetado fica negativo em {active.newNegativeMonths.map((m) => monthTitle(m).toLowerCase()).join(", ")}.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 font-medium">Mês</th>
                  <th className="py-1 text-right font-medium">Impacto</th>
                  <th className="py-1 text-right font-medium">Saldo sem a compra</th>
                  <th className="py-1 text-right font-medium">Saldo com a compra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((m) => (
                  <tr key={m.month}>
                    <td className="py-1.5">{monthTitle(m.month)}</td>
                    <td className="py-1.5 text-right tabular-nums">− {formatMoney(m.impactCents)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{formatMoney(m.baseEndCents)}</td>
                    <td className={cn("py-1.5 text-right tabular-nums font-medium", m.simEndCents < 0 && "text-danger")}>{formatMoney(m.simEndCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
