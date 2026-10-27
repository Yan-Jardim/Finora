import { sum } from "./calculations";
import { CALENDAR_ALL, collectEvents, isOpenEvent, type CalendarEvent } from "./calendar";
import { addMonths, monthEnd, monthStart, yearMonth } from "./dates";
import type { Category, Cents, ID, ISODate, Transaction, WorkspaceData } from "./types";
import type { RecurrenceInput } from "@/services/recurrence-commands";

/**
 * CONTAS DO MÊS — a "lista do zap" dentro do Finora: tudo o que precisa ser pago no mês numa lista só, com o que já foi
 * pago e o total pendente. Derivada do Calendário (mesmas fontes, cada obrigação por UMA porta): despesas em conta,
 * ocorrências de recorrência, faturas de cartão e parcelas de dívida. Nada é gravado aqui.
 */

export type BillSource = "bill" | "invoice" | "debt";

export interface MonthBill {
  id: string;
  source: BillSource;
  title: string;
  /** Vencimento (em aberto) ou data da movimentação (pago). */
  date: ISODate;
  amountCents: Cents;
  status: CalendarEvent["status"];
  profileId: ID;
  recurring: boolean;
  installmentLabel?: string;
  /** Despesa em conta: dá para marcar como paga (e desfazer) com um toque. */
  transactionId?: ID;
  cardId?: ID;
  debtId?: ID;
  /** Atrasada de um mês anterior (só aparece do mês atual em diante). */
  carried: boolean;
}

export interface MonthBills {
  month: string;
  open: MonthBill[];
  paid: MonthBill[];
  openCents: Cents;
  paidCents: Cents;
  totalCents: Cents;
  overdueCount: number;
}

const sourceOf = (e: CalendarEvent): BillSource | null => {
  if (e.type === "invoice" || e.type === "card_payment") return "invoice";
  if (e.type === "debt_installment" || e.type === "debt_payment") return "debt";
  if (e.type === "expense") return "bill";
  return null;
};

const byDate = (a: MonthBill, b: MonthBill) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "pt-BR");

/**
 * Lista do mês. Em aberto: toda saída de caixa ainda não paga (sem compras no cartão, que entram pela fatura). Pagas: só o
 * que é CONTA — despesa com vencimento ou recorrente, pagamento de fatura e de dívida —, para o mercado do dia a dia não
 * poluir a lista.
 */
export function buildMonthBills(data: WorkspaceData, month: string, profileId: string, today: ISODate): MonthBills {
  const start = monthStart(month);
  const end = monthEnd(month);
  const current = month >= yearMonth(today);
  const txById = new Map(data.transactions.map((t) => [t.id, t]));
  const open: MonthBill[] = [];
  const paid: MonthBill[] = [];

  for (const e of collectEvents(data, today)) {
    const source = sourceOf(e);
    if (!source) continue;
    if (profileId !== CALENDAR_ALL && e.profileId !== profileId) continue;
    const inMonth = e.date >= start && e.date <= end;
    const tx = e.transactionId ? txById.get(e.transactionId) : undefined;
    const bill: MonthBill = {
      id: e.id,
      source,
      title: e.title,
      date: e.date,
      amountCents: e.amountCents,
      status: e.status,
      profileId: e.profileId,
      recurring: e.recurring,
      installmentLabel: e.type === "debt_installment" ? undefined : e.installmentLabel,
      transactionId: source === "bill" ? e.transactionId : undefined,
      cardId: e.cardId,
      debtId: e.debtId,
      carried: false,
    };
    if (isOpenEvent(e)) {
      if (inMonth) open.push(bill);
      else if (current && e.date < start && e.status === "overdue") open.push({ ...bill, carried: true });
    } else if (inMonth && (source !== "bill" || !!tx?.dueDate || !!tx?.recurringId)) {
      paid.push(bill);
    }
  }

  open.sort(byDate);
  paid.sort(byDate);
  const openCents = sum(open.map((b) => b.amountCents));
  const paidCents = sum(paid.map((b) => b.amountCents));
  return {
    month,
    open,
    paid,
    openCents,
    paidCents,
    totalCents: openCents + paidCents,
    overdueCount: open.filter((b) => b.status === "overdue").length,
  };
}

