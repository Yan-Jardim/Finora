"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Field, FormFooter, Input, Select } from "@/components/forms/fields";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useToast } from "@/components/providers/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format";
import {
  addBankConnection,
  getOpenFinanceState,
  linkBankBalance,
  removeBankConnection,
  syncBankConnections,
  type ActionResult,
  type BankConnectionView,
  type OpenFinanceState,
} from "@/lib/open-finance/actions";
import { cn } from "@/lib/utils";
import { bankConnectionSchema, type BankConnectionFormValues } from "@/schemas/bank-connection";

const syncedAtLabel = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso))
    : "nunca";

/**
 * Saldos lidos do banco via Open Finance (Pluggy). Só no modo supabase.
 * Dados reais têm prioridade: cada conta real fica ligada a uma conta do Finora, que passa a usar o saldo do banco.
 */
export function OpenFinancePanel() {
  const toast = useToast();
  const { reload } = useWorkspace();
  const [state, setState] = useState<OpenFinanceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<BankConnectionView | undefined>();
  const autoSynced = useRef(false);

  const apply = useCallback(
    (result: ActionResult, success?: string) => {
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      setState(result.state);
      if (result.accountsChanged) void reload();
      if (success) toast.success(success);
      return true;
    },
    [toast, reload],
  );

  const runAction = useCallback(
    async (fn: () => Promise<ActionResult>, success?: string) => {
      setBusy(true);
      try {
        return apply(await fn(), success);
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  // Ao abrir: mostra o que já está salvo e, em seguida, relê no banco só as conexões desatualizadas.
  useEffect(() => {
    if (autoSynced.current) return;
    autoSynced.current = true;
    void (async () => {
      const initial = await getOpenFinanceState();
      if (!apply(initial) || !initial.ok || initial.state.connections.length === 0) return;
      setBusy(true);
      try {
        const synced = await syncBankConnections({ onlyStale: true });
        if (synced.ok) apply(synced);
      } finally {
        setBusy(false);
      }
    })();
  }, [apply]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Saldos no banco (Open Finance)</h2>
          <p className="text-sm text-muted-foreground">
            Lidos pelo Meu Pluggy, que atualiza uma vez por dia. Têm prioridade: a conta ligada no Finora usa o saldo do banco nos totais.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !state || state.connections.length === 0}
            onClick={() => runAction(() => syncBankConnections(), "Saldos atualizados.")}
          >
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden /> Atualizar agora
          </Button>
          <Button size="sm" disabled={busy || !state} onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden /> Conectar banco
          </Button>
        </div>
      </div>

      {!state ? (
        <Card>
          <p className="text-sm text-muted-foreground">Carregando conexões…</p>
        </Card>
      ) : state.connections.length === 0 ? (
        <Card className="flex flex-col gap-1">
          <p className="text-sm font-medium">Nenhum banco conectado</p>
          <p className="text-sm text-muted-foreground">
            Autorize seus bancos no Meu Pluggy, copie o Item ID de cada conexão no Dashboard da Pluggy e clique em
            &quot;Conectar banco&quot;.
            {state.credentialKeys.length === 0 && " Antes, as credenciais da Pluggy precisam estar nas variáveis de ambiente da Vercel."}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {state.connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              busy={busy}
              onRemove={() => setRemoving(connection)}
              onLink={(balanceId, accountId) => runAction(() => linkBankBalance(balanceId, accountId))}
            />
          ))}
        </div>
      )}

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Conectar banco"
        description="Use um banco já autorizado no Meu Pluggy. O Item ID fica no Dashboard da Pluggy, no menu de cada conexão."
      >
        <ConnectionForm
          credentialKeys={state?.credentialKeys ?? []}
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            const ok = await runAction(() => addBankConnection(values), "Banco conectado.");
            if (ok) setAdding(false);
          }}
        />
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(undefined)}
        title={`Desconectar "${removing?.institution ?? removing?.itemId}"?`}
        description="Os saldos lidos deste banco somem do Finora. O consentimento continua no Meu Pluggy até você revogá-lo lá."
        confirmLabel="Desconectar"
        onConfirm={() => runAction(() => removeBankConnection(removing!.id), "Banco desconectado.")}
      />
    </section>
  );
}

