import { z } from "zod";
import type { Category } from "@/domain/types";
import { DEFAULT_COLOR } from "@/lib/palette";
import { colorField, requiredText } from "./shared";

export const categorySchema = z.object({
  name: requiredText("o nome", 40),
  kind: z.enum(["expense", "income", "both"]),
  color: colorField,
  icon: z.string().min(1, "Escolha um ícone."),
  /** "" = categoria principal. */
  parentId: z.string(),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;

export const categoryDefaults: CategoryFormValues = {
  name: "",
  kind: "expense",
  color: DEFAULT_COLOR,
  icon: "more",
  parentId: "",
};

export const categoryToForm = (c: Category): CategoryFormValues => ({
  name: c.name,
  kind: c.kind,
  color: c.color,
  icon: c.icon,
  parentId: c.parentId ?? "",
});

export const categoryFromForm = (v: CategoryFormValues) => ({
  name: v.name.trim(),
  kind: v.kind,
  color: v.color,
  icon: v.icon,
  parentId: v.parentId || undefined,
});
