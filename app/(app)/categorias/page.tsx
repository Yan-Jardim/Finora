import type { Metadata } from "next";
import { CategoriesView } from "@/components/categories/categories-view";

export const metadata: Metadata = { title: "Categorias" };

export default function Page() {
  return <CategoriesView />;
}
