import { cashDateOf, bucketOf, type Report } from "@/domain/reports";
import type { Transaction, WorkspaceData } from "@/domain/types";
import { money, toCsv } from "@/lib/csv";
import { statusLabel, transactionKindLabel } from "@/lib/labels";

/**
 * CSV dos relatórios. Respeita os filtros ativos: parte SEMPRE do `Report` já calculado (o mesmo que a tela mostra), nunca
 * de uma consulta paralela. Valores em reais com vírgula; datas ISO (AAAA-MM-DD) para ordenar/filtrar na planilha.
 */
function names(data: WorkspaceData) {
  return {
    profiles: new Map(data.profiles.map((p) => [p.id, p.name])),
    accounts: new Map(data.accounts.map((a) => [a.id, a.name])),
    cards: new Map(data.creditCards.map((c) => [c.id, c.name])),
    categories: new Map(data.categories.map((c) => [c.id, c])),
    debts: new Map(data.debts.map((d) => [d.id, d.name])),
  };
}

const MOVEMENT_HEADERS = ["Data", "Data de pagamento", "Tipo", "Descrição", "Valor", "Situação", "Categoria", "Subcategoria", "Pessoa", "Conta", "Conta de destino", "Cartão", "Parcela", "Dívida", "Recorrente", "Tags", "Observações"];

function movementRow(tx: Transaction, report: Report, data: WorkspaceData) {
  const n = names(data);
  const category = tx.categoryId ? n.categories.get(tx.categoryId) : undefined;
  const root = category?.parentId ? n.categories.get(category.parentId) : category;
  const status = bucketOf(tx, report.today);
  return [
    tx.date,
    tx.status === "paid" && tx.kind !== "credit_card_purchase" ? cashDateOf(tx) : "",
    transactionKindLabel[tx.kind],
    tx.description,
    money(tx.amountCents),
    statusLabel(tx.kind, status === "canceled" ? "canceled" : tx.status === "paid" || status === "realized" ? "paid" : tx.status),
    root?.name ?? "",
    category?.parentId ? category.name : "",
    n.profiles.get(tx.profileId) ?? "",
    tx.accountId ? (n.accounts.get(tx.accountId) ?? "") : "",
    tx.toAccountId ? (n.accounts.get(tx.toAccountId) ?? "") : "",
    tx.cardId ? (n.cards.get(tx.cardId) ?? "") : "",
    tx.installment ? `${tx.installment.number}/${tx.installment.total}` : "",
    tx.debtId ? (n.debts.get(tx.debtId) ?? "") : "",
    !!tx.recurringId,
    tx.tags.join(", "),
    tx.notes ?? "",
  ];
}

export const movementsCsv = (report: Report, data: WorkspaceData) =>
  toCsv(MOVEMENT_HEADERS, report.movements.map((t) => movementRow(t, report, data)));

export const incomeCsv = (report: Report, data: WorkspaceData) =>
  toCsv(MOVEMENT_HEADERS, report.income.rows.map((t) => movementRow(t, report, data)));

/** Despesas de consumo (sem pagamentos de dívida, de fatura nem transferências). */
export const expensesCsv = (report: Report, data: WorkspaceData) =>
  toCsv(MOVEMENT_HEADERS, report.expenses.rows.map((t) => movementRow(t, report, data)));

/** Fluxo de caixa: uma linha por movimentação de DINHEIRO (entrada/saída, pela data de pagamento). */
export function cashFlowCsv(report: Report, data: WorkspaceData) {
  const n = names(data);
  const headers = ["Data do pagamento", "Sentido", "Tipo", "Descrição", "Valor", "Pessoa", "Conta", "Cartão", "Dívida"];
  const rows = report.cashFlow.rows.map(({ tx, direction, date }) => [
    date,
    direction === "in" ? "Entrada" : "Saída",
    transactionKindLabel[tx.kind],
    tx.description,
    money(direction === "in" ? tx.amountCents : -tx.amountCents),
    n.profiles.get(tx.profileId) ?? "",
    tx.accountId ? (n.accounts.get(tx.accountId) ?? "") : "",
    tx.cardId ? (n.cards.get(tx.cardId) ?? "") : "",
    tx.debtId ? (n.debts.get(tx.debtId) ?? "") : "",
  ]);
  return toCsv(headers, rows);
}

/** Fluxo de caixa agregado por mês: entradas, saídas e resultado líquido (mais o consumo e a receita por competência). */
export function cashFlowMonthlyCsv(report: Report) {
  return toCsv(
    ["Mês", "Entradas de caixa", "Saídas de caixa", "Resultado líquido de caixa", "Receitas (competência)", "Despesas de consumo (competência)"],
    report.cashFlow.months.map((m) => [m.month, money(m.cashInCents), money(m.cashOutCents), money(m.cashNetCents), money(m.incomeCents), money(m.consumptionCents)]),
  );
}
