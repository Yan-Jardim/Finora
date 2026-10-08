import { z } from "zod";
import { isValidISODate } from "@/domain/dates";
import type { Goal, GoalKind, GoalStatus, ISODate, Pocket } from "@/domain/types";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import { DEFAULT_COLOR } from "@/lib/palette";
import { colorField, moneyField, optionalText, requiredText } from "./shared";

// ---------- Cofrinho ----------

export const pocketSchema = z.object({
  name: requiredText("o nome do cofrinho", 60),
  description: optionalText(300),
  profileId: z.string().min(1, "Escolha o responsável."),
  accountId: z.string().min(1, "Escolha a conta onde o dinheiro está."),
  /** Só na criação (reserva inicial opcional). */
  initial: z.string().superRefine((value, ctx) => {
    if (!value.trim()) return;
    const cents = parseMoneyToCents(value);
    if (cents === null || cents < 0) ctx.addIssue({ code: "custom", message: "Informe um valor válido. Ex.: 500,00" });
  }),
  color: colorField,
  icon: z.string().min(1, "Escolha um ícone."),
});
export type PocketFormValues = z.infer<typeof pocketSchema>;

export const pocketDefaults = (profileId = "", accountId = ""): PocketFormValues => ({
  name: "",
  description: "",
  profileId,
  accountId,
  initial: "",
  color: DEFAULT_COLOR,
  icon: "piggy-bank",
});

export const pocketToForm = (p: Pocket): PocketFormValues => ({
  name: p.name,
  description: p.description ?? "",
  profileId: p.profileId,
  accountId: p.accountId,
  initial: "",
  color: p.color,
  icon: p.icon,
});

// ---------- Reservar / retirar / transferir ----------

const dateField = z.string().refine(isValidISODate, "Informe uma data válida.");

export const pocketMoveSchema = z.object({
  pocketId: z.string().min(1, "Escolha o cofrinho."),
  amount: moneyField({ positive: true }),
  date: dateField,
  note: optionalText(300),
});
export type PocketMoveFormValues = z.infer<typeof pocketMoveSchema>;

export const pocketTransferSchema = z
  .object({
    fromPocketId: z.string().min(1, "Escolha o cofrinho de origem."),
    toPocketId: z.string().min(1, "Escolha o cofrinho de destino."),
    amount: moneyField({ positive: true }),
    date: dateField,
    note: optionalText(300),
  })
  .refine((v) => v.fromPocketId !== v.toPocketId, { path: ["toPocketId"], message: "Escolha dois cofrinhos diferentes." });
export type PocketTransferFormValues = z.infer<typeof pocketTransferSchema>;

// ---------- Objetivo ----------

export const goalKinds = ["travel", "emergency", "purchase", "education", "housing", "vehicle", "retirement", "other"] as const satisfies readonly GoalKind[];
export const goalStatuses = ["active", "paused", "completed", "canceled"] as const satisfies readonly GoalStatus[];

export const goalSchema = z.object({
  name: requiredText("o nome do objetivo", 80),
  description: optionalText(300),
  kind: z.enum(goalKinds),
  target: moneyField({ positive: true }),
  deadline: z.string().refine((v) => v === "" || isValidISODate(v), "Informe uma data válida."),
  profileId: z.string().min(1, "Escolha o responsável."),
  status: z.enum(goalStatuses),
  /** Progresso informado à mão (só vale sem cofrinho vinculado). */
  manual: z.string().superRefine((value, ctx) => {
    if (!value.trim()) return;
    const cents = parseMoneyToCents(value);
    if (cents === null || cents < 0) ctx.addIssue({ code: "custom", message: "Informe um valor válido. Ex.: 500,00" });
  }),
  color: colorField,
  icon: z.string().min(1, "Escolha um ícone."),
});
export type GoalFormValues = z.infer<typeof goalSchema>;

export const goalDefaults = (profileId = ""): GoalFormValues => ({
  name: "",
  description: "",
  kind: "other",
  target: "",
  deadline: "",
  profileId,
  status: "active",
  manual: "",
  color: DEFAULT_COLOR,
  icon: "target",
});

export const goalToForm = (g: Goal): GoalFormValues => ({
  name: g.name,
  description: g.description ?? "",
  kind: g.kind,
  target: centsToInput(g.targetCents),
  deadline: g.deadline ?? "",
  profileId: g.profileId,
  status: g.status,
  manual: g.manualAmountCents > 0 ? centsToInput(g.manualAmountCents) : "",
  color: g.color,
  icon: g.icon,
});

export const goalFromForm = (v: GoalFormValues) => ({
  name: v.name.trim(),
  description: v.description.trim() || undefined,
  kind: v.kind,
  targetCents: parseMoneyToCents(v.target) ?? 0,
  deadline: (v.deadline || undefined) as ISODate | undefined,
  profileId: v.profileId,
  status: v.status,
  manualAmountCents: parseMoneyToCents(v.manual) ?? 0,
  color: v.color,
  icon: v.icon,
});
