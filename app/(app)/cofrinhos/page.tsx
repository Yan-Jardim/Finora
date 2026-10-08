import type { Metadata } from "next";
import { PocketsView } from "@/components/pockets/pockets-view";

export const metadata: Metadata = { title: "Cofrinhos" };

export default function Page() {
  return <PocketsView />;
}
