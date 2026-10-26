# Open Finance (validação)

Saldos reais dos bancos lidos pela [Pluggy](https://docs.pluggy.ai), no plano gratuito **Meu Pluggy** (uso pessoal:
até 5 conexões por conta, todas do mesmo titular, atualização automática a cada 24 h). Cada pessoa tem a própria conta
Meu Pluggy e o próprio par de credenciais.

O saldo do banco é **informação**: aparece em Contas ao lado do saldo do Finora (derivado das movimentações) para
conferir, e nunca entra em `v_account_balances`, snapshot, faturas ou relatórios.

## Configuração

1. Cada pessoa cria a conta em meu.pluggy.ai, autoriza os bancos e, no Dashboard da Pluggy, liga os itens do Meu
   Pluggy à aplicação de demonstração. De lá copia o Client ID, o Client Secret e o Item ID de cada banco.
2. Na Vercel (Settings → Environment Variables, marcadas como Sensitive):
   `PLUGGY_<NOME>_CLIENT_ID` e `PLUGGY_<NOME>_CLIENT_SECRET` (ex.: `PLUGGY_YAN_…`, `PLUGGY_CAMILA_…`). Novo deploy.
3. No app, Contas → "Conectar banco": dono, credenciais (`<nome>` em minúsculas) e Item ID.

## Como funciona

| Peça | Onde |
|---|---|
| Cliente da API (auth, item, contas) | `lib/open-finance/pluggy.ts` |
| Regras puras (centavos, status, quando reler) | `lib/open-finance/sync.ts` |
| Credenciais por variável de ambiente | `lib/open-finance/credentials.ts` |
| Server Actions (ler, conectar, sincronizar, comparar) | `lib/open-finance/actions.ts` |
| Tela | `components/accounts/open-finance-panel.tsx` (só no modo `supabase`) |
| Tabelas e RPC | `bank_connections`, `bank_balances`, `record_bank_sync` |

- **Sem service_role e sem cron:** a sincronização roda numa Server Action com a sessão de quem abriu a tela (RLS
  vale). Ao abrir Contas, conexões sem leitura há 12 h ou mais são relidas; "Atualizar agora" relê todas.
- **Sem segredos no banco:** `bank_connections.credential_key` só diz qual par de variáveis usar; o Item ID sozinho
  não dá acesso a nada.
- **Uma RPC por conexão** (`record_bank_sync`, SECURITY INVOKER): grava status, instituição e substitui os saldos da
  conexão atomicamente. Em erro, registra a mensagem e mantém os últimos saldos bons.
- Cartão (`CREDIT`): `balance` é a fatura atual; limite total e disponível vêm de `creditData`.
