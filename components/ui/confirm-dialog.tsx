"use client";

import { useState } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

/** Confirmação para ações destrutivas. `onConfirm` retorna true para fechar. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "Excluir",
  onConfirm,
  blockedReason,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => Promise<boolean>;
  /** Quando preenchido, a ação é impedida: mostra o motivo e só oferece "Entendi". */
  blockedReason?: string;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={blockedReason ? "Não é possível excluir" : title}
      description={blockedReason ?? description}
    >
      {blockedReason ? (
        <div className="flex justify-end">
          <Button onClick={onClose}>Entendi</Button>
        </div>
      ) : (
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await onConfirm();
            setBusy(false);
            if (ok) onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
      )}
    </Dialog>
  );
}
