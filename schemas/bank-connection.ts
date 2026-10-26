import { z } from "zod";

/** Conectar um banco já autorizado no Meu Pluggy: dono, qual par de credenciais usar e o Item ID da conexão. */
export const bankConnectionSchema = z.object({
  ownerProfileId: z.string().min(1, "Escolha de quem é o banco."),
  credentialKey: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, "Escolha as credenciais."),
  itemId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,100}$/, "Cole o Item ID copiado no Dashboard da Pluggy (letras, números e hífens)."),
});

export type BankConnectionFormValues = z.infer<typeof bankConnectionSchema>;
