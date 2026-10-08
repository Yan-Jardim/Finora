"use client";

import { ChevronLeft, ChevronRight, Download, FilterX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Select } from "@/components/forms/fields";
import { useTransactionWindow, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { addMonths } from "@/domain/dates";
import {
  isValidPeriod,
  periodFor,
  periodLabel,
  previousPeriod,
  shiftPeriod,
  type Period,
  type PeriodPreset,
} from "@/domain/report-periods";
import { ALL, buildReport, defaultFilters, type ReportFilters, type StatusFilter } from "@/domain/reports";
import type { PocketMovement, Transaction, TransactionKind } from "@/domain/types";
import { downloadCsv } from "@/lib/csv";
import { transactionKindLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { cashFlowCsv, cashFlowMonthlyCsv, expensesCsv, incomeCsv, movementsCsv } from "@/services/report-csv";
import { DrillDialog, Note, type Drill } from "./report-ui";
import {
  CardsSection,
  CashFlowSection,
  DebtsSection,
  ExpensesSection,
  IncomeSection,
  NetWorthSection,
  OverviewSection,
  PocketsSection,
} from "./report-sections";

const SECTIONS = [
  { id: "overview", label: "Visão geral" },
  { id: "income", label: "Receitas" },
  { id: "expenses", label: "Despesas" },
  { id: "cashflow", label: "Fluxo de caixa" },
  { id: "cards", label: "Cartões" },
  { id: "debts", label: "Dívidas" },
  { id: "networth", label: "Patrimônio" },
  { id: "pockets", label: "Cofrinhos / Objetivos" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const KINDS: TransactionKind[] = ["income", "expense", "credit_card_purchase", "transfer", "card_payment", "debt_payment", "investment", "redemption"];
const STATUS_LABEL: Record<StatusFilter, string> = { all: "Todas", realized: "Realizadas", open: "Em aberto (pendentes/atrasadas)", planned: "Previstas" };

const EXPORTS = [
  { id: "movements", label: "Movimentações", file: "movimentacoes" },
  { id: "income", label: "Receitas", file: "receitas" },
  { id: "expenses", label: "Despesas de consumo", file: "despesas-consumo" },
  { id: "cashflow", label: "Fluxo de caixa (movimentações)", file: "fluxo-de-caixa" },
  { id: "cashflow-monthly", label: "Fluxo de caixa (por mês)", file: "fluxo-de-caixa-mensal" },
] as const;

const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

/**
 * Relatórios. A tela só orquestra: filtros → motor puro (domain/reports) sobre as movimentações do WORKSPACE (a janela do
 * período é declarada com useTransactionWindow: no Supabase só esse recorte é carregado; no local tudo já está em
 * memória) + o histórico de cofrinhos lido por repos.pockets.movements. Nenhuma regra financeira vive em componente.
 */
export function ReportsView() {
  const { data, ready, today, repos } = useWorkspace();

  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [custom, setCustom] = useState<Period>(() => periodFor("month", today));
  const [anchorPeriod, setAnchorPeriod] = useState<Period | null>(null);
  const [filters, setFilters] = useState({ profileId: ALL, accountId: ALL, cardId: ALL, categoryId: ALL, kind: ALL, status: ALL } as Omit<ReportFilters, "period">);
  const [compareMode, setCompareMode] = useState<"none" | "previous" | "custom">("none");
  const [compareCustom, setCompareCustom] = useState<Period>(() => previousPeriod(periodFor("month", today)));
  const [section, setSection] = useState<SectionId>("overview");
  const [drill, setDrill] = useState<Drill | undefined>();
  const [movements, setMovements] = useState<PocketMovement[]>([]);

  const period: Period = preset === "custom" ? custom : (anchorPeriod ?? periodFor(preset, today));
  const periodOk = isValidPeriod(period);
  const comparePeriod: Period | null = compareMode === "none" ? null : compareMode === "previous" ? (periodOk ? previousPeriod(period) : null) : compareCustom;
  const compareOk = !!comparePeriod && isValidPeriod(comparePeriod);

  // Janela de movimentações: do início da comparação/período até 12 meses à frente de hoje (próximas parcelas), incluindo o
  // que foi PAGO dentro do período mesmo com competência anterior (fluxo de caixa e patrimônio).
  const from = [period.from, compareOk ? comparePeriod!.from : period.from].sort()[0];
  const to = [period.to, addMonths(today, 12)].sort().at(-1)!;
  const { loading } = useTransactionWindow({ from: periodOk ? from : today, to: periodOk ? to : today, paidBetween: true });

  // Histórico de cofrinhos (mesmo código nos dois modos; o Supabase lê do banco, sem depender de WorkspaceData).
  useEffect(() => {
    let alive = true;
    repos.pockets
      .movements({ limit: 5000 })
      .then((items) => alive && setMovements(items))
      .catch(() => alive && setMovements([]));
    return () => {
      alive = false;
    };
  }, [repos, data]);

  const full: ReportFilters = useMemo(() => ({ ...defaultFilters(period), ...filters, period }), [period, filters]);
  const report = useMemo(() => (ready && !loading && periodOk ? buildReport({ data, pocketMovements: movements, today }, full) : null), [ready, loading, periodOk, data, movements, today, full]);
  const compare = useMemo(
    () => (report && compareOk ? buildReport({ data, pocketMovements: movements, today }, { ...full, period: comparePeriod! }) : undefined),
    [report, compareOk, data, movements, today, full, comparePeriod],
  );

  if (!ready) return <PageSkeleton />;

  const set = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const hasFilters = Object.values(filters).some((v) => v !== ALL);
  const roots = data.categories.filter((c) => !c.parentId);

  const names = (tx: Transaction) => {
    const place = tx.accountId ? data.accounts.find((a) => a.id === tx.accountId)?.name : tx.cardId ? data.creditCards.find((c) => c.id === tx.cardId)?.name : undefined;
    return [transactionKindLabel[tx.kind], data.profiles.find((p) => p.id === tx.profileId)?.name, place].filter(Boolean).join(" · ");
  };

  const exportCsv = (id: (typeof EXPORTS)[number]["id"]) => {
    if (!report) return;
    const content =
      id === "movements" ? movementsCsv(report, data) : id === "income" ? incomeCsv(report, data) : id === "expenses" ? expensesCsv(report, data) : id === "cashflow" ? cashFlowCsv(report, data) : cashFlowMonthlyCsv(report);
    const file = EXPORTS.find((e) => e.id === id)!.file;
    downloadCsv(`finora-${file}-${period.from}_${period.to}.csv`, content);
  };

  const sectionProps = report && { report, compare, onDrill: setDrill };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Relatórios"
        description="Duas visões separadas: fluxo de caixa (dinheiro que entrou e saiu das contas) e despesas de consumo (quanto foi gasto, sem dupla contagem)."
        action={
          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="export-kind" className={labelCls}>Exportar CSV</label>
              <Select id="export-kind" aria-label="Dados para exportar" defaultValue="movements" className="min-w-52">
                {EXPORTS.map((e) => (
                  <option key={e.id} value={e.id}>{e.label}</option>
                ))}
              </Select>
            </div>
            <Button
              variant="secondary"
              disabled={!report}
              onClick={() => exportCsv((document.getElementById("export-kind") as HTMLSelectElement).value as (typeof EXPORTS)[number]["id"])}
            >
              <Download className="size-4" aria-hidden /> Baixar
            </Button>
          </div>
        }
      />

      <Card className="flex flex-col gap-4" aria-label="Filtros do relatório">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="rp-preset" className={labelCls}>Período</label>
            <Select
              id="rp-preset"
              value={preset}
              onChange={(e) => {
                const next = e.target.value as PeriodPreset;
                setPreset(next);
                setAnchorPeriod(null);
                if (next === "custom") setCustom(period);
              }}
            >
              <option value="month">Mês</option>
              <option value="quarter">Trimestre</option>
              <option value="year">Ano</option>
              <option value="custom">Intervalo personalizado</option>
            </Select>
          </div>
          {preset === "custom" ? (
            <>
              <div>
                <label htmlFor="rp-from" className={labelCls}>De</label>
                <input id="rp-from" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" />
              </div>
              <div>
                <label htmlFor="rp-to" className={labelCls}>Até</label>
                <input id="rp-to" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" />
              </div>
            </>
          ) : (
            <div className="sm:col-span-2">
              <span className={labelCls}>Navegar</span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" aria-label="Período anterior" onClick={() => setAnchorPeriod(shiftPeriod(preset, period, -1))}>
                  <ChevronLeft className="size-4" aria-hidden />
                </Button>
                <span className="min-w-36 text-center text-sm font-medium" data-testid="period-label" aria-live="polite">{periodLabel(period)}</span>
                <Button variant="secondary" size="sm" aria-label="Próximo período" onClick={() => setAnchorPeriod(shiftPeriod(preset, period, 1))}>
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          )}
          <div>
            <label htmlFor="rp-profile" className={labelCls}>Pessoa / Casal</label>
            <Select id="rp-profile" value={filters.profileId} onChange={(e) => set("profileId", e.target.value)}>
              <option value={ALL}>Todos (consolidado)</option>
              {data.profiles.filter((p) => p.active).map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.kind === "shared" ? " (casal)" : ""}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="rp-account" className={labelCls}>Conta</label>
            <Select id="rp-account" value={filters.accountId} onChange={(e) => set("accountId", e.target.value)}>
              <option value={ALL}>Todas</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="rp-card" className={labelCls}>Cartão</label>
            <Select id="rp-card" value={filters.cardId} onChange={(e) => set("cardId", e.target.value)}>
              <option value={ALL}>Todos</option>
              {data.creditCards.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="rp-category" className={labelCls}>Categoria</label>
            <Select id="rp-category" value={filters.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value={ALL}>Todas</option>
              {roots.map((r) => (
                <optgroup key={r.id} label={r.name}>
                  <option value={r.id}>{r.name} (todas)</option>
                  {data.categories.filter((c) => c.parentId === r.id).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="rp-kind" className={labelCls}>Tipo de movimentação</label>
            <Select id="rp-kind" value={filters.kind} onChange={(e) => set("kind", e.target.value as ReportFilters["kind"])}>
              <option value={ALL}>Todos</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>{transactionKindLabel[k]}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="rp-status" className={labelCls}>Situação</label>
            <Select id="rp-status" value={filters.status} onChange={(e) => set("status", e.target.value as StatusFilter)}>
              {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="rp-compare" className={labelCls}>Comparar com</label>
            <Select id="rp-compare" value={compareMode} onChange={(e) => setCompareMode(e.target.value as typeof compareMode)}>
              <option value="none">Sem comparação</option>
              <option value="previous">Período anterior</option>
              <option value="custom">Outro período…</option>
            </Select>
          </div>
          {compareMode === "custom" && (
            <>
              <div>
                <label htmlFor="rp-cfrom" className={labelCls}>Comparar de</label>
                <input id="rp-cfrom" type="date" value={compareCustom.from} onChange={(e) => setCompareCustom((c) => ({ ...c, from: e.target.value }))} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" />
              </div>
              <div>
                <label htmlFor="rp-cto" className={labelCls}>Comparar até</label>
                <input id="rp-cto" type="date" value={compareCustom.to} onChange={(e) => setCompareCustom((c) => ({ ...c, to: e.target.value }))} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" />
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p data-testid="filters-summary">
            Período: <strong className="text-foreground">{periodOk ? periodLabel(period) : "inválido"}</strong>
            {compareOk && (
              <>
                {" "}· comparando com <strong className="text-foreground" data-testid="compare-label">{periodLabel(comparePeriod!)}</strong>
              </>
            )}
          </p>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => setFilters({ profileId: ALL, accountId: ALL, cardId: ALL, categoryId: ALL, kind: ALL, status: ALL })}>
              <FilterX className="size-3.5" aria-hidden /> Limpar filtros
            </Button>
          )}
        </div>
      </Card>

      <div role="tablist" aria-label="Seções do relatório" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`tab-${s.id}`}
            aria-selected={section === s.id}
            aria-controls="report-panel"
            onClick={() => setSection(s.id)}
            className={cn("shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition", section === s.id ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div id="report-panel" role="tabpanel" aria-labelledby={`tab-${section}`} className="flex flex-col gap-4">
        {!periodOk ? (
          <Note tone="warning">Período inválido: a data inicial precisa ser anterior ou igual à final.</Note>
        ) : loading || !report ? (
          <PageSkeleton />
        ) : (
          <>
            {data.transactionsTruncated && <Note tone="warning">Há mais movimentações neste período do que o limite carregado: os totais podem estar incompletos. Reduza o período.</Note>}
            {compareMode !== "none" && !compareOk && <Note tone="warning">Período de comparação inválido.</Note>}
            {section === "overview" && sectionProps && <OverviewSection {...sectionProps} />}
            {section === "income" && sectionProps && <IncomeSection {...sectionProps} />}
            {section === "expenses" && sectionProps && <ExpensesSection {...sectionProps} />}
            {section === "cashflow" && sectionProps && <CashFlowSection {...sectionProps} />}
            {section === "cards" && sectionProps && <CardsSection {...sectionProps} />}
            {section === "debts" && sectionProps && <DebtsSection {...sectionProps} />}
            {section === "networth" && sectionProps && <NetWorthSection {...sectionProps} />}
            {section === "pockets" && sectionProps && <PocketsSection {...sectionProps} />}
          </>
        )}
      </div>

      <DrillDialog drill={drill} onClose={() => setDrill(undefined)} names={names} />
    </div>
  );
}
