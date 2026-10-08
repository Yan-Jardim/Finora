"use client";

import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { BreakdownNode, Report } from "@/domain/reports";
import type { ProfileRow } from "@/domain/reports";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ComboChart, DataTable, MeterBar } from "./charts";
import { Delta, Kpi, Note, Section, type Drill } from "./report-ui";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const shortMonth = (ym: string) => `${MONTHS[Number(ym.slice(5)) - 1]}/${ym.slice(2, 4)}`;

interface Props {
  report: Report;
  /** Período anterior (quando a comparação está ligada). */
  compare?: Report;
  onDrill: (drill: Drill) => void;
}

const colors = { income: "var(--success)", expense: "var(--danger)", net: "var(--primary)", muted: "var(--muted-foreground)", warn: "var(--warning)" };

// ---------------------------------------------------------------------------------------------------------------------
// Lista de categorias (com drill-down e variação)
// ---------------------------------------------------------------------------------------------------------------------

function CategoryList({ nodes, compare, onOpen, label }: { nodes: BreakdownNode[]; compare?: BreakdownNode[]; onOpen: (n: BreakdownNode) => void; label: string }) {
  if (nodes.length === 0) return <p className="text-sm text-muted-foreground">Nada neste período com os filtros atuais.</p>;
  const before = new Map((compare ?? []).map((n) => [n.id, n.totalCents]));
  return (
    <ul className="flex flex-col gap-2" aria-label={label} data-testid="category-list">
      {nodes.map((n) => (
        <li key={n.id}>
          <button type="button" onClick={() => onOpen(n)} className="flex w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary" aria-label={`${n.name}: ${formatMoney(n.totalCents)}. Ver detalhes`}>
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 truncate">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: n.color }} aria-hidden />
                <span className="truncate font-medium" data-testid="category-name">{n.name}</span>
              </span>
              <span className="shrink-0 tabular-nums" data-testid="category-value">{formatMoney(n.totalCents)}</span>
            </span>
            <MeterBar percent={n.percent} color={n.color} />
            <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{n.percent.toLocaleString("pt-BR")}% · {n.count} {n.count === 1 ? "mov." : "movs."}</span>
              {compare && <Delta current={n.totalCents} previous={before.get(n.id) ?? 0} label={n.name} />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const ownerOf = (tx: { profileId: string }, report: Report) => report.profiles.find((p) => p.profileId === tx.profileId)?.name ?? "";

// ---------------------------------------------------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------------------------------------------------

export function OverviewSection({ report, compare }: Props) {
  const o = report.overview;
  const c = compare?.overview;
  const months = report.cashFlow.months;
  return (
    <div className="flex flex-col gap-4" data-testid="section-overview">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi id="received" label="Total recebido" value={formatMoney(o.receivedCents)} formula="Receitas pagas no período (data de competência)." compare={c && { current: o.receivedCents, previous: c.receivedCents }} />
        <Kpi id="consumption" label="Despesas de consumo" value={formatMoney(o.consumptionCents)} formula="Despesas pagas em conta + compras no cartão já feitas. Não inclui fatura paga, transferências, cofrinhos nem pagamento de dívida." compare={c && { current: o.consumptionCents, previous: c.consumptionCents }} />
        <Kpi id="cashout" label="Saídas de caixa" value={formatMoney(o.cashOutCents)} formula="Dinheiro que saiu das contas: despesas pagas + faturas pagas + dívidas pagas (data do pagamento). Compra no cartão só sai quando a fatura é paga." compare={c && { current: o.cashOutCents, previous: c.cashOutCents }} />
        <Kpi
          id="result"
          label="Resultado do período"
          value={formatMoney(o.resultCents)}
          tone={o.resultCents < 0 ? "negative" : "positive"}
          formula="Total recebido − Despesas de consumo − Pagamentos de dívidas."
          compare={c && { current: o.resultCents, previous: c.resultCents }}
        />
        <Kpi id="savings" label="Taxa de economia" value={o.savingsRate === null ? "—" : `${o.savingsRate.toLocaleString("pt-BR")}%`} formula="Resultado do período ÷ Total recebido. Sem receita no período não há taxa." />
        <Kpi id="balance" label="Saldo atual" value={formatMoney(o.currentBalanceCents)} formula="Hoje: saldo das contas ativas (sem investimentos), no escopo dos filtros." />
        <Kpi id="networth" label="Patrimônio financeiro" value={formatMoney(o.netWorthFinancialCents)} formula="Hoje: contas + investimentos das contas ativas incluídas no patrimônio. Cofrinhos não somam." />
        <Kpi id="reserved" label="Total reservado" value={formatMoney(o.reservedCents)} formula="Hoje: soma dos cofrinhos. Já está DENTRO do saldo (divisão virtual): não aumenta patrimônio." />
        <Kpi id="debts" label="Dívidas restantes" value={formatMoney(o.debtRemainingCents)} formula="Hoje: saldo devido das dívidas ativas e pausadas." />
        <Kpi id="debtpay" label="Pagamentos de dívidas" value={formatMoney(o.debtPaymentsCents)} formula="Saída de caixa do período, fora do consumo (principal × juros ainda não é separado)." compare={c && { current: o.debtPaymentsCents, previous: c.debtPaymentsCents }} />
        <Kpi id="cashin" label="Entradas de caixa" value={formatMoney(o.cashInCents)} formula="Receitas pagas, pela data do pagamento. Transferências entre contas próprias não contam." compare={c && { current: o.cashInCents, previous: c.cashInCents }} />
        <Kpi id="cashnet" label="Resultado de caixa" value={formatMoney(o.cashInCents - o.cashOutCents)} tone={o.cashInCents - o.cashOutCents < 0 ? "negative" : "positive"} formula="Entradas de caixa − Saídas de caixa." compare={c && { current: o.cashInCents - o.cashOutCents, previous: c.cashInCents - c.cashOutCents }} />
      </div>
      <Section title="Receitas × despesas de consumo" description="Por mês, na data de competência. Compras no cartão aparecem no mês da compra.">
        <ComboChart
          testId="chart-income-vs-expense"
          labels={months.map((m) => shortMonth(m.month))}
          series={[
            { name: "Receitas", kind: "bar", style: "solid", color: colors.income, values: months.map((m) => m.incomeCents) },
            { name: "Despesas de consumo", kind: "bar", style: "stripe", color: colors.expense, values: months.map((m) => m.consumptionCents) },
          ]}
          summary={`Receitas ${formatMoney(o.receivedCents)} e despesas de consumo ${formatMoney(o.consumptionCents)} no período, por mês.`}
        />
      </Section>
      <ProfilesTable rows={report.profiles} />
    </div>
  );
}

/** Pessoa A, Pessoa B, Casal e Consolidado (= soma dos perfis; cada movimentação tem um único dono). */
export function ProfilesTable({ rows }: { rows: ProfileRow[] }) {
  return (
    <Section title="Pessoas, Casal e consolidado" description="“Casal” é um perfil compartilhado; “Consolidado” é a soma do household. Nada é contado duas vezes: cada movimentação pertence a um único perfil.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm tabular-nums" data-testid="profiles-table">
          <thead>
            <tr className="text-xs text-muted-foreground">
              {["Perfil", "Recebido", "Consumo", "Dívidas pagas", "Entradas de caixa", "Saídas de caixa"].map((h, i) => (
                <th key={h} scope="col" className={cn("py-1.5 pr-3 font-medium", i > 0 && "text-right")}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.profileId} className={cn("border-t border-border", r.profileId === "all" && "font-semibold")}>
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                  <span className="inline-flex items-center gap-2">
                    {r.color && <span className="size-2 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />}
                    <span className={cn(r.profileId === "all" && "font-semibold")}>{r.name}</span>
                  </span>
                </th>
                <td className="py-1.5 pr-3 text-right">{formatMoney(r.receivedCents)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(r.consumptionCents)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(r.debtPaymentsCents)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMoney(r.cashInCents)}</td>
                <td className="py-1.5 text-right">{formatMoney(r.cashOutCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Receitas
// ---------------------------------------------------------------------------------------------------------------------

export function IncomeSection({ report, compare, onDrill }: Props) {
  const i = report.income;
  const months = report.cashFlow.months;
  return (
    <div className="flex flex-col gap-4" data-testid="section-income">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi id="income-total" label="Total recebido" value={formatMoney(i.receivedCents)} formula="Receitas pagas no período." compare={compare && { current: i.receivedCents, previous: compare.income.receivedCents }} />
        <Kpi id="income-expected" label="Previsto / a receber" value={formatMoney(i.expectedCents)} formula="Receitas pendentes ou previstas no período." />
        <Kpi id="income-recurring" label="Recorrentes" value={formatMoney(i.recurringCents)} formula="Recebido vindo de recorrências." />
        <Kpi id="income-oneoff" label="Não recorrentes" value={formatMoney(i.oneOffCents)} formula="Recebido avulso." />
      </div>
      <Note>Transferências recebidas entre contas próprias não são receita.</Note>
      <Section title="Evolução por mês" description="Recebido por mês (data de competência).">
        <ComboChart
          labels={months.map((m) => shortMonth(m.month))}
          series={[{ name: "Recebido", kind: "bar", style: "solid", color: colors.income, values: months.map((m) => m.incomeCents) }]}
          summary={`Receitas recebidas por mês, total ${formatMoney(i.receivedCents)}.`}
        />
      </Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Por categoria" description="Clique para ver as movimentações.">
          <CategoryList label="Receitas por categoria" nodes={i.byCategory} compare={compare?.income.byCategory} onOpen={(n) => onDrill({ title: `${n.name} — ${formatMoney(n.totalCents)}`, node: n, transactions: n.transactions })} />
        </Section>
        <Section title="Por pessoa / Casal">
          <ul className="flex flex-col gap-2" aria-label="Receitas por pessoa">
            {i.byProfile.length === 0 && <p className="text-sm text-muted-foreground">Nada neste período.</p>}
            {i.byProfile.map((p) => (
              <li key={p.profileId} className="flex flex-col gap-1 text-sm">
                <span className="flex items-baseline justify-between"><span className="font-medium">{p.name}</span><span className="tabular-nums">{formatMoney(p.totalCents)}</span></span>
                <MeterBar percent={p.percent} color={p.color} />
                <span className="text-xs text-muted-foreground">{p.percent.toLocaleString("pt-BR")}%</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Despesas de consumo
// ---------------------------------------------------------------------------------------------------------------------

export function ExpensesSection({ report, compare, onDrill }: Props) {
  const e = report.expenses;
  const months = report.cashFlow.months;
  return (
    <div className="flex flex-col gap-4" data-testid="section-expenses">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi id="exp-total" label="Despesas de consumo" value={formatMoney(e.consumptionCents)} formula="Despesas pagas em conta + compras no cartão (cada parcela na sua data)." compare={compare && { current: e.consumptionCents, previous: compare.expenses.consumptionCents }} />
        <Kpi id="exp-open" label="A pagar / previstas" value={formatMoney(e.openCents)} formula="Contas pendentes e previstas no período: fora do consumo realizado." />
        <Kpi id="exp-debt" label="Pagamentos de dívidas" value={formatMoney(e.debtPayments.totalCents)} formula="Mostrado à parte: não entra no consumo." compare={compare && { current: e.debtPayments.totalCents, previous: compare.expenses.debtPayments.totalCents }} />
        <Kpi id="exp-count" label="Movimentações" value={String(e.rows.length)} formula="Quantidade de lançamentos que compõem o consumo." />
      </div>
      <Note>
        Não entram no consumo: pagamento de fatura (é saída de caixa), transferências entre contas próprias, reserva e retirada de cofrinho. Usar a reserva de um cofrinho conta UMA vez, como a despesa que foi.
      </Note>
      <Section title="Por categoria" description={`Total ${formatMoney(e.consumptionCents)} — a soma das categorias bate com este valor. Clique para detalhar.`}>
        <CategoryList label="Despesas por categoria" nodes={e.byCategory} compare={compare?.expenses.byCategory} onOpen={(n) => onDrill({ title: `${n.name} — ${formatMoney(n.totalCents)}`, node: n, transactions: n.transactions })} />
        <p className="text-xs tabular-nums text-muted-foreground" data-testid="category-sum">
          Soma das categorias: {formatMoney(e.byCategory.reduce((n, c) => n + c.totalCents, 0))}
        </p>
      </Section>
      <Section title="Evolução por mês" description="Consumo por mês (competência).">
        <ComboChart
          labels={months.map((m) => shortMonth(m.month))}
          series={[{ name: "Despesas de consumo", kind: "bar", style: "stripe", color: colors.expense, values: months.map((m) => m.consumptionCents) }]}
          summary={`Despesas de consumo por mês, total ${formatMoney(e.consumptionCents)}.`}
        />
      </Section>
      <Section
        title="Pagamentos de dívidas"
        description="Saída de caixa, separada do consumo. A divisão entre principal e juros ainda não é feita: nada é estimado."
      >
        {e.debtPayments.byDebt.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pagamento de dívida no período.</p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Pagamentos por dívida" data-testid="debt-payments">
            {e.debtPayments.byDebt.map((d) => (
              <li key={d.debtId}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => onDrill({ title: `${d.name} — ${formatMoney(d.totalCents)}`, transactions: e.debtPayments.rows.filter((t) => (t.debtId ?? "none") === d.debtId) })}
                >
                  <span>{d.name} <span className="text-xs text-muted-foreground">({d.count} {d.count === 1 ? "pagamento" : "pagamentos"})</span></span>
                  <span className="tabular-nums">{formatMoney(d.totalCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Fluxo de caixa
// ---------------------------------------------------------------------------------------------------------------------

export function CashFlowSection({ report, compare, onDrill }: Props) {
  const c = report.cashFlow;
  const months = c.months;
  return (
    <div className="flex flex-col gap-4" data-testid="section-cashflow">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi id="cf-in" label="Entradas" value={formatMoney(c.inCents)} formula="Receitas pagas, pela data do pagamento." compare={compare && { current: c.inCents, previous: compare.cashFlow.inCents }} />
        <Kpi id="cf-out" label="Saídas" value={formatMoney(c.outCents)} formula="Despesas pagas + faturas pagas + dívidas pagas." compare={compare && { current: c.outCents, previous: compare.cashFlow.outCents }} />
        <Kpi id="cf-net" label="Resultado líquido" value={formatMoney(c.netCents)} tone={c.netCents < 0 ? "negative" : "positive"} formula="Entradas − Saídas." compare={compare && { current: c.netCents, previous: compare.cashFlow.netCents }} />
        <Kpi id="cf-transfers" label="Transferências entre contas" value={formatMoney(c.transfersInCents - c.transfersOutCents)} formula={`Neutras no consolidado. Neste escopo: entraram ${formatMoney(c.transfersInCents)} e saíram ${formatMoney(c.transfersOutCents)} (fora das entradas/saídas).`} />
      </div>
      <Section title="Entradas, saídas e resultado líquido" description="Por mês, pela data em que o dinheiro se moveu. Compra no cartão não sai da conta na data da compra.">
        <ComboChart
          testId="chart-cashflow"
          labels={months.map((m) => shortMonth(m.month))}
          series={[
            { name: "Entradas", kind: "bar", style: "solid", color: colors.income, values: months.map((m) => m.cashInCents) },
            { name: "Saídas", kind: "bar", style: "stripe", color: colors.expense, values: months.map((m) => m.cashOutCents) },
            { name: "Resultado líquido", kind: "line", style: "dashed", color: colors.net, values: months.map((m) => m.cashNetCents) },
          ]}
          summary={`Entradas ${formatMoney(c.inCents)}, saídas ${formatMoney(c.outCents)}, resultado líquido ${formatMoney(c.netCents)}.`}
        />
      </Section>
      <Section title="Composição das saídas">
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          {[
            ["Despesas pagas em conta", c.outBreakdown.expenseCents],
            ["Pagamentos de fatura", c.outBreakdown.cardPaymentsCents],
            ["Pagamentos de dívidas", c.outBreakdown.debtPaymentsCents],
          ].map(([label, v]) => (
            <div key={label as string} className="rounded-lg border border-border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{formatMoney(v as number)}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className="self-start text-xs font-medium text-primary hover:underline"
          onClick={() => onDrill({ title: `Movimentações de caixa — ${formatMoney(c.netCents)} de resultado`, transactions: c.rows.map((r) => r.tx) })}
        >
          Ver as {c.rows.length} movimentações de caixa
        </button>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Cartões
// ---------------------------------------------------------------------------------------------------------------------

export function CardsSection({ report, onDrill }: Props) {
  if (report.cards.length === 0) return <Note>Nenhum cartão no escopo dos filtros.</Note>;
  const total = report.cards.reduce((n, c) => n + c.spentCents, 0);
  return (
    <div className="flex flex-col gap-4" data-testid="section-cards">
      <Note>Gasto = compras feitas no cartão no período (consumo). O pagamento da fatura é saída de caixa e NÃO é contado como nova despesa. Total gasto nos cartões: <strong>{formatMoney(total)}</strong>.</Note>
      {report.cards.map((c) => (
        <Section key={c.card.id} title={c.card.name} description={`Limite ${formatMoney(c.limitCents)}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Gasto no período", c.spentCents],
              ["Limite utilizado (hoje)", c.usedCents],
              ["Disponível (hoje)", c.availableCents],
              ["Parceladas no período", c.installmentPurchasesCents],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border border-border px-3 py-2" data-testid={`card-${c.card.id}-${(l as string).split(" ")[0].toLowerCase()}`}>
                <p className="text-xs text-muted-foreground">{l}</p>
                <p className="tabular-nums font-semibold">{formatMoney(v as number)}</p>
              </div>
            ))}
          </div>
          <ProgressBar value={c.limitCents > 0 ? (c.usedCents / c.limitCents) * 100 : 0} color="var(--primary)" label={`Limite utilizado de ${c.card.name}`} />
          {c.invoices.length > 0 && (
            <ComboChart
              labels={c.invoices.map((i) => shortMonth(i.dueMonth))}
              series={[
                { name: "Fatura", kind: "bar", style: "solid", color: colors.net, values: c.invoices.map((i) => i.totalCents) },
                { name: "Pago", kind: "bar", style: "stripe", color: colors.income, values: c.invoices.map((i) => i.paidCents) },
                { name: "Em aberto", kind: "line", style: "dashed", color: colors.warn, values: c.invoices.map((i) => i.openCents) },
              ]}
              summary={`Evolução das faturas de ${c.card.name} por vencimento.`}
            />
          )}
          {c.byCategory.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Compras por categoria</p>
              <CategoryList label={`Compras de ${c.card.name} por categoria`} nodes={c.byCategory} onOpen={(n) => onDrill({ title: `${c.card.name} · ${n.name} — ${formatMoney(n.totalCents)}`, node: n, transactions: n.transactions })} />
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Próximas parcelas ({formatMoney(c.upcomingInstallmentsCents)} nos próximos meses)</p>
            {c.upcomingInstallments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma parcela futura.</p>
            ) : (
              <ul className="divide-y divide-border text-sm" aria-label="Próximas parcelas">
                {c.upcomingInstallments.map(({ tx, date }) => (
                  <li key={tx.id} className="flex justify-between gap-3 py-1.5">
                    <span className="truncate">{tx.description} <span className="text-xs text-muted-foreground">({tx.installment?.number}/{tx.installment?.total}) · {formatDate(date)}</span></span>
                    <span className="tabular-nums">{formatMoney(tx.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Dívidas
// ---------------------------------------------------------------------------------------------------------------------

const debtStatus: Record<string, string> = { active: "Ativa", paused: "Pausada", paid: "Quitada", canceled: "Cancelada" };

export function DebtsSection({ report }: Props) {
  const d = report.debts;
  return (
    <div className="flex flex-col gap-4" data-testid="section-debts">
      <Note>
        O pagamento de uma dívida pertence ao FLUXO DE CAIXA (e aparece à parte do consumo). A separação entre principal e juros ainda não existe: o “custo financeiro” abaixo é só o total contratado menos o valor original, sem taxa efetiva nem estimativa proporcional (melhoria futura).
      </Note>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi id="d-principal" label="Valor original" value={formatMoney(d.principalCents)} formula="Quanto foi recebido/devido originalmente." />
        <Kpi id="d-total" label="Total contratado" value={formatMoney(d.totalCents)} formula="Quanto será pago no total." />
        <Kpi id="d-paid" label="Total pago" value={formatMoney(d.paidCents)} formula="Soma dos pagamentos realizados (todos os tempos)." />
        <Kpi id="d-remaining" label="Restante" value={formatMoney(d.remainingCents)} formula="Saldo devido das dívidas ativas e pausadas." />
        <Kpi id="d-cost" label="Custo financeiro projetado" value={formatMoney(d.financialCostCents)} formula="Total contratado − valor original. Não é taxa de juros." />
        <Kpi id="d-period" label="Pagos no período" value={formatMoney(d.paymentsInPeriodCents)} formula="Saída de caixa no período selecionado." />
        <Kpi id="d-future" label="Parcelas futuras em aberto" value={formatMoney(d.futureInstallmentsCents)} formula="Parcelas com vencimento depois de hoje." />
        <Kpi id="d-discount" label="Descontos de quitação" value={formatMoney(d.discountsCents)} formula="Diferença entre o saldo projetado e o valor pago em quitações antecipadas." />
      </div>
      {d.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma dívida cadastrada no escopo.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {d.rows.map((r) => (
            <Section key={r.debt.id} title={r.debt.name} action={<Badge tone={r.status === "paid" ? "primary" : r.status === "canceled" ? "neutral" : "success"}>{debtStatus[r.status] ?? r.status}</Badge>}>
              <p className="text-sm">
                <strong className="tabular-nums">{formatMoney(r.totalCents)}</strong> contratados · <span className="tabular-nums text-success">{formatMoney(r.paidCents)}</span> pagos · <span className="tabular-nums">{formatMoney(r.remainingCents)}</span> restantes
              </p>
              <ProgressBar value={r.progressPercent} color="var(--primary)" label={`Progresso de ${r.debt.name}`} />
              <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div><dt>Valor original</dt><dd className="tabular-nums text-foreground">{formatMoney(r.principalCents)}</dd></div>
                <div><dt>Custo financeiro</dt><dd className="tabular-nums text-foreground">{formatMoney(r.financialCostCents)}</dd></div>
                <div><dt>Pagos no período</dt><dd className="tabular-nums text-foreground">{formatMoney(r.paymentsInPeriodCents)} ({r.paymentsInPeriodCount})</dd></div>
                <div><dt>Parcelas futuras</dt><dd className="tabular-nums text-foreground">{formatMoney(r.futureInstallmentsCents)} ({r.futureInstallmentsCount})</dd></div>
              </dl>
              {r.settledAt && <p className="text-xs text-muted-foreground">Quitada em {formatDate(r.settledAt)} com desconto de <strong className="text-foreground">{formatMoney(r.settlementDiscountCents ?? 0)}</strong>.</p>}
            </Section>
          ))}
        </div>
      )}
      <DataTable
        labels={d.rows.map((r) => r.debt.name)}
        series={[{ name: "Restante", values: d.rows.map((r) => r.remainingCents) }, { name: "Pago", values: d.rows.map((r) => r.paidCents) }]}
        caption="Pago e restante por dívida"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Patrimônio
// ---------------------------------------------------------------------------------------------------------------------

export function NetWorthSection({ report }: Props) {
  const n = report.netWorth;
  return (
    <div className="flex flex-col gap-4" data-testid="section-networth">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi id="nw-accounts" label="Contas" value={formatMoney(n.accountsCents)} formula="Saldo atual das contas que não são de investimento (ativas, incluídas no patrimônio)." />
        <Kpi id="nw-invest" label="Investimentos" value={formatMoney(n.investmentsCents)} formula="Saldo das contas do tipo investimento (ativas, incluídas no patrimônio)." />
        <Kpi id="nw-financial" label="Patrimônio financeiro" value={formatMoney(n.financialCents)} formula="Contas + investimentos. Cofrinhos NÃO aumentam: são divisão virtual do mesmo dinheiro." />
        <Kpi id="nw-net" label="Patrimônio líquido" value={formatMoney(n.netCents)} tone={n.netCents < 0 ? "negative" : undefined} formula="Patrimônio financeiro − dívidas restantes (ativas e pausadas)." />
      </div>
      <Note>
        Ativos considerados: contas ativas marcadas “incluir no patrimônio” (correntes, digitais, poupança, carteira, dinheiro e investimentos). Passivo considerado: saldo devido das dívidas ativas/pausadas ({formatMoney(n.debtsCents)}). Faturas de cartão em aberto ({formatMoney(n.openInvoicesCents)}) são mostradas para informação e NÃO são deduzidas. A evolução histórica cobre só os ativos (o passivo não é reconstruído mês a mês).
      </Note>
      <Section title="Evolução do patrimônio financeiro" description="Saldo ao fim de cada mês, reconstruído a partir do saldo de hoje e das movimentações pagas depois.">
        <ComboChart
          testId="chart-networth"
          labels={n.months.map((m) => shortMonth(m.month))}
          series={[
            { name: "Contas", kind: "bar", style: "solid", color: colors.net, values: n.months.map((m) => m.accountsCents) },
            { name: "Investimentos", kind: "bar", style: "dots", color: colors.income, values: n.months.map((m) => m.investmentsCents) },
            { name: "Patrimônio financeiro", kind: "line", style: "dashed", color: colors.warn, values: n.months.map((m) => m.totalCents) },
          ]}
          summary={`Patrimônio financeiro hoje ${formatMoney(n.financialCents)}.`}
        />
      </Section>
      <Section title="Ativos considerados">
        <ul className="divide-y divide-border text-sm" aria-label="Ativos considerados">
          {n.assets.map((a) => (
            <li key={a.accountId} className="flex justify-between py-1.5"><span>{a.name}</span><span className="tabular-nums">{formatMoney(a.balanceCents)}</span></li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Cofrinhos e objetivos
// ---------------------------------------------------------------------------------------------------------------------

const goalState: Record<string, { label: string; icon: typeof Clock; tone: "success" | "warning" | "danger" | "neutral" | "primary" }> = {
  completed: { label: "Concluído", icon: CheckCircle2, tone: "primary" },
  late: { label: "Atrasado", icon: AlertTriangle, tone: "danger" },
  near: { label: "Prazo próximo", icon: Clock, tone: "warning" },
  ongoing: { label: "Em andamento", icon: Clock, tone: "success" },
  paused: { label: "Pausado", icon: Clock, tone: "neutral" },
  canceled: { label: "Cancelado", icon: Clock, tone: "neutral" },
};

export function PocketsSection({ report }: Props) {
  const p = report.pockets;
  return (
    <div className="flex flex-col gap-4" data-testid="section-pockets">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi id="pk-reserved" label="Total reservado" value={formatMoney(p.reservedCents)} formula="Soma dos cofrinhos hoje. Já está dentro do saldo das contas." />
        <Kpi id="pk-move" label="Movimento no período" value={formatMoney(p.periodMovementCents)} formula="Reservas − retiradas − usos + estornos no período." />
        <Kpi id="pk-goals" label="Objetivos concluídos" value={String(p.goals.filter((g) => g.state === "completed").length)} formula="Concluídos ou com a meta atingida." />
        <Kpi id="pk-late" label="Atrasados / próximos do prazo" value={`${p.goals.filter((g) => g.state === "late").length} / ${p.goals.filter((g) => g.state === "near").length}`} formula="Prazo vencido sem atingir a meta / vence em até 60 dias." />
      </div>
      <Note>Cofrinhos não aumentam o patrimônio: são uma divisão virtual do dinheiro que já está nas contas. O progresso informado manualmente de um objetivo NÃO é dinheiro real e não entra no total reservado.</Note>
      <Section title="Evolução das reservas" description="Reservado ao fim de cada mês.">
        <ComboChart
          labels={p.months.map((m) => shortMonth(m.month))}
          series={[{ name: "Reservado", kind: "bar", style: "dots", color: colors.net, values: p.months.map((m) => m.reservedCents) }]}
          summary={`Total reservado hoje ${formatMoney(p.reservedCents)}.`}
        />
      </Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Distribuição por cofrinho">
          <ul className="flex flex-col gap-2" aria-label="Distribuição por cofrinho">
            {p.byPocket.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cofrinho no escopo.</p>}
            {p.byPocket.map((b) => (
              <li key={b.pocket.id} className="flex flex-col gap-1 text-sm">
                <span className="flex items-baseline justify-between"><span className="font-medium">{b.pocket.name}</span><span className="tabular-nums">{formatMoney(b.balanceCents)}</span></span>
                <MeterBar percent={b.percent} color={b.pocket.color} />
                <span className="text-xs text-muted-foreground">{b.percent.toLocaleString("pt-BR")}%</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Progresso dos objetivos">
          <ul className="flex flex-col gap-3" aria-label="Progresso dos objetivos" data-testid="goal-progress">
            {p.goals.length === 0 && <p className="text-sm text-muted-foreground">Nenhum objetivo no escopo.</p>}
            {p.goals.map(({ goal, progress, daysLeft, state }) => {
              const s = goalState[state];
              return (
                <li key={goal.id} className="flex flex-col gap-1 text-sm">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{goal.name}</span>
                    <Badge tone={s.tone}><s.icon className="mr-1 size-3" aria-hidden />{s.label}</Badge>
                  </span>
                  <ProgressBar value={progress.percent} color={progress.source === "manual" ? "var(--muted-foreground)" : goal.color} label={`Progresso de ${goal.name}`} />
                  <span className="text-xs text-muted-foreground">
                    {formatMoney(progress.currentCents)} de {formatMoney(goal.targetCents)} · {Math.round(progress.percent)}% · {progress.source === "manual" ? "informado manualmente (não é dinheiro reservado)" : "reservado em cofrinho"}
                    {goal.deadline && ` · prazo ${formatDate(goal.deadline)}${daysLeft !== undefined && daysLeft < 0 ? " (vencido)" : ""}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    </div>
  );
}

export { ownerOf };
