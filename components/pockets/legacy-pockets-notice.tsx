"use client";

import { History } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { legacyRefOf, type PocketMigrationReport } from "@/services/pocket-migration";

/**
 * Aviso discreto dos cofrinhos da VERSÃO ANTERIOR. Nada é importado sem o clique do usuário, e a chave antiga NUNCA é
 * apagada. Quem já foi importado (legacyRef) não aparece mais na contagem; o resultado fica na tela até ser dispensado.
 */
export function LegacyPocketsNotice() {
  const { data, legacyPockets, importLegacyPockets } = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PocketMigrationReport | null>(null);

  const imported = new Set(data.pockets.map((p) => p.legacyRef).filter(Boolean));
  const pending = legacyPockets.filter((l) => !imported.has(legacyRefOf(l.id)));

  const run = async () => {
    setBusy(true);
    try {
      const result = await importLegacyPockets();
      if (result) setReport(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível importar os cofrinhos.");
    } finally {
      setBusy(false);
    }
  };

  if (report) {
    return (
      <Card className="flex flex-col gap-3 border-primary/30" role="status" aria-label="Resultado da importação dos cofrinhos">
        <p className="text-sm font-semibold">Importação dos cofrinhos da versão anterior</p>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            Importados: <strong>{report.imported}</strong>
            {report.alreadyImported > 0 && <span className="text-muted-foreground"> · já importados antes: {report.alreadyImported}</span>}
          </li>
          <li>
            Importados sem reserva por falta de saldo livre: <strong>{report.withoutReserve.length}</strong>
          </li>
          <li>
            Falhas: <strong>{report.failed.length}</strong>
          </li>
        </ul>
        {report.withoutReserve.length > 0 && (
          <div className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
            <p className="font-medium">O cofrinho foi criado, mas a reserva anterior não cabe no saldo livre da conta. Reserve de novo quando houver saldo:</p>
            <ul className="mt-1 list-disc pl-4">
              {report.withoutReserve.map((r) => (
                <li key={r.name}>
                  {r.name}: {formatMoney(r.amountCents)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {report.failed.length > 0 && (
          <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
            <ul className="list-disc pl-4">
              {report.failed.map((f) => (
                <li key={f.name}>
                  {f.name}: {f.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Os dados antigos continuam guardados neste navegador (nada foi apagado).</p>
        <div>
          <Button variant="secondary" size="sm" onClick={() => setReport(null)}>
            Entendi
          </Button>
        </div>
      </Card>
    );
  }

  if (pending.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" role="note" aria-label="Cofrinhos da versão anterior">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <History className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-medium">Encontramos cofrinhos da versão anterior.</p>
          <p className="text-xs text-muted-foreground">
            {pending.length} {pending.length === 1 ? "cofrinho" : "cofrinhos"} (
            {pending
              .slice(0, 3)
              .map((p) => p.name)
              .join(", ")}
            {pending.length > 3 ? "…" : ""}). Importar não apaga os dados antigos e respeita o saldo livre da conta.
          </p>
        </div>
      </div>
      <Button size="sm" onClick={run} disabled={busy}>
        {busy ? "Importando…" : "Importar cofrinhos"}
      </Button>
    </Card>
  );
}
