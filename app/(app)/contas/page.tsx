import type { Metadata } from "next";
import { AccountsView } from "@/components/accounts/accounts-view";

export const metadata: Metadata = { title: "Contas" };

export default function Page() {
  return <AccountsView />;
}
