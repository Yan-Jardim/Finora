"use client";

import { Archive, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, History, Pencil, PiggyBank, Plus, RotateCcw, Target, Wallet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ProfileFilter } from "@/components/dashboard/profile-filter";
import { useAction, useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CategoryIcon } from "@/components/ui/category-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ALL, buildPocketsView, type PocketCard } from "@/services/pocket-view";
import { LegacyPocketsNotice } from "./legacy-pockets-notice";
import { PocketFormDialog } from "./pocket-form";
import { PocketHistoryDialog } from "./pocket-history-dialog";
import { PocketMoveDialog, PocketTransferDialog, type PocketMoveMode } from "./pocket-move-dialogs";
import type { Pocket } from "@/domain/types";

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
        <p className="whitespace-nowrap text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
    </Card>
  );
}

/**
 * Cofrinhos: dinheiro SEPARADO dentro de uma conta (alocação virtual). O saldo do cofrinho nunca é gravado: vem do
 * snapshot (views do banco ou histórico no modo local). Reservar/retirar/transferir não mexem no saldo bancário.
 */
export function PocketsView() {
  const { data, ready, pocketCommands, today } = useWorkspace();
  const run = useAction();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<{ open: boolean; pocket?: Pocket }>({ open: false });
  const [move, setMove] = useState<{ mode: PocketMoveMode; pocketId?: string }>({ mode: "reserve" });
  const [transferFrom, setTransferFrom] = useState<string | undefined>();
  const [history, setHistory] = useState<Pocket | undefined>();

  if (!ready) return <PageSkeleton />;

  const profileParam = searchParams.get("perfil") ?? ALL;
  const profileId = data.profiles.some((p) => p.id === profileParam) ? profileParam : ALL;
  const view = buildPocketsView(data, today, profileId);
  const profiles = new Map(data.profiles.map((p) => [p.id, p]));
  const all = view.active.length + view.archived.length;

  const newButton = (
    <Button onClick={() => setForm({ open: true })}>
      <Plus className="size-4" aria-hidden /> Novo cofrinho
    </Button>
  );

  const card = (c: PocketCard) => {
    const { pocket } = c;
    const owner = profiles.get(pocket.profileId);
    const archived = pocket.status === "archived";
    const hasBalance = c.balanceCents > 0;
    const sameAccountActive = view.active.filter((x) => x.pocket.accountId === pocket.accountId).length;
    return (
      <li key={pocket.id}>
        <Card className={cn("flex h-full flex-col gap-4", archived && "opacity-80")} aria-label={`Cofrinho ${pocket.name}`}>
          <div className="flex items-start gap-3">
            <CategoryIcon name={pocket.icon} color={pocket.color} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{pocket.name}</p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full" style={{ backgroundColor: owner?.color }} aria-hidden />
                  {owner?.name ?? "—"}
                </span>
                <span aria-hidden>•</span>
                <span>{c.account?.name ?? "Conta removida"}</span>
              </p>
            </div>
            <Badge tone={archived ? "neutral" : "success"}>{archived ? "Arquivado" : "Ativo"}</Badge>
          </div>

          {pocket.description && <p className="text-xs text-muted-foreground">{pocket.description}</p>}

          <div>
            <p className="text-xs text-muted-foreground">Saldo reservado</p>
            <p className="whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums" data-testid="pocket-balance">
              {formatMoney(c.balanceCents)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground" data-testid="pocket-account-free">
              Livre na conta: <strong className={cn("tabular-nums", c.accountFreeCents < 0 ? "text-danger" : "text-foreground")}>{formatMoney(c.accountFreeCents)}</strong>
              <span aria-hidden> · </span>
              reservado na conta: {formatMoney(c.accountReservedCents)}
            </p>
          </div>

          {c.goal && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Target className="size-3.5" aria-hidden />
              Objetivo:{" "}
              <Link href="/objetivos" className="font-medium text-primary hover:underline">
                {c.goal.name}
              </Link>
            </p>
          )}

          <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
            {!archived && (
              <>
                <Button size="sm" onClick={() => setMove({ mode: "reserve", pocketId: pocket.id })}>
                  <ArrowDownToLine className="size-3.5" aria-hidden /> Reservar
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setMove({ mode: "withdraw", pocketId: pocket.id })} disabled={!hasBalance}>
                  <ArrowUpFromLine className="size-3.5" aria-hidden /> Retirar
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setTransferFrom(pocket.id)} disabled={!hasBalance || sameAccountActive < 2}>
                  <ArrowLeftRight className="size-3.5" aria-hidden /> Transferir
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" aria-label={`Histórico de ${pocket.name}`} onClick={() => setHistory(pocket)}>
              <History className="size-3.5" aria-hidden /> Histórico
            </Button>
            <Button variant="ghost" size="sm" aria-label={`Editar ${pocket.name}`} onClick={() => setForm({ open: true, pocket })}>
              <Pencil className="size-3.5" aria-hidden /> Editar
            </Button>
            {archived ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Reativar ${pocket.name}`}
                onClick={() => run(() => pocketCommands.setArchived(pocket.id, false), "Cofrinho reativado.")}
              >
                <RotateCcw className="size-3.5" aria-hidden /> Reativar
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Arquivar ${pocket.name}`}
                disabled={hasBalance}
                title={hasBalance ? "Retire a reserva antes de arquivar." : undefined}
                onClick={() => run(() => pocketCommands.setArchived(pocket.id, true), "Cofrinho arquivado.")}
              >
                <Archive className="size-3.5" aria-hidden /> Arquivar
              </Button>
            )}
          </div>
          {!archived && hasBalance && <p className="-mt-2 text-[11px] text-muted-foreground">Para arquivar, retire a reserva antes.</p>}
        </Card>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cofrinhos"
        description="Separe dinheiro dentro das suas contas para um propósito. O dinheiro continua na conta: reservar não gasta nem transfere nada."
        action={all > 0 ? newButton : undefined}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProfileFilter profiles={data.profiles} selected={profileId} basePath="/cofrinhos" />
      </div>

      <LegacyPocketsNotice />

      <div className="grid grid-cols-2 gap-4">
        <SummaryTile label="Total reservado" value={formatMoney(view.reservedCents)} hint="Separado em cofrinhos" icon={PiggyBank} />
        <SummaryTile label="Dinheiro livre" value={formatMoney(view.freeCents)} hint="Saldo das contas − reservado" icon={Wallet} />
      </div>

      {all === 0 ? (
        <Card>
          <EmptyState
            icon={PiggyBank}
            title="Nenhum cofrinho ainda"
            description="Crie um cofrinho para separar uma parte do saldo de uma conta — por exemplo, a reserva de emergência ou a viagem."
          />
          <div className="flex justify-center pb-6">{newButton}</div>
        </Card>
      ) : (
        <>
          {view.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum cofrinho ativo.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{view.active.map(card)}</ul>
          )}
          {view.archived.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Arquivados ({view.archived.length})</summary>
              <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{view.archived.map(card)}</ul>
            </details>
          )}
        </>
      )}

      <PocketFormDialog key={form.pocket?.id ?? "new"} open={form.open} onClose={() => setForm({ open: false })} pocket={form.pocket} />
      <PocketMoveDialog mode={move.mode} pocketId={move.pocketId} onClose={() => setMove((m) => ({ ...m, pocketId: undefined }))} />
      <PocketTransferDialog fromPocketId={transferFrom} onClose={() => setTransferFrom(undefined)} />
      <PocketHistoryDialog pocket={history} onClose={() => setHistory(undefined)} />
    </div>
  );
}
