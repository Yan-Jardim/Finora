"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDownCircle, ArrowLeft, ArrowLeftRight, ArrowUpCircle, CreditCard, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Checkbox, Field, FormFooter, Input, Select } from "@/components/forms/fields";
import { TagInput } from "@/components/forms/tag-input";
import { useAction, useCurrentProfile, useWorkspace } from "@/components/providers/workspace-provider";
import { Dialog } from "@/components/ui/dialog";
import { NO_POCKET_USE, PocketUseField, type PocketUseValue } from "./pocket-use-field";
import { invoiceCycle } from "@/domain/calculations";
import { splitCents, type InstallmentScope } from "@/domain/installments";
import type { Transaction } from "@/domain/types";
import { formatDate, formatMoney } from "@/lib/format";
import { parseMoneyToCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  installmentInputFromForm,
  MAX_INSTALLMENTS,
  transactionDefaults,
  transactionFromForm,
  transactionSchema,
  transactionToForm,
  type FormKind,
  type TransactionFormValues,
} from "@/schemas/transaction";

const kindOptions: { kind: FormKind; label: string; description: string; icon: LucideIcon; tone: string }[] = [
  { kind: "income", label: "Receita", description: "Salário, freelance, PIX recebido…", icon: ArrowUpCircle, tone: "text-success bg-success-soft" },
  { kind: "expense", label: "Despesa", description: "Mercado, aluguel, contas…", icon: ArrowDownCircle, tone: "text-danger bg-danger-soft" },
  { kind: "transfer", label: "Transferência", description: "Mover dinheiro entre contas", icon: ArrowLeftRight, tone: "text-primary bg-primary-soft" },
  { kind: "credit_card_purchase", label: "Compra no cartão", description: "À vista ou parcelada", icon: CreditCard, tone: "text-warning bg-warning-soft" },
];

const kindTitle: Record<FormKind, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
  credit_card_purchase: "Compra no cartão",
};

export function TransactionFormDialog({
  open,
  onClose,
  transaction,
  scope = "this",
}: {
  open: boolean;
  onClose: () => void;
  /** Quando informado, edita esta movimentação. */
  transaction?: Transaction;
  /** Escopo de edição para parcelas. */
  scope?: InstallmentScope;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={transaction ? "Editar movimentação" : "Nova movimentação"}>
      <DialogBody transaction={transaction} scope={scope} onClose={onClose} />
    </Dialog>
  );
}

function DialogBody({ transaction, scope, onClose }: { transaction?: Transaction; scope: InstallmentScope; onClose: () => void }) {
  const [kind, setKind] = useState<FormKind | null>(transaction ? (transaction.kind as FormKind) : null);

  if (!kind) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">O que você quer registrar?</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {kindOptions.map((option) => (
            <button
              key={option.kind}
              type="button"
              onClick={() => setKind(option.kind)}
              className="flex items-start gap-3 rounded-xl border border-border p-3 text-left transition hover:border-primary hover:bg-muted"
            >
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", option.tone)}>
                <option.icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <TransactionForm
      kind={kind}
      transaction={transaction}
      scope={scope}
      onBack={transaction ? undefined : () => setKind(null)}
      onClose={onClose}
    />
  );
}

