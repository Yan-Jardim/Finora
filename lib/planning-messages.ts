import type { PlanningAlert } from "@/domain/planning";
import { formatMoney } from "@/lib/format";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-12" -> "dezembro" */
export const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1];

/** "2026-12" -> "Dez" (curto, para eixos) */
export const monthShort = (ym: string) => monthName(ym).slice(0, 3).replace(/^./, (c) => c.toUpperCase());

/** "2026-12" -> "Dezembro" */
export const monthTitle = (ym: string) => monthName(ym).replace(/^./, (c) => c.toUpperCase());

/** Texto do alerta — SEMPRE composto com os números reais da projeção (nada fixo). */
export function alertMessage(alert: PlanningAlert): string {
  const cents = alert.cents ?? 0;
  switch (alert.kind) {
    case "overdue":
      return `Existem ${alert.count} ${alert.count === 1 ? "conta atrasada" : "contas atrasadas"} (${formatMoney(cents)}).`;
    case "negative_balance":
      return `Seu saldo projetado ficará negativo em ${monthName(alert.month!)} (${formatMoney(cents)}).`;
    case "deficit":
      return `Em ${monthName(alert.month!)}, suas saídas previstas superam as receitas em ${formatMoney(cents)}.`;
    case "invoices_next_month":
      return `Você terá ${formatMoney(cents)} em faturas de cartão em ${monthName(alert.month!)}.`;
  }
}
