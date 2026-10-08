"use client";

import { Landmark, LineChart, Pencil, Plus, Power, Trash2, Wallet } from "lucide-react";
import { useState } from "react";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Select } from "@/components/forms/fields";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CategoryIcon } from "@/components/ui/category-icon";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { computeBalancesFrom } from "@/domain/calculations";
import { snapshotBalance, snapshotOf } from "@/domain/snapshot";
import { accountDeleteBlocker } from "@/domain/rules";
import type { Account } from "@/domain/types";
import { formatMoney } from "@/lib/format";
import { accountTypeLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { AccountFormDialog } from "./account-form";

const columns = "md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto]";

function SummaryTile({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: typeof Wallet }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <div>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
    </Card>
  );
}

export function AccountsView() {
  const { data, ready, repos, today } = useWorkspace();
  const run = useAction();
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [form, setForm] = useState<{ open: boolean; account?: Account }>({ open: false });
  const [deleting, setDeleting] = useState<Account | undefined>();

  if (!ready) return <PageSkeleton />;

  // Saldos: views do banco (supabase) ou derivados das movimentações (local) — o mesmo formato nos dois casos.
  const snapshot = snapshotOf(data, today);
  const balances = computeBalancesFrom(data.accounts, (a) => snapshotBalance(snapshot, a));
  const profileMap = new Map(data.profiles.map((p) => [p.id, p]));
  const list = data.accounts.filter((a) => ownerFilter === "all" || a.ownerProfileId === ownerFilter);

  const newButton = (
    <Button onClick={() => setForm({ open: true })}>
      <Plus className="size-4" aria-hidden /> Nova conta
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contas"
        description="Onde seu dinheiro está: contas, carteiras, dinheiro em espécie e investimentos."
        action={data.accounts.length > 0 ? newButton : undefined}
      />

      {data.accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={Landmark}
            title="Nenhuma conta cadastrada"
            description="Cadastre sua primeira conta para começar a organizar suas finanças."
          />
          <div className="flex justify-center pb-6">{newButton}</div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryTile label="Saldo em contas" value={formatMoney(balances.accountsCents)} hint="Contas correntes, digitais, dinheiro etc." icon={Wallet} />
            <SummaryTile label="Investimentos" value={formatMoney(balances.investmentsCents)} hint="Contas do tipo investimento" icon={LineChart} />
            <SummaryTile label="Total financeiro" value={formatMoney(balances.netWorthCents)} hint="Saldo em contas + investimentos" icon={Landmark} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {list.length} {list.length === 1 ? "conta" : "contas"}
            </p>
            <div className="w-44">
              <Select aria-label="Filtrar por proprietário" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
                <option value="all">Todos os donos</option>
                {data.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <Card className="p-0">
            {list.length === 0 ? (
              <EmptyState icon={Landmark} title="Nenhuma conta para este proprietário" />
            ) : (
              <>
                <div className={cn("hidden gap-4 border-b border-border px-5 py-3 text-xs font-medium text-muted-foreground md:grid", columns)}>
                  <span>Conta</span>
                  <span>Dono</span>
                  <span>Tipo</span>
                  <span className="text-right">Saldo</span>
                  <span className="w-44 text-right">Ações</span>
                </div>
                <ul className="divide-y divide-border">
                  {list.map((account) => {
                    const owner = profileMap.get(account.ownerProfileId);
                    const balance = snapshotBalance(snapshot, account);
                    return (
                      <li
                        key={account.id}
                        className={cn("grid grid-cols-1 items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5", columns, !account.active && "opacity-60")}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <CategoryIcon name={account.icon} color={account.color} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{account.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{account.institution ?? "Sem instituição"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm">
                          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: owner?.color }} aria-hidden />
                          <span className="truncate">{owner?.name ?? "—"}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm">{accountTypeLabel[account.type]}</span>
                          {!account.includeInNetWorth && <Badge tone="warning">Fora do patrimônio</Badge>}
                        </div>
                        <p className={cn("text-sm font-semibold tabular-nums md:text-right", balance < 0 && "text-danger")}>
                          {formatMoney(balance)}
                        </p>
                        <div className="flex items-center gap-1 md:w-44 md:justify-end">
                          <StatusBadge active={account.active} />
                          <Button variant="ghost" size="sm" aria-label={`Editar ${account.name}`} onClick={() => setForm({ open: true, account })}>
                            <Pencil className="size-3.5" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={account.active ? `Desativar ${account.name}` : `Ativar ${account.name}`}
                            title={account.active ? "Desativar" : "Ativar"}
                            onClick={() =>
                              run(
                                () => repos.accounts.update(account.id, { active: !account.active }),
                                account.active ? "Conta desativada." : "Conta ativada.",
                              )
                            }
                          >
                            <Power className="size-3.5" aria-hidden />
                          </Button>
                          <Button variant="ghost" size="sm" aria-label={`Excluir ${account.name}`} onClick={() => setDeleting(account)}>
                            <Trash2 className="size-3.5 text-danger" aria-hidden />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Card>
          <p className="text-xs text-muted-foreground">
            Contas inativas ou fora do patrimônio não entram nos totais acima.
          </p>
        </>
      )}

      <AccountFormDialog open={form.open} onClose={() => setForm({ open: false })} account={form.account} />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        title={`Excluir "${deleting?.name}"?`}
        description="Esta ação não pode ser desfeita."
        blockedReason={deleting ? (accountDeleteBlocker(deleting, data) ?? undefined) : undefined}
        onConfirm={() => run(() => repos.accounts.remove(deleting!.id), "Conta excluída.")}
      />
    </div>
  );
}
