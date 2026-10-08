import type { Metadata } from "next";
import { PlanningView } from "@/components/planning/planning-view";

export const metadata: Metadata = { title: "Planejamento" };

export default function Page() {
  return <PlanningView />;
}
