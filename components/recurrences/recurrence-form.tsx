"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDownCircle, ArrowUpCircle, CreditCard, type LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Checkbox, Field, FormFooter, Input, Select } from "@/components/forms/fields";
import { TagInput } from "@/components/forms/tag-input";
import { useAction, useCurrentProfile, useWorkspace } from "@/components/providers/workspace-provider";
import { Dialog } from "@/components/ui/dialog";
import { occurrenceDates } from "@/domain/recurrence";
import type { RecurringTransaction } from "@/domain/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  recurrenceDefaults,
  recurrenceFromForm,
  recurrencePatch,
  recurrenceSchema,
  recurrenceToForm,
  type RecurrenceFormValues,
} from "@/schemas/recurrence";

const kindOptions: { kind: RecurringTransaction["kind"]; label: string; icon: LucideIcon; tone: string }[] = [
  { kind: "income", label: "Receita", icon: ArrowUpCircle, tone: "text-success" },
  { kind: "expense", label: "Despesa", icon: ArrowDownCircle, tone: "text-danger" },
  { kind: "credit_card_purchase", label: "Compra no cartão", icon: CreditCard, tone: "text-warning" },
];

const frequencyLabel = { weekly: "Semanal", monthly: "Mensal", yearly: "Anual" } as const;
const unitOf = (frequency: RecurrenceFormValues["frequency"], n: number) =>
  ({ weekly: n === 1 ? "semana" : "semanas", monthly: n === 1 ? "mês" : "meses", yearly: n === 1 ? "ano" : "anos" })[frequency];

export function RecurrenceFormDialog({ open, onClose, rule }: { open: boolean; onClose: () => void; rule?: RecurringTransaction }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={rule ? "Editar recorrência" : "Nova recorrência"}
      description="Cadastre uma vez: as próximas ocorrências são geradas automaticamente como movimentações previstas."
    >
      <RecurrenceForm rule={rule} onClose={onClose} />
    </Dialog>
  );
}

