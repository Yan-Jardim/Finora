import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PageSkeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Visão Geral" };

export default function DashboardPage() {
  // useSearchParams (filtro de perfil) exige Suspense.
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardView />
    </Suspense>
  );
}
