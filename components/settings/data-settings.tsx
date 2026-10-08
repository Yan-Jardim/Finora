"use client";

import { Cloud, Database, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/providers/toast-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import type { WorkspaceSeedMode } from "@/repositories/types";

const copy: Record<WorkspaceSeedMode, { title: string; description: string; confirm: string; done: string }> = {
  empty: {
    title: "Começar do zero?",
    description: "Remove TODOS os dados (inclusive os de exemplo) deste navegador. Esta ação não pode ser desfeita.",
    confirm: "Apagar tudo",
    done: "Dados apagados. Cadastre suas pessoas e contas para começar.",
  },
  demo: {
    title: "Restaurar dados de exemplo?",
    description: "Substitui tudo o que você cadastrou pelos dados de exemplo. Esta ação não pode ser desfeita.",
    confirm: "Restaurar exemplos",
    done: "Dados de exemplo restaurados.",
  },
};

export function DataSettings() {
  const { resetWorkspace, canResetDemo, mode: dataMode } = useWorkspace();
  const toast = useToast();
  const [seedMode, setSeedMode] = useState<WorkspaceSeedMode | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Configurações" description="Preferências e dados do aplicativo." />

      {dataMode === "supabase" && (
        <Card>
          <CardHeader
            title="Fonte dos dados"
            description="Pessoas, Categorias, Contas, Cartões e Movimentações (parcelas, faturas e tags) são salvos no Supabase e acompanham sua conta em qualquer dispositivo."
          />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Cloud className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Movimentações antigas que estiverem salvas neste navegador não são apagadas nem importadas automaticamente.
            Por segurança, restaurar exemplos e apagar tudo ficam desabilitados com dados reais.
          </p>
        </Card>
      )}

      {canResetDemo && (
        <Card>
          <CardHeader
            title="Dados salvos neste navegador"
            description="No modo de demonstração os dados ficam apenas no seu navegador (localStorage)."
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="secondary" onClick={() => setSeedMode("demo")}>
              <RotateCcw className="size-4" aria-hidden /> Restaurar dados de exemplo
            </Button>
            <Button variant="secondary" onClick={() => setSeedMode("empty")}>
              <Trash2 className="size-4 text-danger" aria-hidden /> Começar do zero
            </Button>
          </div>
          <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
            <Database className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Ao começar do zero, as movimentações também são removidas.
          </p>
        </Card>
      )}

      {seedMode && (
        <ConfirmDialog
          open
          onClose={() => setSeedMode(null)}
          title={copy[seedMode].title}
          description={copy[seedMode].description}
          confirmLabel={copy[seedMode].confirm}
          onConfirm={async () => {
            await resetWorkspace(seedMode);
            toast.success(copy[seedMode].done);
            return true;
          }}
        />
      )}
    </div>
  );
}