function RecurrenceForm({ rule, onClose }: { rule?: RecurringTransaction; onClose: () => void }) {
  const { data, recurrence, today } = useWorkspace();
  const currentProfile = useCurrentProfile();
  const run = useAction();
  const editing = !!rule;

  const profiles = data.profiles.filter((p) => p.active || p.id === rule?.profileId);
  const accounts = data.accounts.filter((a) => a.active || a.id === rule?.accountId);
  const cards = data.creditCards.filter((c) => c.active || c.id === rule?.cardId);
  const profileName = (id: string) => data.profiles.find((p) => p.id === id)?.name ?? "";
  const allTags = useMemo(
    () => data.knownTags ?? [...new Set(data.transactions.flatMap((t) => t.tags))].sort(),
    [data.knownTags, data.transactions],
  );

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RecurrenceFormValues>({
    resolver: zodResolver(recurrenceSchema),
    defaultValues: rule
      ? recurrenceToForm(rule, data.categories)
      : recurrenceDefaults("expense", today, currentProfile?.id ?? profiles[0]?.id ?? ""),
  });

  const [kind, rootId, frequency, interval, startDate, endDate] = useWatch({
    control,
    name: ["kind", "categoryId", "frequency", "interval", "startDate", "endDate"],
  });
  const categoryKind = kind === "income" ? "income" : "expense";
  const rootCategories = data.categories.filter(
    (c) => !c.parentId && (c.active || c.id === rootId) && (c.kind === categoryKind || c.kind === "both"),
  );
  const subcategories = data.categories.filter((c) => c.parentId === rootId);

  // Pré-visualização: as próximas datas da agenda (a mesma regra que gera as ocorrências).
  const preview = useMemo(() => {
    const n = Number(interval);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isInteger(n) || n < 1 || n > 24) return null;
    const from = startDate > today ? startDate : today;
    const to = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : "9999-12-31";
    const horizon = new Date(`${from}T00:00:00Z`);
    horizon.setUTCFullYear(horizon.getUTCFullYear() + 3);
    const end = to < horizon.toISOString().slice(0, 10) ? to : horizon.toISOString().slice(0, 10);
    const dates = occurrenceDates({ frequency, interval: n, startDate }, from, end).slice(0, 3);
    return dates.length ? dates.map(formatDate).join(" · ") : null;
  }, [frequency, interval, startDate, endDate, today]);

  const onSubmit = handleSubmit(async (values) => {
    const input = recurrenceFromForm(values);
    if (rule) {
      const patch = recurrencePatch(rule, input);
      if (Object.keys(patch).length === 0) return onClose();
      const ok = await run(
        () => recurrence.update(rule, patch, { applyToFuture: values.applyToFuture }),
        "Recorrência atualizada.",
      );
      if (ok) onClose();
      return;
    }
    const ok = await run(() => recurrence.create(input), "Recorrência criada: as próximas ocorrências já foram geradas.");
    if (ok) onClose();
  });

  const needsAccounts = kind !== "credit_card_purchase" && accounts.length === 0;
  const needsCards = kind === "credit_card_purchase" && cards.length === 0;
  if (profiles.length === 0 || (!editing && (needsAccounts || needsCards))) {
    return (
      <p className="rounded-lg bg-warning-soft px-3 py-3 text-sm text-warning">
        {profiles.length === 0
          ? "Cadastre uma pessoa em Pessoas antes de criar recorrências."
          : needsCards
            ? "Cadastre um cartão em Cartões antes de criar compras recorrentes no cartão."
            : "Cadastre uma conta em Contas antes de criar recorrências."}
      </p>
    );
  }

  const accountOptions = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name} · {profileName(a.ownerProfileId)}
    </option>
  ));

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {editing ? (
        <p className="text-sm font-medium">{kindOptions.find((k) => k.kind === kind)?.label}</p>
      ) : (
        <div role="radiogroup" aria-label="Tipo da recorrência" className="grid grid-cols-3 gap-2">
          {kindOptions.map((option) => (
            <label
              key={option.kind}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-border p-2 text-center text-xs font-medium has-[:checked]:border-primary has-[:checked]:bg-primary-soft",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                value={option.kind}
                {...register("kind", {
                  onChange: () => {
                    setValue("categoryId", "");
                    setValue("subcategoryId", "");
                    setValue("accountId", "");
                    setValue("cardId", "");
                  },
                })}
              />
              <option.icon className={cn("size-5", option.tone)} aria-hidden />
              {option.label}
            </label>
          ))}
        </div>
      )}

      <Field label="Descrição" error={errors.description?.message}>
        {(p) => <Input {...p} autoFocus placeholder={kind === "income" ? "Ex.: Salário" : "Ex.: Internet"} {...register("description")} />}
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Valor" error={errors.amount?.message}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("amount")} />}
        </Field>
        <Field label="Perfil financeiro" error={errors.profileId?.message}>
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
      </div>

      {kind === "credit_card_purchase" ? (
        <Field label="Cartão" error={errors.cardId?.message} hint="A fatura é decidida pela data de cada ocorrência. Não mexe no saldo; consome limite.">
          {(p) => (
            <Select {...p} {...register("cardId")}>
              <option value="">Selecione…</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {profileName(c.ownerProfileId)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <Field label={kind === "income" ? "Conta de destino" : "Conta"} error={errors.accountId?.message}>
          {(p) => (
            <Select {...p} {...register("accountId")}>
              <option value="">Selecione…</option>
              {accountOptions}
            </Select>
          )}
        </Field>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Categoria" error={errors.categoryId?.message}>
          {(p) => (
            <Select {...p} {...register("categoryId", { onChange: () => setValue("subcategoryId", "") })}>
              <option value="">Selecione…</option>
              {rootCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Subcategoria" optional>
          {(p) => (
            <Select {...p} {...register("subcategoryId")}>
              <option value="">{subcategories.length ? "Nenhuma" : "—"}</option>
              {subcategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Frequência" error={errors.frequency?.message}>
          {(p) => (
            <Select {...p} {...register("frequency")}>
              {(Object.keys(frequencyLabel) as (keyof typeof frequencyLabel)[]).map((f) => (
                <option key={f} value={f}>
                  {frequencyLabel[f]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`A cada (${unitOf(frequency, Number(interval) || 1)})`} error={errors.interval?.message}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={2} {...register("interval")} />}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Primeira ocorrência"
          error={errors.startDate?.message}
          hint="É a âncora: o dia vem dela. Dia 31 cai no último dia de meses mais curtos."
        >
          {(p) => <Input {...p} type="date" {...register("startDate")} />}
        </Field>
        <Field label="Termina em" optional error={errors.endDate?.message}>
          {(p) => <Input {...p} type="date" {...register("endDate")} />}
        </Field>
      </div>
      {preview && <p className="-mt-2 text-xs text-muted-foreground">Próximas datas: {preview}</p>}

      <Field label="Tags" optional hint="Pressione Enter ou vírgula para adicionar.">
        {(p) => (
          <Controller
            control={control}
            name="tags"
            render={({ field }) => <TagInput id={p.id} value={field.value} onChange={field.onChange} suggestions={allTags} />}
          />
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

      {editing && (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <Checkbox
            label="Aplicar às ocorrências futuras ainda não pagas"
            description="Ocorrências pagas, passadas e canceladas por você nunca são alteradas. Desmarque para mudar só as próximas que forem geradas."
            {...register("applyToFuture")}
          />
        </div>
      )}

      <FormFooter onCancel={onClose} submitting={isSubmitting} submitLabel={editing ? "Salvar alterações" : "Criar recorrência"} />
    </form>
  );
}
