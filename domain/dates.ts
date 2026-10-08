import type { ISODate } from "./types";

/** Utilitários de data puros (ISO "YYYY-MM-DD", sem fuso). */

const pad = (n: number) => String(n).padStart(2, "0");

export const yearMonth = (date: ISODate) => date.slice(0, 7);

/** Data local de hoje. Só deve ser chamada no cliente / em handlers (nunca congelada em módulo). */
export function todayISO(now = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * "Hoje" no fuso informado (IANA, ex.: "America/Sao_Paulo"). No modo Supabase é o fuso do household — o mesmo que o
 * banco usa (private.household_today / v_card_usage) para decidir pendente x prevista e o limite já consumido.
 * Fuso inválido cai no horário do navegador.
 */
export function todayInZone(timeZone: string, now = new Date()): ISODate {
  try {
    // en-CA formata como YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return todayISO(now);
  }
}

export const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

/** Primeiro e último dia de um mês "YYYY-MM". */
export const monthStart = (ym: string): ISODate => `${ym}-01`;
export const monthEnd = (ym: string): ISODate => `${ym}-${pad(daysInMonth(+ym.slice(0, 4), +ym.slice(5)))}`;

export function isValidISODate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/** Soma meses mantendo o dia (limitado ao último dia do mês): 31/01 + 1 = 28/02. */
export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

/** "2026-10" + 1 -> "2026-11". */
export function shiftYearMonth(ym: string, delta: number): string {
  return yearMonth(addMonths(`${ym}-01`, delta));
}

/** Data com o dia limitado ao mês (ex.: dia 31 em fevereiro). */
export function dateWithDay(year: number, month: number, day: number): ISODate {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}