function ConnectionCard({
  connection,
  busy,
  onRemove,
  onLink,
}: {
  connection: BankConnectionView;
  busy: boolean;
  onRemove: () => void;
  onLink: (balanceId: string, accountId: string) => void;
}) {
  const { data } = useWorkspace();
  const owner = data.profiles.find((p) => p.id === connection.ownerProfileId);

  return (
    <Card className="flex flex-col gap-3 p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Building2 className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{connection.institution ?? "Banco"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {owner?.name ?? "—"} · atualizado em {syncedAtLabel(connection.lastSyncedAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {connection.lastError ? (
            <Badge tone="danger">Erro</Badge>
          ) : connection.statusNotice ? (
            <Badge tone="warning">Atenção</Badge>
          ) : (
            <Badge tone="success">OK</Badge>
          )}
          <Button variant="ghost" size="sm" disabled={busy} aria-label="Desconectar banco" onClick={onRemove}>
            <Trash2 className="size-3.5 text-danger" aria-hidden />
          </Button>
        </div>
      </div>

      {(connection.lastError || connection.statusNotice) && (
        <p
          className={cn(
            "mx-4 rounded-lg px-3 py-2 text-xs sm:mx-5",
            connection.lastError ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
          )}
        >
          {connection.lastError ?? connection.statusNotice}
        </p>
      )}

      {connection.balances.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5">Nenhuma conta lida ainda.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {connection.balances.map((balance) => {
            return (
              <li key={balance.id} className="grid grid-cols-1 items-center gap-2 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{balance.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {balance.type === "CREDIT" ? "Cartão de crédito" : "Conta"}
                    {balance.number ? ` · ${balance.number}` : ""}
                  </p>
                </div>
                <div className="md:text-right">
                  <p className="text-sm font-semibold tabular-nums">{formatMoney(balance.balanceCents)}</p>
                  <p className="text-xs text-muted-foreground">
                    {balance.type === "CREDIT"
                      ? balance.availableLimitCents !== null
                        ? `Fatura atual · limite livre ${formatMoney(balance.availableLimitCents)}`
                        : "Fatura atual"
                      : "Saldo no banco"}
                  </p>
                </div>
                {balance.type === "BANK" ? (
                  <div className="flex flex-col gap-1">
                    <Select
                      aria-label={`Conta do Finora que usa o saldo de ${balance.name}`}
                      value={balance.accountId ?? ""}
                      disabled={busy}
                      onChange={(e) => e.target.value && onLink(balance.id, e.target.value)}
                      className="h-8 text-xs"
                    >
                      {!balance.accountId && <option value="">Ligando a uma conta…</option>}
                      {data.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-muted-foreground">Conta do Finora que usa este saldo.</p>
                  </div>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ConnectionForm({
  credentialKeys,
  onCancel,
  onSubmit,
}: {
  credentialKeys: string[];
  onCancel: () => void;
  onSubmit: (values: BankConnectionFormValues) => Promise<void>;
}) {
  const { data, currentProfileId } = useWorkspace();
  const owners = data.profiles.filter((p) => p.active && p.kind === "individual");
  const ownProfile = owners.find((p) => p.id === currentProfileId);
  const guessKey = (name?: string) => credentialKeys.find((k) => name && name.toLowerCase().startsWith(k)) ?? credentialKeys[0] ?? "";

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<BankConnectionFormValues>({
    resolver: zodResolver(bankConnectionSchema),
    defaultValues: {
      ownerProfileId: ownProfile?.id ?? owners[0]?.id ?? "",
      credentialKey: guessKey(ownProfile?.name ?? owners[0]?.name),
      itemId: "",
    },
  });

  if (credentialKeys.length === 0) {
    return (
      <p className="rounded-lg bg-warning-soft px-3 py-3 text-sm text-warning">
        Nenhuma credencial da Pluggy configurada. Adicione <code>PLUGGY_&lt;NOME&gt;_CLIENT_ID</code> e{" "}
        <code>PLUGGY_&lt;NOME&gt;_CLIENT_SECRET</code> nas variáveis de ambiente da Vercel e faça um novo deploy.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Field label="De quem é o banco" error={errors.ownerProfileId?.message}>
        {(props) => (
          <Select
            {...props}
            {...register("ownerProfileId", {
              onChange: (e) => setValue("credentialKey", guessKey(owners.find((p) => p.id === e.target.value)?.name)),
            })}
          >
            {owners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Credenciais da Pluggy" hint="Conta do Meu Pluggy do dono do banco." error={errors.credentialKey?.message}>
        {(props) => (
          <Select {...props} {...register("credentialKey")}>
            {credentialKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Item ID" error={errors.itemId?.message}>
        {(props) => <Input {...props} {...register("itemId")} placeholder="ex.: 7a1b2c3d-…" autoComplete="off" spellCheck={false} />}
      </Field>
      <FormFooter onCancel={onCancel} submitting={isSubmitting} submitLabel="Conectar" />
    </form>
  );
}
