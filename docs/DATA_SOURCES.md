# Fontes de dados

O app tem **dois modos**, escolhidos por `NEXT_PUBLIC_DATA_SOURCE` (resolvido em tempo de build — mudou? reinicie o `dev` ou rode `npm run build`):

| Modo | Uso |
|---|---|
| `local` (padrão) | Demonstração e testes: tudo em `localStorage`, com dados de exemplo (`mocks/data.ts`). Motor de regras no cliente. |
| `supabase` | Dados reais, isolados por household via RLS: pessoas, categorias, contas, cartões, movimentações, recorrências, dívidas, cofrinhos e objetivos. |

O ponto único de escolha é `repositories/index.ts` (`createDataSource`). Componentes só conhecem `Repository<T>` (leitura/cadastros), `TransactionCommands` (escritas de movimentação) e o `FinanceSnapshot` (valores derivados).

## O que vem de onde (modo `supabase`)

| Dado | Fonte | Observações |
|---|---|---|
| Pessoas, Categorias, Contas, Cartões | **Supabase** | `accounts.initial_balance_cents` é só o saldo inicial. |
| Movimentações (`transactions`) | **Supabase** | Lidas **por janela de datas**; escritas só por RPC (abaixo). |
| Parcelas | **Supabase** | Cada parcela é uma `Transaction`; `installment_purchases` é só o agrupador (nunca soma). |
| Faturas (`card_invoices`) | **Supabase (somente leitura)** | O banco cria/atribui (`invoice_cycle`); o app **nunca** escreve nela. |
| Saldo por conta | **View** `v_account_balances` | Não recalculado no navegador. |
| Fatura (total/pago/em aberto) | **View** `v_card_invoice_totals` | |
| Limite usado/disponível | **View** `v_card_usage` | |
| Tags | **Supabase** | Sugestões vêm de `tags`; ligações via RPC. |
| Cofrinhos e objetivos | **Supabase** | Cadastro e histórico lidos do banco; saldo por `v_pocket_balances`, reservado por `v_account_reserves`; escritas só por RPC ([POCKETS.md](./POCKETS.md)). Objetivos: CRUD com RLS. |
| Recorrências, dívidas | **Supabase** | Leitura + RPCs; pago/parcelas de dívida por `v_debt_summary` / `v_debt_installments`. |
| Saldos no banco (Open Finance) | **Pluggy → Supabase** (`bank_connections`, `bank_balances`) | Só informação, para comparar; nunca soma ([OPEN_FINANCE.md](./OPEN_FINANCE.md)). |
| Login / household | **Supabase Auth** | |

### Escritas: tudo por RPC atômica

`SupabaseTransactionCommands` (`services/supabase-transaction-commands.ts`) — o cliente não replica operações multi-passo:

| Ação na UI | RPC |
|---|---|
| Receita / despesa / transferência / compra à vista (+ tags) | `create_transaction` |
| Compra parcelada | `create_installment_purchase` |
| Pagar fatura (conta escolhida no diálogo) | `pay_invoice` |
| Editar movimentação comum / marcar pago, pendente, cancelar | `update_transaction` |
| Editar parcela(s) — esta / esta e as próximas | `update_installments` |
| Excluir parcelas — esta / esta e as próximas / compra inteira | `delete_installments` |

Exceções documentadas (sem RPC; **uma** linha, atômicas, com RLS e triggers): excluir movimentação comum (`DELETE` de uma linha) e cancelar/reativar uma **parcela** (`update_installments` não aceita `status`).

### Leituras por janela (nunca o histórico inteiro)

`TransactionRepository.query(window)`: `{ from, to }` por data de competência; `paidBetween` (Relatórios: inclui também o que foi PAGO no período mesmo com competência anterior); `overdueBills` (contas a pagar pendentes de meses anteriores — o "Disponível de verdade" precisa delas); `recent` (últimas realizadas, para o painel). Paginado em blocos de 500, teto de 5.000 por janela (`transactionsTruncated` avisa a tela). Movimentações: o mês exibido; Dashboard: mês atual + vencidas + 30 recentes; Cartões/Contas: nenhuma (usam as views).

## Datas: fuso do household

"Hoje" decide pendente x prevista, limite já consumido e status de compra no cartão. **Fonte única: o fuso do household** (`households.timezone`, padrão `America/Sao_Paulo`):

- no banco: `private.household_today()` e `v_card_usage` (`now() at time zone h.timezone`);
- no navegador: `todayInZone(timezone)` (`domain/dates.ts`), exposto como `useWorkspace().today`. O fuso vem do servidor (`requireHousehold`).

