import type { Metadata } from "next";
import { DataSettings } from "@/components/settings/data-settings";

export const metadata: Metadata = { title: "Configurações" };

export default function Page() {
  return <DataSettings />;
}
