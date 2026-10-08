import type { Metadata } from "next";
import { CardsView } from "@/components/cards/cards-view";

export const metadata: Metadata = { title: "Cartões" };

export default function Page() {
  return <CardsView />;
}
