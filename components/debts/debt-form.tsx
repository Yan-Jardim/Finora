"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Checkbox, Field, FormFooter, Input, Select } from "@/components/forms/fields";
import { useAction, useCurrentProfile, useWorkspace } from "@/components/providers/workspace-provider";
import { Dialog } from "@/components/ui/dialog";
import { debtSchedule } from "@/domain/debts";
import type { Debt } from "@/domain/types";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { parseMoneyToCents } from "@/lib/money";
import {
  debtDefaults,
  debtFromForm,
  debtKindLabel,
  debtKinds,
  debtPatch,
  debtSchema,
  debtToForm,
  type DebtFormValues,
} from "@/schemas/debt";

export function DebtFormDialog({ open, onClose, debt, locked }: { open: boolean; onClose: () => void; debt?: Debt; locked?: boolean }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={debt ? "Editar dívida" : "Nova dívida"}
      description="Empréstimo, financiamento ou dinheiro que você deve a alguém. A dívida não mexe no saldo: só os pagamentos."
    >
      <DebtForm debt={debt} locked={locked} onClose={onClose} />
    </Dialog>
  );
}

function DebtForm({ debt, locked, onClose }: { debt?: Debt; locked?: boolean; onClose: () => void }) {
  const { data, debtCommands, today } = useWorkspace();
  const currentProfile = useCurrentProfile();
  const run = useAction();
  const editing = !!debt;

  const profiles = data.profiles.filter((p) => p.active || p.id === debt?.profileId);
  const accounts = data.accounts.filter((a) => (a.active && a.type !== "investment") || a.id === debt?.paymentAccountId);
  const categories = data.categories.filter((c) => !c.parentId && (c.kind === "expense" || c.kind === "both" || c.id === debt?.categoryId));
  const defaultCategory = data.categories.find((c) => !c.parentId && c.name === "Dívidas")?.id ?? "";

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DebtFormValues>({
    resolver: zodResolver(debtSchema),
    defaultValues: debt ? debtToForm(debt, data.categories) : debtDefaults(today, currentProfile?.id ?? profiles[0]?.id ?? "", defaultCategory),
  });
  const [principalText, totalText, hasInstallments, installmentsText, firstDueDate] = useWatch({
    control,
    name: ["principal", "total", "hasInstallments", "installments", "firstDueDate"],
  });

  // Prévia: parcelas (mesma função que o banco/motor usam) e custo financeiro (só exibição).
  const preview = useMemo(() => {
    const principal = parseMoneyToCents(principalText);
    const total = parseMoneyToCents(totalText);
    if (principal === null || total === null || principal <= 0 || total <= 0) return null;
    const cost = total - principal;
    const n = Number(installmentsText);
    let schedule: string | null = null;
    if (hasInstallments && Number.isInteger(n) && n >= 1 && n <= 120 && /^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) {
      const rows = debtSchedule({ totalCents: total, installments: n, firstDueDate });
      const first = rows[0].amountCents;
      const last = rows[rows.length - 1].amountCents;
      schedule =
        first === last
          ? `${n}x de ${formatMoney(first)}`
          : `${n}x: ${rows.filter((r) => r.amountCents === first).length}x de ${formatMoney(first)} e ${rows.filter((r) => r.amountCents === last).length}x de ${formatMoney(last)}`;
      schedule += ` · de ${formatDate(rows[0].dueDate)} a ${formatDate(rows[rows.length - 1].dueDate)}`;
    }
    return { cost, percent: principal > 0 ? (cost / principal) * 100 : 0, schedule };
  }, [principalText, totalText, hasInstallments, installmentsText, firstDueDate]);

  const onSubmit = handleSubmit(async (values) => {
    const input = debtFromForm(values);
    if (debt) {
      const patch = debtPatch(debt, input);
      if (Object.keys(patch).length === 0) return onClose();
      const ok = await run(() => debtCommands.update(debt, patch), "Dívida atualizada.");
      if (ok) onClose();
      return;
    }
    const ok = await run(() => debtCommands.create(input), "Dívida cadastrada.");
    if (ok) onClose();
  });

  if (profiles.length === 0) {
    return <p className="rounded-lg bg-warning-soft px-3 py-3 text-sm text-warning">Cadastre uma pessoa em Pessoas antes de registrar dívidas.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {locked && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Dívida quitada: valores e parcelas ficam travados. Reabra a dívida para alterá-los.
        </p>
      )}
      <Field label="Nome" error={errors.name?.message}>
        {(p) => <Input {...p} autoFocus placeholder="Ex.: Empréstimo Banco X" {...register("name")} />}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Credor" optional error={errors.creditor?.message} hint="Instituição ou pessoa.">
          {(p) => <Input {...p} placeholder="Ex.: Banco X, Tio João" {...register("creditor")} />}
        </Field>
        <Field label="Tipo" error={errors.kind?.message}>
          {(p) => (
            <Select {...p} {...register("kind")}>
              {debtKinds.map((k) => (
                <option key={k} value={k}>
                  {debtKindLabel[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Quanto recebeu/deve" error={errors.principal?.message}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("principal")} />}
        </Field>
        <Field label="Quanto vai pagar no total" error={errors.total?.message} hint="Se não há juros, é o mesmo valor.">
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("total")} />}
        </Field>
      </div>
      {preview && preview.cost > 0 && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Custo financeiro: <strong className="text-foreground">{formatMoney(preview.cost)}</strong> (≈ {formatPercent(preview.percent)} sobre o valor original).
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
        <Checkbox label="Parcelado?" description="Desmarque se não há parcelas: você paga em valores livres até zerar." {...register("hasInstallments")} />
        {hasInstallments && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Número de parcelas" error={errors.installments?.message}>
              {(p) => <Input {...p} inputMode="numeric" maxLength={3} {...register("installments")} />}
            </Field>
            <Field label="Primeiro vencimento" error={errors.firstDueDate?.message}>
              {(p) => <Input {...p} type="date" {...register("firstDueDate")} />}
            </Field>
          </div>
        )}
        {hasInstallments && preview?.schedule && <p className="text-xs text-muted-foreground">Prévia: {preview.schedule}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Responsável" error={errors.profileId?.message}>
          {(p) => (
            <Select {...p} {...register("profileId")}>
              <option value="">Selecione…</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Conta padrão para pagar" optional hint="Só uma sugestão: no pagamento você escolhe.">
          {(p) => (
            <Select {...p} {...register("paymentAccountId")}>
              <option value="">Nenhuma</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field label="Categoria dos pagamentos" optional hint="Sem categoria, os pagamentos aparecem como “Dívidas” no dashboard.">
        {(p) => (
          <Select {...p} {...register("categoryId")}>
            <option value="">Dívidas (padrão)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Observações" optional error={errors.notes?.message}>
        {(p) => (
          <textarea
            {...p}
            rows={2}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            {...register("notes")}
          />
        )}
      </Field>

      <FormFooter onCancel={onClose} submitting={isSubmitting} submitLabel={editing ? "Salvar alterações" : "Cadastrar dívida"} />
    </form>
  );
}
