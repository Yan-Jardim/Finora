import { z } from "zod";

const email = z.string().trim().toLowerCase().min(1, "Informe seu e-mail.").email("Informe um e-mail válido.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Informe sua senha."),
});

export const signupSchema = z
  .object({
    displayName: z.string().trim().min(1, "Informe seu nome.").max(40, "Máximo de 40 caracteres."),
    email,
    password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(72, "Máximo de 72 caracteres."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não conferem.",
  });

export const onboardingSchema = z
  .object({
    householdName: z.string().trim().min(1, "Dê um nome ao seu espaço.").max(80, "Máximo de 80 caracteres."),
    displayName: z.string().trim().min(1, "Informe seu nome.").max(40, "Máximo de 40 caracteres."),
    shareWithPartner: z.boolean(),
    coupleName: z.string().trim().max(40, "Máximo de 40 caracteres."),
  })
  .superRefine((v, ctx) => {
    if (!v.shareWithPartner) return;
    if (!v.coupleName) ctx.addIssue({ code: "custom", path: ["coupleName"], message: "Informe o nome do perfil do casal." });
    else if (v.coupleName.toLowerCase() === v.displayName.toLowerCase())
      ctx.addIssue({ code: "custom", path: ["coupleName"], message: "Use um nome diferente do seu." });
  });

/** Estado devolvido pelas Server Actions para os formulários. */
export interface FormState {
  error?: string;
  /** Mensagem de sucesso que não redireciona (ex.: "confirme seu e-mail"). */
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Valores digitados (nunca senhas), para o formulário não esvaziar após um erro. */
  values?: Record<string, string>;
}
