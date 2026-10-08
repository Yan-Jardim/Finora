"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { monthEnd, monthStart, todayISO, todayInZone } from "@/domain/dates";
import type { FinancialProfile, ISODate, WorkspaceData } from "@/domain/types";
import type { DataSourceMode } from "@/lib/config/data-source";
import { createClient } from "@/lib/supabase/client";
import { MOCK_CURRENT_USER } from "@/mocks/data";
import { createDataSource } from "@/repositories";
import { loadWorkspace } from "@/repositories/load-workspace";
import type { TransactionWindow, WorkspaceSeedMode, Repositories } from "@/repositories/types";
import type { DebtCommands } from "@/services/debt-commands";
import type { PocketCommands } from "@/services/pocket-commands";
import type { LegacyPocket, PocketMigrationReport } from "@/services/pocket-migration";
import type { RecurrenceCommands } from "@/services/recurrence-commands";
import type { TransactionCommands } from "@/services/transaction-commands";
import { useToast } from "./toast-provider";

const EMPTY: WorkspaceData = {
  profiles: [],
  categories: [],
  accounts: [],
  creditCards: [],
  transactions: [],
  installmentPurchases: [],
  recurringTransactions: [],
  debts: [],
  pockets: [],
  pocketMovements: [],
  goals: [],
};

/** Fuso usado quando o household não informa um (o padrão do banco). */
const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export interface WorkspaceConfig {
  mode: DataSourceMode;
  /** Household do usuário (vem do servidor; usado pelos repositórios Supabase). */
  householdId: string;
  /** Perfil financeiro vinculado ao login (modo supabase). */
  currentProfileId?: string;
  /**
   * Fuso (IANA) do household (modo supabase). É a fonte de "hoje" para regras sensíveis a data — o MESMO fuso que o
   * banco usa em household_today()/v_card_usage —, para o navegador e o banco nunca decidirem diferente.
   */
  timezone?: string;
}

