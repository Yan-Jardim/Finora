import { z } from "zod";
import type { Account } from "@/domain/types";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import { DEFAULT_COLOR } from "@/lib/palette";
import { colorField, moneyField, optionalText, requiredText } from "./shared";

export const accountTypes = ["checking", "digital", "savings", "wallet", "cash", "investment", "other"] as const;

export const accountSchema = z.object({
  name: requiredText("o nome da conta"),
  institution: optionalText(),
  ownerProfileId: z.string().min(1, "Escolha o proprietário."),
  type: z.enum(accountTypes),
  initialBalance: moneyField({ allowNegative: true }),
  color: colorField,
  icon: z.string().min(1, "Escolha um ícone."),
  includeInNetWorth: z.boolean(),
});

export type AccountFormValues = z.infer<typeof accountSchema>;

export const accountDefaults: AccountFormValues = {
  name: "",
  institution: "",
  ownerProfileId: "",
  type: "checking",
  initialBalance: "0,00",
  color: DEFAULT_COLOR,
  icon: "landmark",
  includeInNetWorth: true,
};

export const accountToForm = (a: Account): AccountFormValues => ({
  name: a.name,
  institution: a.institution ?? "",
  ownerProfileId: a.ownerProfileId,
  type: a.type,
  initialBalance: centsToInput(a.initialBalanceCents),
  color: a.color,
  icon: a.icon,
  includeInNetWorth: a.includeInNetWorth,
});

export const accountFromForm = (v: AccountFormValues) => ({
  name: v.name.trim(),
  institution: v.institution.trim() || undefined,
  ownerProfileId: v.ownerProfileId,
  type: v.type,
  initialBalanceCents: parseMoneyToCents(v.initialBalance) ?? 0,
  color: v.color,
  icon: v.icon,
  includeInNetWorth: v.includeInNetWorth,
});
