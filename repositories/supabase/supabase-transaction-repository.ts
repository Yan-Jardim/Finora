import type { SupabaseClient } from "@supabase/supabase-js";
import type { Transaction } from "@/domain/types";
import type { TransactionQueryResult, TransactionRepository, TransactionWindow } from "../types";
import { toFriendlyError } from "./errors";
import { TRANSACTION_SELECT, transactionFromRow } from "./transaction-mappers";

type Row = Record<string, unknown>;

// O select usa uma string composta (relações embutidas), que o tipo gerado não infere: leitura tipada à mão.
const asRows = (data: unknown) => data as Row[];

/** Itens por ida ao banco (o PostgREST limita respostas; paginamos por intervalo). */
const PAGE_SIZE = 500;
/** Teto por janela: acima disso a tela mostra um aviso em vez de carregar sem limite. */
const MAX_ITEMS = 5000;

const BY_DATE_DESC = [
  { column: "date", ascending: false },
  { column: "id", ascending: false },
] as const;

/**
 * LEITURA de movimentações no Supabase (RLS restringe ao household do usuário).
 * Nunca carrega o histórico inteiro: sempre por janela de datas (+ pendências e recentes quando pedidas).
 * ESCRITAS ficam em SupabaseTransactionCommands (RPCs atômicas) — este repositório não tem create/update/remove.
 */
export class SupabaseTransactionRepository implements TransactionRepository {
  constructor(private readonly client: SupabaseClient) {}

  private base() {
    return this.client.from("transactions").select(TRANSACTION_SELECT);
  }

  async get(id: string): Promise<Transaction | undefined> {
    const { data, error } = await this.base().eq("id", id).maybeSingle();
    if (error) throw toFriendlyError(error);
    return data ? transactionFromRow(data as unknown as Row) : undefined;
  }

  /** Atenção: sem filtro. Existe pelo contrato; as telas usam `query`. Limitado ao teto de itens. */
  async list(): Promise<Transaction[]> {
    const { data, error } = await this.base()
      .order("date", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_ITEMS);
    if (error) throw toFriendlyError(error);
    return (asRows(data)).map(transactionFromRow);
  }

  async query(window: TransactionWindow): Promise<TransactionQueryResult> {
    const { from, to } = window;
    // Competência dentro do período; opcionalmente + contas a pagar ainda pendentes de períodos anteriores.
    const byDate = `and(date.gte.${from},date.lte.${to})`;
    // Relatórios: além da competência no período, o que foi pago no período (pago depois da data de competência).
    const inWindow = window.paidBetween ? `${byDate},and(status.eq.paid,paid_at.gte.${from},paid_at.lte.${to})` : byDate;
    const open = "status.in.(planned,pending)";
    const filter = window.openOnly
      ? // planejamento: só itens em aberto (sem compras no cartão antigas) até o fim do horizonte
        `and(${open},kind.neq.credit_card_purchase,date.lte.${window.openOnly.until}),` +
        `and(${open},kind.eq.credit_card_purchase,date.gte.${window.openOnly.cardSince},date.lte.${window.openOnly.until})` +
        (window.openOnly.withWindow ? `,${inWindow}` : "")
      : window.overdueBills
        ? `${inWindow},and(status.eq.pending,date.lt.${from},kind.in.(expense,debt_payment))`
        : inWindow;

    const found = new Map<string, Transaction>();
    let truncated = false;

    for (let offset = 0; offset < MAX_ITEMS; offset += PAGE_SIZE) {
      let q = this.base().or(filter);
      for (const o of BY_DATE_DESC) q = q.order(o.column, { ascending: o.ascending });
      const { data, error } = await q.range(offset, offset + PAGE_SIZE - 1);
      if (error) throw toFriendlyError(error);
      const rows = asRows(data);
      for (const row of rows) found.set(row.id as string, transactionFromRow(row));
      if (rows.length < PAGE_SIZE) break;
      if (offset + PAGE_SIZE >= MAX_ITEMS) truncated = true;
    }

    if (window.recent) {
      // Últimas realizadas (para "Últimas movimentações"): já aconteceram, não previstas nem canceladas.
      let q = this.base().lte("date", window.recent.today).not("status", "in", "(planned,canceled)");
      for (const o of BY_DATE_DESC) q = q.order(o.column, { ascending: o.ascending });
      const { data, error } = await q.limit(window.recent.limit);
      if (error) throw toFriendlyError(error);
      for (const row of asRows(data)) found.set(row.id as string, transactionFromRow(row));
    }

    return { items: [...found.values()], truncated };
  }

  /** Todas as parcelas de uma compra (no máximo 48): base do preview de escopo. */
  async installmentGroup(purchaseId: string): Promise<Transaction[]> {
    const { data, error } = await this.base()
      .eq("installment_purchase_id", purchaseId)
      .order("installment_number", { ascending: true });
    if (error) throw toFriendlyError(error);
    return (asRows(data)).map(transactionFromRow);
  }
}
