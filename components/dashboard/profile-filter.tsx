import Link from "next/link";
import type { FinancialProfile } from "@/domain/types";
import { cn } from "@/lib/utils";

/** Todos | Pessoa 1 | Pessoa 2 | Casal — gerado a partir dos perfis cadastrados. Estado vive na URL. */
export function ProfileFilter({
  profiles,
  selected,
  basePath = "/",
}: {
  profiles: FinancialProfile[];
  selected: string;
  /** Página que recebe o filtro (?perfil=). */
  basePath?: string;
}) {
  const options = [{ id: "all", name: "Todos", color: undefined as string | undefined }, ...profiles];

  return (
    <nav aria-label="Filtrar por perfil" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
      {options.map((option) => {
        const active = option.id === selected;
        return (
          <Link
            key={option.id}
            href={option.id === "all" ? basePath : `${basePath}?perfil=${option.id}`}
            aria-current={active ? "true" : undefined}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
              active ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.color && <span className="size-2 rounded-full" style={{ backgroundColor: option.color }} aria-hidden />}
            {option.name}
          </Link>
        );
      })}
    </nav>
  );
}
