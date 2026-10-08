"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * Dialog sobre o <dialog> nativo: foco preso, ESC, backdrop e acessibilidade vêm do navegador.
 * O conteúdo só é montado quando aberto, então formulários sempre iniciam limpos.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
      className="m-auto max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <header className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 id="dialog-title" className="text-lg font-semibold tracking-tight">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="-mr-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="size-5" />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
