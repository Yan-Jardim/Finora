import type { Metadata } from "next";
import { TransactionsView } from "@/components/transactions/transactions-view";

export const metadata: Metadata = { title: "Movimentações" };

export default function Page() {
  return <TransactionsView />;
}
