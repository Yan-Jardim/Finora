"use client";

import { AlertTriangle, ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Field, Input, Select } from "@/components/forms/fields";
import { useAction, useCurrentProfile, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { guessCategory, isDuplicateBill, parseBillList, planBill, type BillRepeat, type MonthBills } from "@/domain/bills";
import { CALENDAR_ALL } from "@/domain/calendar";
import { addMonths, dateWithDay, isValidISODate, yearMonth } from "@/domain/dates";
import type { ID } from "@/domain/types";
import { formatMoney } from "@/lib/format";
import { centsToInput, parseMoneyToCents } from "@/lib/money";
import { monthShort } from "@/lib/planning-messages";
import { cn } from "@/lib/utils";

const PLACEHOLDER = `Cole aqui a lista, do jeito que vocês escrevem. Ex.:
Aluguel 400 ✅
1.100 empréstimo. Ok
150 água
70 Tim Camila
60 tia val (5x10)`;

const AUTO = "auto";

interface Row {
  key: number;
  include: boolean;
  description: string;
  amount: string;
  dueDate: string;
  profileId: ID;
  categoryId: ID;
  repeat: BillRepeat;
  installment?: { current: number; total: number };
  paid: boolean;
  duplicate: boolean;
}

/**
 * Colar a lista do WhatsApp e criar tudo de uma vez. Passo 1: o texto; passo 2: conferir cada linha (pessoa, se repete,
 * vencimento, categoria, já paga) antes de salvar. Linhas que já estão no mês vêm desmarcadas.
 */
export function PasteBillsDialog({ month, bills, defaultProfileId, onClose }: { month: string; bills: MonthBills; defaultProfileId: string; onClose: () => void }) {
  const { data, today, commands, recurrence, reload } = useWorkspace();
  const me = useCurrentProfile();
  const run = useAction();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ignored, setIgnored] = useState(0);
  const [accountChoice, setAccountChoice] = useState<string>(AUTO);
  const [saving, setSaving] = useState(false);

  const profiles = data.profiles.filter((p) => p.active);
  const accounts = data.accounts.filter((a) => a.active && a.type !== "investment");
  const categories = data.categories.filter((c) => c.active && c.kind !== "income");
  const fallbackCategory =
    categories.find((c) => !c.parentId && c.name.toLowerCase() === "outros")?.id ?? categories.find((c) => !c.parentId)?.id ?? "";
  const startProfile = defaultProfileId !== CALENDAR_ALL ? defaultProfileId : (me?.id ?? profiles[0]?.id ?? "");
  const defaultDue = month === yearMonth(today) ? today : dateWithDay(Number(month.slice(0, 4)), Number(month.slice(5, 7)), Number(today.slice(8, 10)));

  const accountFor = (profileId: ID) =>
    accountChoice !== AUTO ? accountChoice : (accounts.find((a) => a.ownerProfileId === profileId)?.id ?? accounts[0]?.id ?? "");

  const read = () => {
    const parsed = parseBillList(text);
    setIgnored(parsed.ignored);
    setRows(
      parsed.items.map((item, i) => {
        const duplicate = isDuplicateBill(item, bills);
        return {
          key: i,
          include: !duplicate,
          description: item.description,
          amount: centsToInput(item.amountCents),
          dueDate: defaultDue,
          profileId: startProfile,
          categoryId: guessCategory(item.description, data.categories) ?? fallbackCategory,
          repeat: item.installment ? "installments" : "once",
          installment: item.installment,
          paid: item.paid,
          duplicate,
        };
      }),
    );
  };

  const update = (key: number, patch: Partial<Row>) => setRows((list) => list?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  const setAllRepeat = (repeat: BillRepeat) =>
    setRows((list) => list?.map((r) => (r.repeat === "installments" && r.installment ? r : { ...r, repeat })) ?? null);

  const chosen = rows?.filter((r) => r.include) ?? [];
  const invalid = chosen.find(
    (r) => !r.description.trim() || (parseMoneyToCents(r.amount) ?? 0) <= 0 || !isValidISODate(r.dueDate) || !r.categoryId || !accountFor(r.profileId),
  );
  const totalCents = chosen.reduce((s, r) => s + (parseMoneyToCents(r.amount) ?? 0), 0);
  const blocker =
    accounts.length === 0 ? "Cadastre uma conta em Contas antes (é de onde o dinheiro sai)." : categories.length === 0 ? "Cadastre ao menos uma categoria de despesa." : null;

  const save = async () => {
    if (!rows || invalid || blocker) return;
    setSaving(true);
    const saved = new Set<number>();
    const ok = await run(async () => {
      for (const row of chosen) {
        const plan = planBill(
          {
            description: row.description.trim(),
            amountCents: parseMoneyToCents(row.amount) ?? 0,
            dueDate: row.dueDate,
            profileId: row.profileId,
            accountId: accountFor(row.profileId),
            categoryId: row.categoryId,
            repeat: row.repeat,
            installment: row.installment,
            paid: row.paid,
          },
          today,
        );
        await commands.create(plan.transaction);
        if (plan.rule) await recurrence.create(plan.rule);
        saved.add(row.key);
      }
    }, chosen.length === 1 ? "Conta adicionada." : `${chosen.length} contas adicionadas.`);
    setSaving(false);
    if (ok) return onClose();
    // Falhou no meio: o que já foi salvo sai da lista (para não duplicar ao tentar de novo).
    if (saved.size > 0) {
      setRows((list) => list?.filter((r) => !saved.has(r.key)) ?? null);
      await reload();
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Adicionar contas"
      description={rows ? "Confira cada conta antes de salvar." : "Cole a lista do WhatsApp (uma conta por linha) ou digite uma só."}
    >
      {!rows ? (
        <div className="flex flex-col gap-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={9}
            aria-label="Lista de contas"
            data-testid="bills-paste-text"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          />
          <p className="text-xs text-muted-foreground">
            O valor pode vir antes ou depois do nome. &quot;ok&quot;, &quot;pago&quot; ou ✅ = já paga. &quot;(5x10)&quot; = parcela 5 de 10. Linhas sem valor, como o
            nome do mês, são ignoradas.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={read} disabled={!text.trim()} data-testid="bills-paste-read">
              Continuar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setRows(null)}>
            <ArrowLeft className="size-4" aria-hidden /> Voltar ao texto
          </Button>
          {rows.length === 0 ? (
            <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">Não achei nenhum valor no texto. Use uma conta por linha, como &quot;150 água&quot;.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Todas:</span>
                <Button size="sm" variant="secondary" onClick={() => setAllRepeat("once")}>
                  Só este mês
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setAllRepeat("monthly")}>
                  Todo mês
                </Button>
              </div>
              <ul className="flex flex-col gap-3" data-testid="bills-preview">
                {rows.map((row) => {
                  const remainingEnd = row.installment ? addMonths(row.dueDate || defaultDue, row.installment.total - row.installment.current) : null;
                  return (
                    <li key={row.key} className={cn("flex flex-col gap-2 rounded-xl border border-border p-3", !row.include && "opacity-60")} data-testid="bills-preview-row">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={row.include}
                          onChange={(e) => update(row.key, { include: e.target.checked })}
                          aria-label={`Incluir ${row.description}`}
                          className="size-4 shrink-0 accent-[var(--primary)]"
                        />
                        <Input value={row.description} onChange={(e) => update(row.key, { description: e.target.value })} aria-label="Descrição" className="h-9 min-w-0 flex-1" />
                        <Input value={row.amount} onChange={(e) => update(row.key, { amount: e.target.value })} inputMode="decimal" aria-label="Valor" className="h-9 w-24 text-right tabular-nums" />
                      </div>
                      {row.include && (
                        <div className="grid grid-cols-2 gap-2">
                          <Select aria-label="Quem paga" value={row.profileId} onChange={(e) => update(row.key, { profileId: e.target.value })} className="h-9 text-xs">
                            {profiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </Select>
                          <Select aria-label="Repete?" value={row.repeat} onChange={(e) => update(row.key, { repeat: e.target.value as BillRepeat })} className="h-9 text-xs">
                            <option value="once">Só este mês</option>
                            <option value="monthly">Todo mês</option>
                            {row.installment && (
                              <option value="installments">
                                Parcela {row.installment.current}/{row.installment.total}
                              </option>
                            )}
                          </Select>
                          <Input type="date" aria-label="Vencimento" value={row.dueDate} onChange={(e) => update(row.key, { dueDate: e.target.value })} className="h-9 text-xs" />
                          <Select aria-label="Categoria" value={row.categoryId} onChange={(e) => update(row.key, { categoryId: e.target.value })} className="h-9 text-xs">
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.parentId ? `  ${c.name}` : c.name}
                              </option>
                            ))}
                          </Select>
                          <label className="col-span-2 flex items-center gap-2 text-xs">
                            <input type="checkbox" checked={row.paid} onChange={(e) => update(row.key, { paid: e.target.checked })} className="size-4 accent-[var(--primary)]" />
                            Já paga
                            {row.repeat === "installments" && remainingEnd && row.installment!.current < row.installment!.total && (
                              <span className="text-muted-foreground">
                                · as próximas parcelas vão até {monthShort(yearMonth(remainingEnd))}/{remainingEnd.slice(0, 4)}
                              </span>
                            )}
                            {row.repeat === "monthly" && <span className="text-muted-foreground">· aparece sozinha nos próximos meses</span>}
                          </label>
                        </div>
                      )}
                      {row.duplicate && (
                        <p className="flex items-center gap-1.5 text-xs text-warning">
                          <AlertTriangle className="size-3.5" aria-hidden /> Parece que já está na lista deste mês.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <Field label="Pagar pela conta" hint="Automática: a primeira conta de quem paga.">
                {(p) => (
                  <Select {...p} value={accountChoice} onChange={(e) => setAccountChoice(e.target.value)}>
                    <option value={AUTO}>Automática</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </>
          )}
          {ignored > 0 && (
            <p className="text-xs text-muted-foreground">
              {ignored} {ignored === 1 ? "linha sem valor foi ignorada" : "linhas sem valor foram ignoradas"}.
            </p>
          )}
          {blocker && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{blocker}</p>}
          {invalid && !blocker && <p className="text-xs text-danger">Confira &quot;{invalid.description || "sem nome"}&quot;: falta nome, valor ou vencimento.</p>}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">
              {chosen.length} {chosen.length === 1 ? "conta" : "contas"} · <span className="font-medium text-foreground tabular-nums">{formatMoney(totalCents)}</span>
            </span>
            <Button onClick={save} disabled={saving || chosen.length === 0 || !!invalid || !!blocker} data-testid="bills-paste-save">
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
