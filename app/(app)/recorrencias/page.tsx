import type { Metadata } from "next";
import { RecurrencesView } from "@/components/recurrences/recurrences-view";

export const metadata: Metadata = { title: "Recorrências" };

export default function Page() {
  return <RecurrencesView />;
}