Status de compra no cartão **não é decidido no cliente**: o app não envia `status` e o banco deriva (pendente se a data já chegou, senão prevista), inclusive ao editar a data. No modo local "hoje" é o do navegador. Limite conhecido: a virada do dia só é percebida no próximo carregamento/ação.

## Disponível de verdade

```
disponível = saldo em contas                       (v_account_balances; sem investimentos)
           − contas a pagar pendentes/atrasadas    (despesas com data ≤ mês exibido)
           − despesas previstas do mês exibido
           − faturas em aberto com vencimento ≤ mês exibido   (v_card_invoice_totals.open_cents)
           − dívidas a pagar (debt_payment) do mesmo critério
           − dinheiro reservado                    (soma dos cofrinhos; já está dentro do saldo)
```

Compra no cartão **não** reduz o saldo nem entra em "contas a pagar": é descontada **uma única vez, como parte da fatura aberta**. Pagar a fatura reduz saldo e fatura na mesma medida → o disponível não muda e nenhuma despesa nova nasce (`card_payment` nunca é despesa). "Gastos por categoria" usa o mesmo conjunto de "Despesas realizadas", então bate centavo a centavo.

A auditoria completa da fórmula (cada obrigação descontada uma vez) está em [FINANCIAL_RULES.md](./FINANCIAL_RULES.md).

## Rede: leituras repetidas, escritas nunca

O cliente do navegador usa `lib/supabase/resilient-fetch.ts`: repete (no máximo 2 vezes, espera 400 ms → 800 ms) **somente** leituras (GET/HEAD) e o login diante de 502/503/504 ou queda de conexão. Escritas (RPCs, PATCH, DELETE, POST) **nunca** são repetidas automaticamente; erros 4xx e cancelamentos (`AbortSignal`) também não. Veja [TEST_STABILITY.md](./TEST_STABILITY.md).

## Dados locais antigos

Movimentações antigas em `finora:v1:sb:<household>:transactions` **não são lidas, importadas nem apagadas**. Se existirem, um aviso informa a contagem; a importação virá em etapa própria. "Restaurar exemplos"/"Começar do zero" não existem no modo supabase.

## Erros

`repositories/supabase/errors.ts` traduz códigos de domínio (`invoice_paid_locked`, `payment_exceeds_open`, `use_pay_invoice`…), constraints nomeadas e SQLSTATE. A UI nunca mostra código cru; o detalhe técnico vai para `console.warn` fora de produção.

## Proteções

- App usa só a chave publishable + sessão; **nunca** `service_role`.
- Nenhuma escrita em `card_invoices`; nenhuma operação multi-passo fora de RPC.
- Testes de integração/E2E usam um usuário descartável `@test.invalid` (`.env.e2e.local`, ignorado pelo git).

## Recorrências

Templates em `recurring_transactions` (somente leitura no cliente); escritas por RPC (`create/update/set_active/sync`). As ocorrências são `transactions` normais e entram em saldo, dashboard e views como qualquer movimentação. Modo local: `LocalRecurrenceCommands` (mesmas regras, `domain/recurrence.ts`). Detalhes em [RECURRENCES.md](./RECURRENCES.md).

## Dívidas

Contrato em `debts` (leitura); pagos/parcelas/progresso pelas views `v_debt_summary` e `v_debt_installments` (snapshot); escritas por RPC (`create/update/pay/settle/reopen/set_status`). Só os pagamentos são transações (`debt_payment`). Detalhes em [DEBTS.md](./DEBTS.md). A fórmula do "Disponível de verdade" ganhou as parcelas de dívida em aberto (acima, em DEBTS.md).

## Planejamento

Projeção de caixa derivada (nada gravado): `domain/planning.ts` sobre o snapshot (saldos, faturas, parcelas de dívida) + movimentações em aberto até o fim do horizonte (`TransactionWindow.openOnly`). Detalhes e a recomendação sobre principal × custo financeiro das dívidas em [PLANNING.md](./PLANNING.md).

## Calendário

O Calendário não cria tabelas: usa `TransactionWindow.openOnly.withWindow` (itens em aberto até o horizonte + tudo do mês visto) e o snapshot (faturas e parcelas de dívida). Local e Supabase produzem o mesmo calendário (teste de paridade `tests/parity-calendar.supabase.test.ts`). Detalhes em [CALENDAR.md](./CALENDAR.md).