/** Texto no formato da lista do WhatsApp, para mandar um para o outro. */
export function billsAsText(bills: MonthBills, monthLabel: string, formatMoney: (c: Cents) => string): string {
  const lines = [`Contas a pagar — ${monthLabel}`, ""];
  for (const b of bills.open) lines.push(`${formatMoney(b.amountCents)} — ${b.title}${b.status === "overdue" ? " (atrasada)" : ""}`);
  for (const b of bills.paid) lines.push(`${formatMoney(b.amountCents)} — ${b.title} ✅`);
  lines.push("", `Total pendente: ${formatMoney(bills.openCents)} (${bills.open.length} ${bills.open.length === 1 ? "conta" : "contas"})`);
  return lines.join("\n");
}

// ---------- Colar lista ----------

export interface ParsedBillLine {
  /** Linha no texto colado (1 = primeira). */
  line: number;
  description: string;
  amountCents: Cents;
  /** Tinha "ok", "pago" ou ✅. */
  paid: boolean;
  /** "(5x10)" ou "5/10": parcela atual e total. */
  installment?: { current: number; total: number };
}

export interface ParsedBillList {
  items: ParsedBillLine[];
  /** Linhas com texto mas sem valor (títulos como "Outubro"): ignoradas. */
  ignored: number;
}

const PAID_MARK = /✅|✔️?|☑️?|\b(?:ok|pago|paga)\b/giu;
const LIST_MARK = /^\s*(?:\d{1,2}[.)]\s+|[-•*·]\s*)/u;
const INSTALLMENT = /\(?\s*\b(\d{1,2})\s*(?:x|\/|de)\s*(\d{1,2})\b\s*\)?/iu;
const AMOUNT = /(R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)(?![\d.,]*\d)/gu;

function toCents(text: string): Cents {
  const [int, dec = ""] = text.replace(/\./g, "").split(",");
  return Number(int) * 100 + Number(dec.padEnd(2, "0"));
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);

/**
 * Lê a lista do jeito que vocês escrevem no WhatsApp: "Felipe 1800 ✅", "1.100 empréstimo. Ok", "R$ 777,00 — Passagem",
 * "60 tia val (5x10)". Valor no começo ou no fim da linha; "ok"/"pago"/✅ = já paga; linhas sem valor são ignoradas.
 */
export function parseBillList(text: string): ParsedBillList {
  const items: ParsedBillLine[] = [];
  let ignored = 0;
  text.split(/\r?\n/).forEach((rawLine, index) => {
    let rest = rawLine.replace(LIST_MARK, "").trim();
    if (!rest) return;
    const paid = rest.search(PAID_MARK) >= 0;
    rest = rest.replace(PAID_MARK, " ");

    let installment: ParsedBillLine["installment"];
    const inst = rest.match(INSTALLMENT);
    if (inst) {
      const current = Number(inst[1]);
      const total = Number(inst[2]);
      if (total >= 2 && current >= 1 && current <= total) {
        installment = { current, total };
        rest = rest.replace(inst[0], " ");
      }
    }

    const matches = [...rest.matchAll(AMOUNT)];
    // Prioridade: com "R$"; depois o número do começo da linha; senão o último.
    const chosen = matches.find((m) => m[1]) ?? matches.find((m) => rest.slice(0, m.index).trim() === "") ?? matches.at(-1);
    if (!chosen) {
      ignored += 1;
      return;
    }
    const amountCents = toCents(chosen[2]);
    if (amountCents <= 0) {
      ignored += 1;
      return;
    }
    const description = (rest.slice(0, chosen.index) + " " + rest.slice(chosen.index! + chosen[0].length))
      .replace(/\s+/g, " ")
      .replace(/^[\s—–\-:.,]+|[\s—–\-:.,]+$/g, "")
      .trim();
    // "Total pendente R$ 1.997,00" é a soma, não uma conta.
    if (fold(description).startsWith("total")) {
      ignored += 1;
      return;
    }
    items.push({ line: index + 1, description: capitalize(description || "Conta"), amountCents, paid, installment });
  });
  return { items, ignored };
}

