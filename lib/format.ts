import type { Cents, ISODate } from "@/domain/types";

/** Único ponto que conhece locale/moeda — trocar aqui habilita outros idiomas/moedas. */
export const DEFAULT_LOCALE = "pt-BR";
export const DEFAULT_CURRENCY = "BRL";

const currency = new Intl.NumberFormat(DEFAULT_LOCALE, {
  style: "currency",
  currency: DEFAULT_CURRENCY,
});

/** 125000 -> "R$ 1.250,00" */
export function formatMoney(cents: Cents): string {
  return currency.format(cents / 100).replace(/ /g, " ");
}

/** "2026-10-05" -> "05/10/2026" (sem passar por Date: evita erro de fuso). */
export function formatDate(date: ISODate): string {
  const [y, m, d] = date.split("-");
  return new Intl.DateTimeFormat(DEFAULT_LOCALE).format(new Date(+y, +m - 1, +d));
}

/** "2026-10-05" -> "05/10" */
export function formatDayMonth(date: ISODate): string {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

/** "2026-10" -> "Outubro 2026" */
export function formatMonthYear(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const label = new Intl.DateTimeFormat(DEFAULT_LOCALE, { month: "long", year: "numeric" })
    .format(new Date(y, m - 1, 1))
    .replace(" de ", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const formatPercent = (value: number) => `${Math.round(value)}%`;
