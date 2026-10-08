import { addMonths, dateWithDay } from "./dates";
import type { ISODate, RecurringTransaction, Transaction, TransactionStatus } from "./types";

/**
 * Recorrências — regras puras (sem I/O). ESPELHO EXATO de supabase (public.recurrence_dates e
 * private.sync_recurring): o mesmo roteiro roda no motor local e no banco e precisa dar o mesmo resultado
 * (veja tests/parity-recurrence.supabase.test.ts).
 *
 * Modelo: o TEMPLATE (RecurringTransaction) nunca soma. Ele gera Transactions (ocorrências) até um horizonte
 * limitado; só elas entram em saldo, despesas, dashboard, planejamento e calendário.
 */

/** Ocorrências reais são mantidas até este horizonte à frente de "hoje". */
export const RECURRENCE_HORIZON_MONTHS = 12;
export const MAX_RECURRENCE_INTERVAL = 24;

type Schedule = Pick<RecurringTransaction, "frequency" | "interval" | "startDate">;

const DAY_MS = 86_400_000;
const GUARD = 5000;

const utc = (date: ISODate) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/**
 * Datas da agenda dentro de [from, to] (inclusive), a partir da âncora `startDate`:
 *  - weekly ... âncora + 7·N·n dias;
 *  - monthly .. mês da âncora + N·n, no dia da âncora limitado ao último dia do mês. SEMPRE calculado a partir
 *               da âncora (31/01 -> 28/02 -> 31/03; nunca encadeado 28 -> 28);
 *  - yearly ... idem com 12·N·n meses (29/02 -> 28/02 em ano comum).
 * Nunca devolve datas anteriores à âncora.
 */
export function occurrenceDates(rule: Schedule, from: ISODate, to: ISODate): ISODate[] {
  const { frequency, interval, startDate } = rule;
  if (!Number.isInteger(interval) || interval < 1) throw new Error("Intervalo inválido.");
  if (to < from) return [];

  const out: ISODate[] = [];
  if (frequency === "weekly") {
    const stepDays = 7 * interval;
    const anchor = utc(startDate);
    let n = Math.max(0, Math.ceil((utc(from) - anchor) / (DAY_MS * stepDays)));
    for (let guard = 0; guard <= GUARD; guard++, n++) {
      const date = new Date(anchor + n * stepDays * DAY_MS).toISOString().slice(0, 10);
      if (date > to) break;
      out.push(date);
    }
    return out;
  }

  const stepMonths = interval * (frequency === "monthly" ? 1 : 12);
  const [ay, am, ad] = startDate.split("-").map(Number);
  const anchorIdx = ay * 12 + am - 1;
  const [fy, fm] = from.split("-").map(Number);
  let n = Math.max(0, Math.floor((fy * 12 + fm - 1 - anchorIdx) / stepMonths));
  for (let guard = 0; guard <= GUARD; guard++, n++) {
    const idx = anchorIdx + n * stepMonths;
    const date = dateWithDay(Math.floor(idx / 12), (idx % 12) + 1, ad);
    if (date > to) break;
    if (date >= from) out.push(date);
  }
  return out;
}

/** Datas que DEVEM existir como ocorrência hoje: da materialização até o horizonte (ou o fim). Pausada = nenhuma. */
export function scheduleDates(rule: RecurringTransaction, today: ISODate): ISODate[] {
  if (!rule.active) return [];
  const horizon = addMonths(today, RECURRENCE_HORIZON_MONTHS);
  const to = rule.endDate && rule.endDate < horizon ? rule.endDate : horizon;
  const from = rule.materializeFrom > rule.startDate ? rule.materializeFrom : rule.startDate;
  return occurrenceDates(rule, from, to);
}

/** Próxima data da agenda a partir de hoje (inclusive), dentro do fim da regra; null se encerrada. */
export function nextOccurrence(rule: RecurringTransaction, today: ISODate): ISODate | null {
  const span = rule.interval * (rule.frequency === "yearly" ? 12 : 1) + 1;
  const reach = addMonths(today, span);
  const to = rule.endDate && rule.endDate < reach ? rule.endDate : reach;
  return occurrenceDates(rule, today, to)[0] ?? null;
}

/** Status inicial de uma ocorrência: futura = prevista; a data chegou = pendente (a pagar/receber). */
export const occurrenceStatus = (date: ISODate, today: ISODate): TransactionStatus => (date <= today ? "pending" : "planned");

export interface SyncPlan {
  /** Datas a criar (as que faltam; respeita as puladas). */
  create: ISODate[];
  /** Ocorrências futuras canceladas pela regra que voltaram à agenda. */
  revive: string[];
  /** Ocorrências futuras previstas que saíram da agenda (pausa, fim ou mudança de agenda): canceladas pela regra. */
  cancel: string[];
  /** Previstas cuja data chegou: viram pendentes. */
  promote: string[];
}

/**
 * Plano IDEMPOTENTE de sincronização de uma regra (mesmos passos do banco). Não toca em pagas, pendentes já
 * promovidas, passadas nem em canceladas pelo usuário. Aplicar o plano e planejar de novo dá um plano vazio.
 */
export function planSync(rule: RecurringTransaction, occurrences: Transaction[], today: ISODate): SyncPlan {
  const desired = scheduleDates(rule, today);
  const desiredSet = new Set(desired);
  const mine = occurrences.filter((t) => t.recurringId === rule.id);

  const revive = mine.filter(
    (t) => t.status === "canceled" && t.canceledByRule && !!t.occurrenceDate && t.occurrenceDate > today && desiredSet.has(t.occurrenceDate),
  );
  const cancel = mine.filter(
    (t) => t.status === "planned" && !!t.occurrenceDate && t.occurrenceDate > today && !desiredSet.has(t.occurrenceDate),
  );
  const cancelIds = new Set(cancel.map((t) => t.id));
  const existing = new Set(mine.map((t) => t.occurrenceDate));
  const skipped = new Set(rule.skippedDates ?? []);
  const reviveIds = new Set(revive.map((t) => t.id));

  return {
    create: desired.filter((d) => !existing.has(d) && !skipped.has(d)),
    revive: revive.map((t) => t.id),
    cancel: cancel.map((t) => t.id),
    promote: mine
      .filter((t) => (t.status === "planned" && !cancelIds.has(t.id)) || reviveIds.has(t.id))
      .filter((t) => t.date <= today)
      .map((t) => t.id),
  };
}

// ---------------------------------------------------------------- apresentação

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const FEMININE = new Set([1, 2, 3, 4, 5]);
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "Mensal • Todo dia 10", "A cada 2 semanas • segunda-feira", "Anual • 15 de janeiro". */
export function describeSchedule(rule: Schedule): string {
  const [y, m, d] = rule.startDate.split("-").map(Number);
  const n = rule.interval;
  if (rule.frequency === "monthly") return n === 1 ? `Mensal • Todo dia ${d}` : `A cada ${n} meses • dia ${d}`;
  if (rule.frequency === "yearly") return `${n === 1 ? "Anual" : `A cada ${n} anos`} • ${d} de ${MONTHS[m - 1]}`;
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return n === 1
    ? `Semanal • ${FEMININE.has(weekday) ? "toda" : "todo"} ${WEEKDAYS[weekday]}`
    : `A cada ${n} semanas • ${WEEKDAYS[weekday]}`;
}
