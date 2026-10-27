"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigation } from "@/config/navigation";
import { cn } from "@/lib/utils";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-6">
      {navigation.map((group, index) => (
        <div key={group.title ?? index} className="flex flex-col gap-1">
          {group.title && (
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
          )}
          {group.items.map(({ label, href, icon: Icon, soon }) => {
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
            const base = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors";

            if (soon) {
              return (
                <span
                  key={href}
                  aria-disabled="true"
                  className={cn(base, "cursor-not-allowed text-muted-foreground/60")}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="flex-1">{label}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">Em breve</span>
                </span>
              );
            }

            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  base,
                  active
                    ? "bg-primary-soft font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
