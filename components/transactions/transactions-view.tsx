"use client";

import { ChevronLeft, ChevronRight, Plus, Receipt, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Select } from "@/components/forms/fields";
import { useToast } from "@/components/providers/toast-provider";
import { useAction, useTransactionWindow, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { DataSourceNotice } from "@/components/ui/data-source-notice";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { displayStatus, monthBreakdown, yearMonth } from "@/domain/calculations";
import { monthEnd, monthStart, shiftYearMonth } from "@/domain/dates";
import type { InstallmentScope } from "@/domain/installments";
import { EDITABLE_KINDS, transactionLockReason } from "@/domain/rules";
import { pocketUses } from "@/domain/pockets";
import { snapshotInvoiceIndex, snapshotOf } from "@/domain/snapshot";
import type { Transaction, TransactionStatus } from "@/domain/types";
import { formatMoney, formatMonthYear } from "@/lib/format";
import { statusLabel, transactionKindLabel } from "@/lib/labels";
import { ScopeDialog } from "./scope-dialog";
import { TransactionFormDialog } from "./transaction-form";
import { TransactionRow, type RowActions } from "./transaction-row";

interface Filters {
  profile: string;
  kind: string;
  account: string;
  card: string;
  category: string;
  status: string;
}
const NO_FILTERS: Filters = { profile: "all", kind: "all", account: "all", card: "all", category: "all", status: "all" };

const kindFilterOptions = ["income", "expense", "credit_card_purchase", "transfer", "card_payment", "debt_payment"] as const;
const statusFilterOptions: TransactionStatus[] = ["paid", "pending", "overdue", "planned", "canceled"];

function SummaryTile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <p className={`whitespace-nowrap text-xl font-semibold tracking-tight tabular-nums sm:text-2xl ${tone}`}>{value}</p>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </Card>
  );
}

