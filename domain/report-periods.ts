import { addMonths, isValidISODate, monthEnd, monthStart, shiftYearMonth } from "./dates";
import type { ISODate } from "./types";

/**
 * Períodos dos relatórios (puro). Um período é sempre um intervalo FECHADO de datas [from, to].
 * Presets: mês, trimestre, ano e intervalo personalizado. A comparação usa o período imediatamente anterior, do mesmo
 * tamanho: por MESES inteiros quando o período cobre meses completos (Jan–Jun vs Jul–Dez do ano anterior) e por DIAS
 * nos demais casos.
 */

export type PeriodPreset = "month" | "quarter" | "year" | "custom";

export interface Period {
  from: ISODate;
  to: ISODate;
}

export const isValidPeriod = (p: Period) => isValidISODate(p.from) && isValidISODate(p.to) && p.from <= p.to;

const monthOf = (d: ISODate) => d.slice(0, 7);

/** Período de um preset em torno de uma data (ex.: "hoje"). */
export function periodFor(preset: Exclude<PeriodPreset, "custom">, anchor: ISODate): Period {
  const ym = monthOf(anchor);
  if (preset === "month") return { from: monthStart(ym), to: monthEnd(ym) };
  if (preset === "quarter") {
    const m = Number(ym.slice(5));
    const startMonth = Math.floor((m - 1) / 3) * 3 + 1;
    const first = `${ym.slice(0, 4)}-${String(startMonth).padStart(2, "0")}`;
    return { from: monthStart(first), to: monthEnd(shiftYearMonth(first, 2)) };
  }
  const year = ym.slice(0, 4);
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Navega um período de preset (mês/trimestre/ano) para frente (+1) ou para trás (−1). */
export function shiftPeriod(preset: Exclude<PeriodPreset, "custom">, period: Period, direction: 1 | -1): Period {
  const step = preset === "month" ? 1 : preset === "quarter" ? 3 : 12;
  const first = shiftYearMonth(monthOf(period.from), step * direction);
  return { from: monthStart(first), to: monthEnd(shiftYearMonth(first, step - 1)) };
}

/** Lista de meses "YYYY-MM" cobertos por um período (inclusive os parciais). */
export function monthsOf(period: Period): string[] {
  const out: string[] = [];
  for (let m = monthOf(period.from); m <= monthOf(period.to); m = shiftYearMonth(m, 1)) out.push(m);
  return out;
}

/** O período cobre meses inteiros (começa no dia 1 e termina no último dia do mês)? */
export const coversWholeMonths = (p: Period) => p.from === monthStart(monthOf(p.from)) && p.to === monthEnd(monthOf(p.to));

const dayDiff = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Número de dias do período (inclusive). */
export const periodDays = (p: Period) => dayDiff(p.from, p.to) + 1;

/** Soma dias a uma data ISO. */
export function addDays(date: ISODate, days: number): ISODate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Período anterior, do mesmo tamanho. Meses inteiros: recua o MESMO número de meses (Jan–Jun 2027 → Jul–Dez 2026).
 * Demais casos: recua o mesmo número de dias, terminando na véspera do início.
 */
export function previousPeriod(p: Period): Period {
  if (coversWholeMonths(p)) {
    const count = monthsOf(p).length;
    const first = shiftYearMonth(monthOf(p.from), -count);
    return { from: monthStart(first), to: monthEnd(shiftYearMonth(first, count - 1)) };
  }
  const days = periodDays(p);
  const to = addDays(p.from, -1);
  return { from: addDays(to, -(days - 1)), to };
}

/** Rótulo curto para a tela: "Out/2026", "Jan a Jun/2027", "01/10/2026 a 15/10/2026". */
export function periodLabel(p: Period): string {
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const label = (ym: string) => `${names[Number(ym.slice(5)) - 1]}/${ym.slice(0, 4)}`;
  if (coversWholeMonths(p)) {
    const months = monthsOf(p);
    if (months.length === 1) return label(months[0]);
    const a = months[0];
    const b = months[months.length - 1];
    return a.slice(0, 4) === b.slice(0, 4) ? `${names[Number(a.slice(5)) - 1]} a ${label(b)}` : `${label(a)} a ${label(b)}`;
  }
  const br = (d: ISODate) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  return `${br(p.from)} a ${br(p.to)}`;
}

/** Variação percentual com cuidado: período anterior zerado não tem percentual (devolve null). */
export function variation(current: number, previous: number): { deltaCents: number; percent: number | null; direction: "up" | "down" | "flat" } {
  const deltaCents = current - previous;
  const direction = deltaCents > 0 ? "up" : deltaCents < 0 ? "down" : "flat";
  if (previous === 0) return { deltaCents, percent: null, direction };
  return { deltaCents, percent: Math.round((deltaCents / Math.abs(previous)) * 1000) / 10, direction };
}

export { addMonths };
