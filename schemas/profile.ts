import { z } from "zod";
import type { FinancialProfile } from "@/domain/types";
import { DEFAULT_COLOR } from "@/lib/palette";
import { colorField, requiredText } from "./shared";

export const profileSchema = z.object({
  name: requiredText("o nome", 40),
  kind: z.enum(["individual", "shared"]),
  color: colorField,
});

export type ProfileFormValues = z.infer<typeof profileSchema>;

export const profileDefaults: ProfileFormValues = { name: "", kind: "individual", color: DEFAULT_COLOR };

export const profileToForm = (p: FinancialProfile): ProfileFormValues => ({ name: p.name, kind: p.kind, color: p.color });

export const profileFromForm = (v: ProfileFormValues): Pick<FinancialProfile, "name" | "kind" | "color"> => ({
  name: v.name.trim(),
  kind: v.kind,
  color: v.color,
});