export function TransactionsView() {
  const { data, ready, commands, pocketCommands, reload, today } = useWorkspace();
  const run = useAction();
  const toast = useToast();

  const [month, setMonth] = useState(today.slice(0, 7));
  // No Supabase só o mês exibido é carregado (o histórico inteiro nunca vem para o navegador).
  const { loading: monthLoading } = useTransactionWindow({ from: monthStart(month), to: monthEnd(month) });
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [form, setForm] = useState<{ open: boolean; tx?: Transaction; scope: InstallmentScope }>({ open: false, scope: "this" });
  const [scopeDialog, setScopeDialog] = useState<{ tx: Transaction; mode: "edit" | "delete" } | undefined>();
  const [deleting, setDeleting] = useState<Transaction | undefined>();
  const [reversing, setReversing] = useState<Transaction | undefined>();

  const maps = useMemo(
    () => ({
      cards: new Map(data.creditCards.map((c) => [c.id, c])),
      accounts: new Map(data.accounts.map((a) => [a.id, a])),
      profiles: new Map(data.profiles.map((p) => [p.id, p])),
      categories: new Map(data.categories.map((c) => [c.id, c])),
      // Faturas (e a trava de fatura paga) vêm do snapshot: views do banco ou derivado no modo local.
      invoices: snapshotInvoiceIndex(snapshotOf(data, today)),
      debts: new Map(data.debts.map((d) => [d.id, d])),
      pockets: new Map(data.pockets.map((p) => [p.id, p])),
      // Despesas que usaram cofrinho: vêm do histórico (no Supabase só os movimentos use/use_reversal são carregados).
      uses: pocketUses(data.pocketMovements),
    }),
    [data, today],
  );

  if (!ready) return <PageSkeleton />;

  const setFilter = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const hasFilters = Object.values(filters).some((v) => v !== "all");
  const statusOf = (tx: Transaction) => displayStatus(tx, today, maps.cards, maps.invoices);

  // Todos os filtros, exceto status, alimentam os cartões de resumo (que não "somem" ao filtrar status).
  const base = data.transactions.filter((tx) => {
    if (yearMonth(tx.date) !== month) return false;
    // Ocorrências canceladas PELA REGRA (recorrência pausada/alterada) são artefato do sistema: só aparecem filtrando por "Cancelado".
    if (tx.canceledByRule && filters.status !== "canceled") return false;
    if (filters.profile !== "all" && tx.profileId !== filters.profile) return false;
    if (filters.kind !== "all" && tx.kind !== filters.kind) return false;
    if (filters.account !== "all" && tx.accountId !== filters.account && tx.toAccountId !== filters.account) return false;
    if (filters.card !== "all" && tx.cardId !== filters.card) return false;
    if (filters.category !== "all") {
      const category = maps.categories.get(tx.categoryId ?? "");
      if (tx.categoryId !== filters.category && category?.parentId !== filters.category) return false;
    }
    return true;
  });
  const list = base
    .filter((tx) => filters.status === "all" || statusOf(tx) === filters.status)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const totals = monthBreakdown(base, month, today);

  const placeOf = (tx: Transaction) => {
    const from = maps.accounts.get(tx.accountId ?? "")?.name ?? "—";
    if (tx.kind === "transfer") return `${from} → ${maps.accounts.get(tx.toAccountId ?? "")?.name ?? "—"}`;
    if (tx.kind === "card_payment") return `${from} → ${maps.cards.get(tx.cardId ?? "")?.name ?? "—"}`;
    return tx.cardId ? (maps.cards.get(tx.cardId)?.name ?? "—") : from;
  };

  const lockOf = (tx: Transaction) => {
    // Pagamento de dívida QUITADA: reabra a dívida antes de excluí-lo (o banco também recusa).
    if (tx.debtId && maps.debts.get(tx.debtId)?.settledAt) {
      return "Esta dívida foi quitada. Reabra a dívida em Dívidas antes de excluir este pagamento.";
    }
    return transactionLockReason(tx, maps.cards, maps.invoices);
  };
  const changeStatus = (tx: Transaction, status: TransactionStatus, message: string) =>
    run(() => commands.setStatus(tx, status), message);

  const actionsFor = (tx: Transaction): RowActions => {
    const status = statusOf(tx);
    // Despesa ligada a cofrinho: sem "Excluir", status ou cancelamento manual — só "Estornar" (o histórico é preservado).
    const use = maps.uses.get(tx.id);
    if (use) {
      return { onEdit: tx.status === "canceled" ? undefined : () => setForm({ open: true, tx, scope: "this" }), onReverse: use.reversed ? undefined : () => setReversing(tx) };
    }
    const locked = lockOf(tx) !== null;
    const accountKind = tx.kind === "income" || tx.kind === "expense" || tx.kind === "transfer";
    const cardPurchase = tx.kind === "credit_card_purchase";
    const canceled = tx.status === "canceled";
    const editable = EDITABLE_KINDS.includes(tx.kind) && !canceled && !locked;

    return {
      onEdit: editable
        ? () => (tx.installment ? setScopeDialog({ tx, mode: "edit" }) : setForm({ open: true, tx, scope: "this" }))
        : undefined,
      onMarkPaid:
        accountKind && !canceled && status !== "paid"
          ? () => changeStatus(tx, "paid", tx.kind === "income" ? "Marcado como recebido." : "Marcado como pago.")
          : undefined,
      onMarkPending:
        accountKind && !canceled && (status === "paid" || status === "planned")
          ? () => changeStatus(tx, "pending", "Marcado como pendente.")
          : undefined,
      onCancel:
        (accountKind || cardPurchase) && !canceled && !locked ? () => changeStatus(tx, "canceled", "Movimentação cancelada.") : undefined,
      onReactivate: canceled
        ? () => changeStatus(tx, cardPurchase && tx.date > today ? "planned" : "pending", "Movimentação reativada.")
        : undefined,
      onDelete: () => (tx.installment && !locked ? setScopeDialog({ tx, mode: "delete" }) : setDeleting(tx)),
    };
  };

  /** Exclusão com feedback detalhado (parcelas excluídas / mantidas por já estarem pagas). */
  const confirmDelete = async (tx: Transaction, scope: InstallmentScope) => {
    try {
      const result = await commands.delete(tx, scope);
      await reload();
      let message = result.deleted > 1 ? `${result.deleted} parcelas excluídas.` : "Movimentação excluída.";
      if (result.keptPaid > 0) message += ` ${result.keptPaid} parcela(s) já paga(s) mantida(s).`;
      toast.success(message);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir.");
      return false;
    }
  };

  const newButton = (
    <Button onClick={() => setForm({ open: true, scope: "this" })}>
      <Plus className="size-4" aria-hidden /> Nova movimentação
    </Button>
  );

  const categoryOptions = data.categories.filter((c) => !c.parentId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Movimentações"
        description="Receitas, despesas, transferências e compras no cartão."
        action={newButton}
      />

      <DataSourceNotice />

      {data.transactionsTruncated && (
        <p role="status" className="rounded-xl border border-border bg-warning-soft px-4 py-3 text-xs text-warning">
          Este mês tem mais movimentações do que o limite carregado de uma vez. Use os filtros de perfil, conta ou categoria
          para reduzir a lista; os totais acima consideram apenas o que foi carregado.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy={monthLoading}>
        <SummaryTile label="Receitas do mês" value={formatMoney(totals.incomeReceivedCents)} hint={totals.incomeOpenCents ? `A receber ${formatMoney(totals.incomeOpenCents)}` : "Tudo recebido"} tone="text-success" />
        <SummaryTile label="Despesas realizadas" value={formatMoney(totals.realizedCents)} hint="Pagas ou no cartão" tone="text-danger" />
        <SummaryTile label="Pendentes" value={formatMoney(totals.pendingCents)} hint="Contas a pagar no mês" tone="text-warning" />
        <SummaryTile label="Previstas" value={formatMoney(totals.plannedCents)} hint="Gastos futuros do mês" tone="text-muted-foreground" />
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" aria-label="Mês anterior" onClick={() => setMonth(shiftYearMonth(month, -1))}>
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="min-w-36 text-center text-sm font-semibold" aria-live="polite">
              {formatMonthYear(month)}
            </span>
            <Button variant="secondary" size="sm" aria-label="Próximo mês" onClick={() => setMonth(shiftYearMonth(month, 1))}>
              <ChevronRight className="size-4" aria-hidden />
            </Button>
            {month !== today.slice(0, 7) && (
              <Button variant="ghost" size="sm" onClick={() => setMonth(today.slice(0, 7))}>
                Mês atual
              </Button>
            )}
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => setFilters(NO_FILTERS)}>
              <X className="size-3.5" aria-hidden /> Limpar filtros
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Select aria-label="Filtrar por perfil" value={filters.profile} onChange={(e) => setFilter("profile", e.target.value)}>
            <option value="all">Perfis</option>
            {data.profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Select aria-label="Filtrar por tipo" value={filters.kind} onChange={(e) => setFilter("kind", e.target.value)}>
            <option value="all">Tipos</option>
            {kindFilterOptions.map((k) => (
              <option key={k} value={k}>{transactionKindLabel[k]}</option>
            ))}
          </Select>
          <Select aria-label="Filtrar por conta" value={filters.account} onChange={(e) => setFilter("account", e.target.value)}>
            <option value="all">Contas</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
          <Select aria-label="Filtrar por cartão" value={filters.card} onChange={(e) => setFilter("card", e.target.value)}>
            <option value="all">Cartões</option>
            {data.creditCards.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select aria-label="Filtrar por categoria" value={filters.category} onChange={(e) => setFilter("category", e.target.value)}>
            <option value="all">Categorias</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Select aria-label="Filtrar por status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
            <option value="all">Status</option>
            {statusFilterOptions.map((s) => (
              <option key={s} value={s}>{statusLabel("expense", s)}</option>
            ))}
          </Select>
        </div>
      </Card>

      <Card className={"p-0 transition-opacity " + (monthLoading ? "opacity-60" : "")} aria-busy={monthLoading}>
        {list.length === 0 && monthLoading ? (
          <p role="status" className="px-5 py-10 text-center text-sm text-muted-foreground">Carregando movimentações…</p>
        ) : list.length === 0 ? (
          data.transactions.length === 0 && month === today.slice(0, 7) ? (
            <>
              <EmptyState
                icon={Receipt}
                title="Nenhuma movimentação registrada"
                description="Registre sua primeira receita ou despesa para começar a acompanhar suas finanças."
              />
              <div className="flex justify-center pb-6">{newButton}</div>
            </>
          ) : (
            <EmptyState
              icon={Receipt}
              title={hasFilters ? "Nenhuma movimentação com esses filtros" : `Nada registrado em ${formatMonthYear(month)}`}
              description={hasFilters ? "Ajuste ou limpe os filtros para ver mais resultados." : "Use outro mês ou registre uma nova movimentação."}
            />
          )
        ) : (
          <>
            <p className="border-b border-border px-5 py-3 text-xs text-muted-foreground">
              {list.length} {list.length === 1 ? "movimentação" : "movimentações"}
            </p>
            <ul className="divide-y divide-border">
              {list.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  status={statusOf(tx)}
                  category={maps.categories.get(tx.categoryId ?? "")}
                  profile={maps.profiles.get(tx.profileId)}
                  place={placeOf(tx)}
                  debtName={tx.debtId ? maps.debts.get(tx.debtId)?.name : undefined}
                  pocketUse={(() => {
                    const use = maps.uses.get(tx.id);
                    return use ? { pocketName: maps.pockets.get(use.pocketId)?.name ?? "Cofrinho", amountCents: use.amountCents, reversed: use.reversed } : undefined;
                  })()}
                  actions={actionsFor(tx)}
                />
              ))}
            </ul>
          </>
        )}
      </Card>

      <TransactionFormDialog
        open={form.open}
        onClose={() => setForm({ open: false, scope: "this" })}
        transaction={form.tx}
        scope={form.scope}
      />

      <ScopeDialog
        tx={scopeDialog?.tx}
        mode={scopeDialog?.mode ?? "delete"}
        onClose={() => setScopeDialog(undefined)}
        onConfirm={async (scope) => {
          const { tx, mode } = scopeDialog!;
          if (mode === "edit") {
            setScopeDialog(undefined);
            setForm({ open: true, tx, scope });
          } else if (await confirmDelete(tx, scope)) {
            setScopeDialog(undefined);
          }
        }}
      />

      <ConfirmDialog
        open={!!reversing}
        onClose={() => setReversing(undefined)}
        title={`Estornar "${reversing?.description}"?`}
        description="A despesa ficará como cancelada, o saldo da conta será restaurado, o valor efetivamente usado da reserva voltará ao cofrinho e o histórico será preservado."
        confirmLabel="Estornar"
        onConfirm={() => run(() => pocketCommands.reverseUse(reversing!.id), "Despesa estornada: o saldo e a reserva foram restaurados.")}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        title={`Excluir "${deleting?.description}"?`}
        description={
          deleting?.kind === "card_payment"
            ? "O pagamento será removido: o valor volta para a conta e a fatura volta a ficar em aberto."
            : deleting?.debtId
              ? "O pagamento será removido: o valor volta para a conta e o saldo devido da dívida aumenta. Para registrar outro valor, use Pagar parcela em Dívidas."
              : deleting?.recurringId
                ? "Esta ocorrência será ignorada: a recorrência não vai recriá-la. Para parar de gerar, pause a recorrência."
              : "Esta ação não pode ser desfeita."
        }
        blockedReason={deleting ? (lockOf(deleting) ?? undefined) : undefined}
        onConfirm={() => confirmDelete(deleting!, "this")}
      />
    </div>
  );
}