// ---------- Criar o que foi colado ----------

export type BillRepeat = "once" | "monthly" | "installments";

export interface BillDraft {
  description: string;
  amountCents: Cents;
  dueDate: ISODate;
  profileId: ID;
  accountId: ID;
  categoryId: ID;
  repeat: BillRepeat;
  installment?: { current: number; total: number };
  paid: boolean;
}

export interface BillPlan {
  /** A conta DESTE mês (sempre uma despesa comum, já paga ou a pagar). */
  transaction: Omit<Transaction, "id">;
  /** Dos próximos meses em diante (todo mês ou até a última parcela). */
  rule?: RecurrenceInput;
}

/**
 * A conta do mês é sempre uma despesa comum (dá para marcar paga na hora, mesmo com vencimento já passado). Se repete,
 * uma recorrência começa no MÊS SEGUINTE — assim a regra nunca cria uma segunda conta neste mês. Parcelado "5/10" vira
 * recorrência até a parcela 10.
 */
export function planBill(draft: BillDraft, today: ISODate): BillPlan {
  const inst = draft.repeat === "installments" ? draft.installment : undefined;
  const transaction: Omit<Transaction, "id"> = {
    kind: "expense",
    description: inst ? `${draft.description} (${inst.current}/${inst.total})` : draft.description,
    amountCents: draft.amountCents,
    date: draft.dueDate,
    dueDate: draft.dueDate,
    status: draft.paid ? "paid" : "pending",
    paidAt: draft.paid ? (draft.dueDate < today ? draft.dueDate : today) : undefined,
    accountId: draft.accountId,
    categoryId: draft.categoryId,
    tags: [],
    profileId: draft.profileId,
  };
  const remaining = inst ? inst.total - inst.current : 0;
  if (draft.repeat === "once" || (draft.repeat === "installments" && remaining <= 0)) return { transaction };
  const rule: RecurrenceInput = {
    kind: "expense",
    description: draft.description,
    amountCents: draft.amountCents,
    profileId: draft.profileId,
    accountId: draft.accountId,
    categoryId: draft.categoryId,
    tags: [],
    notes: inst ? `Parcelas ${inst.current + 1} a ${inst.total}` : undefined,
    frequency: "monthly",
    interval: 1,
    startDate: addMonths(draft.dueDate, 1),
    endDate: inst ? addMonths(draft.dueDate, remaining) : undefined,
  };
  return { transaction, rule };
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/** Categoria pelo nome que aparece na descrição ("150 água" → Água); subcategoria ganha da categoria. */
export function guessCategory(description: string, categories: Category[]): ID | undefined {
  const words = ` ${fold(description).replace(/[^a-z0-9]+/g, " ")} `;
  const expense = categories.filter((c) => c.active && c.kind !== "income");
  const hits = expense.filter((c) => fold(c.name).length >= 3 && words.includes(` ${fold(c.name)} `));
  return (hits.find((c) => c.parentId) ?? hits[0])?.id;
}

/** Mesma conta já está no mês (mesmo nome e valor)? Evita duplicar ao colar a lista de novo. */
export function isDuplicateBill(item: Pick<ParsedBillLine, "description" | "amountCents">, bills: MonthBills): boolean {
  const name = fold(item.description);
  return [...bills.open, ...bills.paid].some((b) => b.amountCents === item.amountCents && fold(b.title).startsWith(name));
}
