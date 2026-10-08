"use client";

import { Landmark } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCurrentProfile, useTransactionWindow, useWorkspace } from "@/components/providers/workspace-provider";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { formatMonthYear } from "@/lib/format";
import { monthEnd, monthStart } from "@/domain/dates";
import { ALL_PROFILES, buildDashboard } from "@/services/dashboard-service";
import { DataSourceNotice } from "@/components/ui/data-source-notice";
import { AvailableBreakdown } from "./available-breakdown";
import { PocketsOverview } from "./pockets-overview";
import { CardsOverview } from "./cards-overview";
import { ProfileFilter } from "./profile-filter";
import { RecentTransactions } from "./recent-transactions";
import { SpendingByCategory } from "./spending-by-category";
import { SummaryCards } from "./summary-cards";
import { UpcomingBills } from "./upcoming-bills";

/**
 * Dashboard: lê os dados do workspace e calcula tudo em cima deles. No modo Supabase: saldos, faturas e limites vêm
 * das views; as movimentações carregadas são o mês atual + contas a pagar pendentes de meses anteriores + as mais
 * recentes (veja a janela abaixo) — nunca o histórico inteiro.
 */
export function DashboardView() {
  const { data, ready, today } = useWorkspace();
  const currentProfile = useCurrentProfile();
  const searchParams = useSearchParams();
  const month = today.slice(0, 7);
  const { loading } = useTransactionWindow({
    from: monthStart(month),
    to: monthEnd(month),
    overdueBills: true,
    recent: { limit: 30, today },
  });

  // Sem a janela certa carregada os números do mês ficariam incompletos: espera em vez de mostrar valores errados.
  if (!ready || loading) return <PageSkeleton />;

  if (data.profiles.length === 0 || data.accounts.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Visão Geral</h1>
        <DataSourceNotice />
        <Card>
        <EmptyState
          icon={Landmark}
          title="Vamos começar?"
          description="Cadastre as pessoas e as contas para ver sua visão geral financeira."
        />
        <div className="flex flex-wrap justify-center gap-2 pb-6 text-sm">
          <Link href="/pessoas" className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">
            Cadastrar pessoas
          </Link>
          <Link href="/contas" className="rounded-lg border border-border px-4 py-2 font-medium hover:bg-muted">
            Cadastrar contas
          </Link>
        </div>
        </Card>
      </div>
    );
  }

  const view = buildDashboard(
    data,
    { profileId: searchParams.get("perfil") ?? ALL_PROFILES, month },
    currentProfile?.name ?? "",
    today,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {view.userName && <p className="text-sm text-muted-foreground">Olá, {view.userName}</p>}
          <h1 className="text-2xl font-semibold tracking-tight">Visão Geral</h1>
          <p className="text-sm text-muted-foreground">{formatMonthYear(view.month)}</p>
        </div>
        <ProfileFilter profiles={view.profiles} selected={view.filters.profileId} />
      </div>

      <DataSourceNotice />

      <SummaryCards summary={view.summary} />
      <p className="-mt-3 text-xs text-muted-foreground">
        Visão rápida do mês.{" "}
        <Link href="/relatorios" className="font-medium text-primary hover:underline" data-testid="dash-reports-link">
          Ver relatório completo
        </Link>{" "}
        (fluxo de caixa, consumo, cartões, dívidas, patrimônio e comparações).
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SpendingByCategory
            items={view.spendingByCategory}
            totalCents={view.summary.spentCents}
            excludedCents={view.summary.plannedCents}
          />
        </div>
        <AvailableBreakdown data={view.availableBreakdown} />
      </div>

      <PocketsOverview data={data} today={today} profileId={view.filters.profileId} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UpcomingBills items={view.upcoming} />
        <CardsOverview cards={view.cards} />
      </div>

      <RecentTransactions items={view.recent} />
    </div>
  );
}
