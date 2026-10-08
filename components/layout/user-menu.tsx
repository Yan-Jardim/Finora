"use client";

import { LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/lib/auth/actions";

/** Avatar da pessoa logada com menu (identificação + Sair). */
export function UserMenu({ name, email, householdName }: { name: string; email: string; householdName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Menu do usuário ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex size-9 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary"
      >
        {name.charAt(0).toUpperCase()}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
            {householdName && <p className="mt-1 truncate text-xs text-muted-foreground">Espaço: {householdName}</p>}
          </div>
          <form action={logoutAction}>
            <button type="submit" role="menuitem" className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-muted">
              <LogOut className="size-4" aria-hidden /> Sair
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
