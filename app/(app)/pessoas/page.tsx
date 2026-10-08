import type { Metadata } from "next";
import { ProfilesView } from "@/components/profiles/profiles-view";

export const metadata: Metadata = { title: "Pessoas" };

export default function Page() {
  return <ProfilesView />;
}
