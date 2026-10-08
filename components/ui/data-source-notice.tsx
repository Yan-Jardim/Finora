"use client";

import { Info } from "lucide-react";
import { useWorkspace } from "@/components/providers/workspace-provider";

/**
 * Aviso do modo Supabase: as movimentações agora vêm do banco. O único caso que ainda precisa de aviso é haver
 * movimentações ANTIGAS salvas só neste navegador (versões anteriores): elas continuam intactas, mas não são
 * lidas nem importadas automaticamente (a importação virá em etapa própria). Sem esse resíduo, nada é exibido.
 */
export function DataSourceNotice() {
  const { mode, legacyLocalTransactions } = useWorkspace();
  if (mode !== "supabase" || legacyLocalTransactions === 0) return null;

  return (
    <p className="flex items-start gap-2 rounded-xl border border-border bg-muted px-4 py-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong className="text-foreground">Movimentações antigas neste navegador:</strong> há {legacyLocalTransactions}{" "}
        {legacyLocalTransactions === 1 ? "registro" : "registros"} salvo(s) apenas aqui, de antes da integração com o
        Supabase. Eles não foram apagados nem importados e não entram nos saldos e totais. A importação virá em uma
        etapa própria.
      </span>
    </p>
  );
}
