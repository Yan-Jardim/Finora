import type { Metadata } from "next";
import { BillsView } from "@/components/bills/bills-view";

export const metadata: Metadata = { title: "Contas do mês" };

export default function Page() {
  return <BillsView />;
}