interface WorkspaceContextValue {
  data: WorkspaceData;
  /** false até os dados serem carregados no navegador. */
  ready: boolean;
  repos: Repositories;
  /** Comandos que alteram movimentações (motor local ou RPCs do banco). */
  commands: TransactionCommands;
  /** Comandos de recorrência (template): criar, editar daqui para frente, pausar e sincronizar. */
  recurrence: RecurrenceCommands;
  /** Comandos de dívida: criar, editar, pagar parcela/parcial, quitar, pausar. */
  debtCommands: DebtCommands;
  /** Comandos de cofrinhos (reservar, retirar, transferir, gastar, estornar, arquivar, ligar objetivo). */
  pocketCommands: PocketCommands;
  /** Cofrinhos antigos (versão anterior) ainda neste navegador. A chave antiga nunca é apagada: quem já foi importado é filtrado pela tela. */
  legacyPockets: LegacyPocket[];
  /** Importa os cofrinhos antigos do navegador (ação explícita do usuário; idempotente). Recarrega os dados. */
  importLegacyPockets: () => Promise<PocketMigrationReport | null>;
  mode: DataSourceMode;
  /** "Hoje" (YYYY-MM-DD): fuso do household no modo supabase; navegador no local. */
  today: ISODate;
  /** Restaurar/zerar dados de demonstração só existe no modo local. */
  canResetDemo: boolean;
  /** Categorias iniciais (só modo supabase). */
  seedDefaultCategories?: () => Promise<number>;
  reload: () => Promise<void>;
  resetWorkspace: (mode: WorkspaceSeedMode) => Promise<void>;
  currentProfileId?: string;
  /** Movimentações antigas ainda salvas neste navegador (modo supabase): não são importadas nem apagadas. */
  legacyLocalTransactions: number;
  /** Define a janela de movimentações que a tela precisa (veja useTransactionWindow). */
  setWindow: (window: TransactionWindow) => void;
  /** Chave da janela já carregada em `data.transactions`. */
  loadedWindowKey: string | null;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const windowKey = (w: TransactionWindow) => JSON.stringify(w);

const messageOf = (error: unknown) => (error instanceof Error ? error.message : "Não foi possível carregar seus dados.");

/** Contagem de movimentações antigas deixadas no localStorage por versões anteriores do modo supabase. */
function countLegacyLocal(householdId: string): number {
  try {
    const raw = window.localStorage.getItem(`finora:v1:sb:${householdId}:transactions`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function WorkspaceProvider({ children, config }: { children: React.ReactNode; config: WorkspaceConfig }) {
  const [data, setData] = useState<WorkspaceData>(EMPTY);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedWindowKey, setLoadedWindowKey] = useState<string | null>(null);
  const [legacyLocalTransactions, setLegacyLocal] = useState(0);
  const [legacyPockets, setLegacyPockets] = useState<LegacyPocket[]>([]);

  const getToday = useCallback(
    (): ISODate => (config.mode === "supabase" ? todayInZone(config.timezone ?? DEFAULT_TIMEZONE) : todayISO()),
    [config.mode, config.timezone],
  );
  const today = getToday();

  const source = useMemo(
    () =>
      createDataSource({
        mode: config.mode,
        householdId: config.householdId,
        client: config.mode === "supabase" ? createClient() : undefined,
      }),
    [config.mode, config.householdId],
  );

  // Janela padrão: o mês atual. As telas pedem a que precisam (useTransactionWindow).
  const defaultWindow = useMemo<TransactionWindow>(() => {
    const month = getToday().slice(0, 7);
    return { from: monthStart(month), to: monthEnd(month) };
  }, [getToday]);
  const windowRef = useRef<TransactionWindow>(defaultWindow);
  const keyRef = useRef(windowKey(defaultWindow));
  const fullSeq = useRef(0);
  const txSeq = useRef(0);
  // Marcado DENTRO da carga (síncrono): se a tela monta no mesmo commit em que a 1ª carga termina, o setWindow dela
  // ainda precisa carregar a janela pedida (um flag atualizado em efeito chegaria tarde demais).
  const loadedOnceRef = useRef(false);
  // A sincronização de recorrências roda UMA vez por carga da página (e é idempotente): cria o que falta, estende o
  // horizonte e promove previstas cuja data chegou — sem cron externo.
  const syncedRef = useRef(false);
  // A preparação (migração dos cofrinhos antigos, modo local) também roda uma vez por carga da página e é idempotente.
  const preparedRef = useRef(false);

  // Recriado a cada carga: as regras do motor local e o preview de escopo leem os dados carregados no momento.
  const commands = useMemo(() => source.createCommands({ today: getToday, data: () => data }), [source, getToday, data]);

  const recurrence = useMemo(() => source.createRecurrenceCommands({ today: getToday }), [source, getToday]);
  const debtCommands = useMemo(() => source.createDebtCommands({ today: getToday }), [source, getToday]);
  const pocketCommands = useMemo(() => source.createPocketCommands({ today: getToday }), [source, getToday]);

  /** Só as movimentações da janela atual (troca de mês): saldos e cadastros não mudam por navegar. */
  const loadTransactions = useCallback(async () => {
    const id = ++txSeq.current;
    const key = keyRef.current;
    const found = await source.repos.transactions.query(windowRef.current);
    if (id !== txSeq.current || key !== keyRef.current) return; // resposta de uma janela que já não é a atual
    setData((prev) => ({ ...prev, transactions: found.items, transactionsTruncated: found.truncated }));
    setLoadedWindowKey(key);
  }, [source]);

  /** Tudo (cadastros, movimentações da janela, saldos/faturas/limites). Após cada mutação. */
  const loadAll = useCallback(async () => {
    const id = ++fullSeq.current;
    const key = keyRef.current;
    if (!preparedRef.current) {
      preparedRef.current = true;
      try {
        source.prepare?.();
      } catch (error) {
        // Não bloqueia o app: a preparação é idempotente e roda de novo na próxima carga.
        preparedRef.current = false;
        if (process.env.NODE_ENV !== "production") console.warn("[finora:cofrinhos] preparação falhou", error);
      }
    }
    // Cofrinhos antigos (modo local e supabase): só LISTA; a importação é uma ação explícita do usuário.
    setLegacyPockets(source.readLegacyPockets?.() ?? []);
    if (!syncedRef.current) {
      syncedRef.current = true;
      try {
        await source.createRecurrenceCommands({ today: getToday }).sync();
      } catch (error) {
        // Não bloqueia o app: as recorrências sincronizam de novo na próxima carga.
        if (process.env.NODE_ENV !== "production") console.warn("[finora:recorrencias] sync falhou", error);
      }
    }
    const next = await loadWorkspace(source, windowRef.current);
    if (id !== fullSeq.current) return;
    loadedOnceRef.current = true;
    setData(next);
    setReady(true);
    setLoadError(null);
    setLoadedWindowKey(key);
    if (keyRef.current !== key) await loadTransactions(); // a tela mudou de janela durante a carga
  }, [source, loadTransactions, getToday]);

  const setWindow = useCallback(
    (window: TransactionWindow) => {
      const key = windowKey(window);
      if (key === keyRef.current) return;
      keyRef.current = key;
      windowRef.current = window;
      if (loadedOnceRef.current) void loadTransactions().catch((error) => setLoadError(messageOf(error)));
      // Antes da primeira carga completa, loadAll já lê a janela atualizada.
    },
    [loadTransactions],
  );

  const reload = loadAll;

  const importLegacyPockets = useCallback(async () => {
    if (!source.importLegacyPockets) return null;
    const report = await source.importLegacyPockets();
    setLegacyPockets(source.readLegacyPockets?.() ?? []);
    await loadAll();
    return report;
  }, [source, loadAll]);

  const resetWorkspace = useCallback(
    async (mode: WorkspaceSeedMode) => {
      if (!source.admin) throw new Error("Restaurar/zerar dados de demonstração só existe no modo local.");
      await source.admin.reset(mode);
      await loadAll();
    },
    [source, loadAll],
  );

  useEffect(() => {
    // Carga inicial (só no navegador) e sincronia entre abas para a parte guardada em localStorage.
    let cancelled = false;
    const load = () =>
      loadAll().catch((error) => {
        if (!cancelled) setLoadError(messageOf(error));
      });
    void load();
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith("finora:v1:")) void load();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, [loadAll]);

  useEffect(() => {
    if (config.mode !== "supabase") return;
    // Leitura única para o aviso de dados antigos; evita setState síncrono no efeito.
    const id = window.setTimeout(() => setLegacyLocal(countLegacyLocal(config.householdId)), 0);
    return () => window.clearTimeout(id);
  }, [config.mode, config.householdId]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      data,
      ready,
      repos: source.repos,
      commands,
      recurrence,
      debtCommands,
      pocketCommands,
      legacyPockets,
      importLegacyPockets,
      mode: source.mode,
      today,
      canResetDemo: !!source.admin,
      seedDefaultCategories: source.seedDefaultCategories,
      reload,
      resetWorkspace,
      currentProfileId: config.currentProfileId,
      legacyLocalTransactions,
      setWindow,
      loadedWindowKey,
    }),
    [data, ready, source, commands, recurrence, debtCommands, pocketCommands, legacyPockets, importLegacyPockets, today, reload, resetWorkspace, config.currentProfileId, legacyLocalTransactions, setWindow, loadedWindowKey],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {loadError ? (
        <Card className="mx-auto mt-10 max-w-md text-center">
          <p className="text-sm font-medium">Não foi possível carregar seus dados</p>
          <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
          <Button
            className="mt-4"
            onClick={() => {
              setLoadError(null);
              void reload().catch((error) => setLoadError(messageOf(error)));
            }}
          >
            Tentar novamente
          </Button>
        </Card>
      ) : (
        children
      )}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace precisa estar dentro de <WorkspaceProvider>.");
  return ctx;
}

/**
 * Declara a janela de movimentações que a tela precisa. No Supabase só esse recorte é carregado; no modo local
 * tudo já está em memória e a janela é ignorada. `loading` = os dados em `data.transactions` ainda são de outra janela.
 */
export function useTransactionWindow(window: TransactionWindow) {
  const { setWindow, loadedWindowKey } = useWorkspace();
  const key = windowKey(window);
  const stable = useMemo(() => JSON.parse(key) as TransactionWindow, [key]);
  useEffect(() => {
    setWindow(stable);
  }, [setWindow, stable]);
  return { loading: loadedWindowKey !== key };
}

/** Perfil financeiro do usuário logado. No modo supabase vem do vínculo user_id; no local, é o usuário simulado. */
export function useCurrentProfile(): FinancialProfile | undefined {
  const { data, mode, currentProfileId } = useWorkspace();
  if (mode === "supabase") return data.profiles.find((p) => p.id === currentProfileId);
  return (
    data.profiles.find((p) => p.id === MOCK_CURRENT_USER.profileId) ??
    data.profiles.find((p) => p.kind === "individual")
  );
}

/**
 * Há uma mutação em andamento? Compartilhado por TODAS as telas: um segundo clique (ou um segundo diálogo) enquanto a
 * primeira operação não terminou é IGNORADO — nunca dispara duas operações financeiras. Vale mesmo para dois cliques no
 * mesmo instante (a trava é síncrona, antes de qualquer await).
 */
let actionInFlight = false;

/**
 * Executa uma mutação, recarrega os dados e dá feedback visual.
 * Retorna true em caso de sucesso (para o formulário fechar o dialog) e false em erro OU se já houver outra em andamento
 * (o diálogo continua aberto, com os dados, para tentar de novo).
 */
export function useAction() {
  const { reload } = useWorkspace();
  const toast = useToast();

  return useCallback(
    async (fn: () => Promise<unknown>, successMessage: string) => {
      if (actionInFlight) return false;
      actionInFlight = true;
      try {
        await fn();
        await reload();
        toast.success(successMessage);
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Algo deu errado. Tente novamente.");
        return false;
      } finally {
        actionInFlight = false;
      }
    },
    [reload, toast],
  );
}