function TransactionForm({
  kind,
  transaction,
  scope,
  onBack,
  onClose,
}: {
  kind: FormKind;
  transaction?: Transaction;
  scope: InstallmentScope;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { data, commands, pocketCommands, today: workspaceToday } = useWorkspace();
  const [pocketUse, setPocketUse] = useState<PocketUseValue>(NO_POCKET_USE);
  const currentProfile = useCurrentProfile();
  const run = useAction();
  const isParcel = !!transaction?.installment;
  /** "Esta e as próximas": só campos descritivos são aplicados às demais parcelas. */
  const restricted = isParcel && scope !== "this";
  const editing = !!transaction;

  const profiles = data.profiles.filter((p) => p.active || p.id === transaction?.profileId);
  const accounts = data.accounts.filter(
    (a) => a.active || a.id === transaction?.accountId || a.id === transaction?.toAccountId,
  );
  const cards = data.creditCards.filter((c) => c.active || c.id === transaction?.cardId);
  const profileName = (id: string) => data.profiles.find((p) => p.id === id)?.name ?? "";
  // Sugestões: tags cadastradas no banco (supabase) ou as já usadas nas movimentações (local).
  const allTags = useMemo(
    () => data.knownTags ?? [...new Set(data.transactions.flatMap((t) => t.tags))].sort(),
    [data.knownTags, data.transactions],
  );

  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: transaction
      ? transactionToForm(transaction, data.categories)
      : transactionDefaults(kind, workspaceToday, currentProfile?.id ?? profiles[0]?.id ?? ""),
  });

  const [rootId, installmentsEnabled, installments, cardId, date, amount, status, accountIdValue] = useWatch({
    control,
    name: ["categoryId", "installmentsEnabled", "installments", "cardId", "date", "amount", "status", "accountId"],
  });

  const categoryKind = kind === "income" ? "income" : "expense";
  const rootCategories = data.categories.filter(
    (c) => !c.parentId && (c.active || c.id === rootId) && (c.kind === categoryKind || c.kind === "both"),
  );
  const subcategories = data.categories.filter((c) => c.parentId === rootId);

  // Pré-visualizações do cartão (fatura e parcelas), vindas das mesmas funções de domínio.
  const selectedCard = data.creditCards.find((c) => c.id === cardId);
  const totalCents = parseMoneyToCents(amount);
  const parts = Number(installments);
  const parcelPreview = useMemo(() => {
    if (!installmentsEnabled || totalCents === null || totalCents <= 0 || !Number.isInteger(parts) || parts < 2 || parts > MAX_INSTALLMENTS) return null;
    const split = splitCents(totalCents, parts);
    return split[0] === split[split.length - 1]
      ? `${parts}x de ${formatMoney(split[0])}`
      : `${parts}x: 1ª de ${formatMoney(split[0])} e demais de ${formatMoney(split[split.length - 1])}`;
  }, [installmentsEnabled, totalCents, parts]);
  const invoicePreview = selectedCard && /^\d{4}-\d{2}-\d{2}$/.test(date) ? invoiceCycle(selectedCard, date) : null;

  // "Usar dinheiro de um cofrinho": só ao CRIAR uma despesa paga em conta (o cofrinho precisa ser da mesma conta).
  const usePocket = !editing && kind === "expense" && status === "paid" && !!accountIdValue;

  const onSubmit = handleSubmit(async (values) => {
    const today = workspaceToday;

    if (transaction) {
      const { kind: _kind, ...patch } = transactionFromForm(values, today);
      void _kind;
      // Compra no cartão cancelada não deve ser reativada por uma edição.
      const ok = await run(() => commands.update(transaction, patch, scope), "Movimentação atualizada.");
      if (ok) onClose();
      return;
    }

    // Despesa paga usando reserva: UMA RPC atômica (spend_from_pocket) — o frontend não monta operação em vários passos.
    if (usePocket && pocketUse.enabled) {
      const t = transactionFromForm(values, today);
      const asked = parseMoneyToCents(pocketUse.amount);
      if (!pocketUse.pocketId || asked === null || asked <= 0) {
        return setError("amount", { message: "Informe quanto da reserva será utilizado (maior que zero)." });
      }
      const ok = await run(
        () =>
          pocketCommands.spend({
            pocketId: pocketUse.pocketId,
            description: t.description,
            amountCents: t.amountCents,
            amountFromPocketCents: asked,
            date: t.date,
            categoryId: t.categoryId ?? "",
            profileId: t.profileId,
            notes: t.notes,
            tags: t.tags,
          }),
        "Despesa registrada usando o cofrinho.",
      );
      if (ok) onClose();
      return;
    }

    const parcelado = values.kind === "credit_card_purchase" && values.installmentsEnabled;
    const ok = await run(
      () =>
        parcelado
          ? commands.createInstallmentPurchase(installmentInputFromForm(values))
          : commands.create(transactionFromForm(values, today)),
      parcelado
        ? `Compra parcelada em ${values.installments}x registrada.`
        : { income: "Receita registrada.", expense: "Despesa registrada.", transfer: "Transferência registrada.", credit_card_purchase: "Compra no cartão registrada." }[values.kind],
    );
    if (ok) onClose();
  });

  const accountOptions = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name} · {profileName(a.ownerProfileId)}
    </option>
  ));
  const statusOptions = (
    <>
      <option value="paid">{kind === "income" ? "Recebido" : "Pago"}</option>
      <option value="pending">Pendente</option>
      <option value="planned">Previsto</option>
    </>
  );

  const needsAccounts = kind !== "credit_card_purchase" && accounts.length === 0;
  const needsCards = kind === "credit_card_purchase" && cards.length === 0;
  if (needsAccounts || needsCards || profiles.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-warning-soft px-3 py-3 text-sm text-warning">
          {profiles.length === 0
            ? "Cadastre uma pessoa em Pessoas antes de registrar movimentações."
            : needsCards
              ? "Cadastre um cartão em Cartões antes de registrar compras no cartão."
              : "Cadastre uma conta em Contas antes de registrar movimentações."}
        </p>
        {onBack && (
          <button type="button" onClick={onBack} className="self-start text-sm text-primary">
            ← Escolher outro tipo
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {kindTitle[kind]}
          {transaction?.installment && (
            <span className="ml-2 font-normal text-muted-foreground">
              Parcela {transaction.installment.number}/{transaction.installment.total}
            </span>
          )}
        </p>
        {onBack && (
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-primary">
            <ArrowLeft className="size-3.5" aria-hidden /> Trocar tipo
          </button>
        )}
      </div>

      {restricted && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Editando esta e as próximas parcelas: apenas descrição, categoria, tags, perfil e observações são alteradas.
          Valor e data de cada parcela são mantidos. Parcelas já pagas não são modificadas.
        </p>
      )}

      <Field label="Descrição" error={errors.description?.message}>
        {(p) => <Input {...p} autoFocus placeholder={kind === "income" ? "Ex.: Salário" : kind === "transfer" ? "Ex.: Nubank → Mercado Pago" : "Ex.: Mercado"} {...register("description")} />}
      </Field>

      {!restricted && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={installmentsEnabled ? "Valor total" : "Valor"} error={errors.amount?.message}>
            {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("amount")} />}
          </Field>
          <Field label={kind === "credit_card_purchase" ? "Data da compra" : "Data"} error={errors.date?.message}>
            {(p) => <Input {...p} type="date" {...register("date")} />}
          </Field>
        </div>
      )}

      {!restricted && (kind === "income" || kind === "expense") && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={kind === "income" ? "Conta de destino" : "Conta"} error={errors.accountId?.message}>
            {(p) => (
              <Select {...p} {...register("accountId", { onChange: () => setPocketUse(NO_POCKET_USE) })}>
                <option value="">Selecione…</option>
                {accountOptions}
              </Select>
            )}
          </Field>
          <Field label={kind === "income" ? "Data prevista" : "Vencimento"} optional error={errors.dueDate?.message}>
            {(p) => <Input {...p} type="date" {...register("dueDate")} />}
          </Field>
        </div>
      )}

      {!restricted && kind === "transfer" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Conta de origem" error={errors.accountId?.message}>
            {(p) => (
              <Select {...p} {...register("accountId")}>
                <option value="">Selecione…</option>
                {accountOptions}
              </Select>
            )}
          </Field>
          <Field label="Conta de destino" error={errors.toAccountId?.message}>
            {(p) => (
              <Select {...p} {...register("toAccountId")}>
                <option value="">Selecione…</option>
                {accountOptions}
              </Select>
            )}
          </Field>
        </div>
      )}

      {!isParcel && kind === "credit_card_purchase" && (
        <>
          <Field
            label="Cartão"
            error={errors.cardId?.message}
            hint={invoicePreview ? `Entra na fatura que fecha em ${formatDate(invoicePreview.closingDate)} e vence em ${formatDate(invoicePreview.dueDate)}.` : undefined}
          >
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

          {!editing && (
            <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
              <Checkbox label="Compra parcelada" description="As parcelas são geradas automaticamente, uma por fatura." {...register("installmentsEnabled")} />
              {installmentsEnabled && (
                <Field label="Número de parcelas" error={errors.installments?.message} hint={parcelPreview ?? undefined}>
                  {(p) => <Input {...p} inputMode="numeric" maxLength={2} {...register("installments")} />}
                </Field>
              )}
            </div>
          )}
        </>
      )}

      {!restricted && kind !== "credit_card_purchase" && (
        <Field label="Status" error={errors.status?.message} hint={status === "paid" ? undefined : "Não altera o saldo da conta até ser marcado como pago."}>
          {(p) => <Select {...p} {...register("status")}>{statusOptions}</Select>}
        </Field>
      )}

      {usePocket && (
        <PocketUseField key={accountIdValue} accountId={accountIdValue} expenseCents={totalCents} value={pocketUse} onChange={setPocketUse} />
      )}

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

      {kind !== "transfer" && (
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
          <Field label="Subcategoria" optional error={errors.subcategoryId?.message}>
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
      )}

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
        {(p) => <textarea {...p} rows={2} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary" {...register("notes")} />}
      </Field>

      <FormFooter onCancel={onClose} submitting={isSubmitting} submitLabel={editing ? "Salvar alterações" : "Registrar"} />
    </form>
  );
}
