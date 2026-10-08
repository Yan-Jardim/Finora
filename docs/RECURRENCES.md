# Recorrências

Cadastre uma vez (salário, internet, academia, IPVA…) e o Finora gera as ocorrências futuras como **movimentações comuns**.

## Modelagem

| Conceito | Onde | Soma? |
|---|---|---|
| **Template** (`RecurringTransaction`) | tabela `recurring_transactions` | **Nunca.** |
| **Ocorrência** | `transactions` (`recurring_transaction_id` + `occurrence_date`) | Sim, como qualquer transação (saldo, despesas, dashboard, planejamento, calendário). |
| Ocorrência excluída pelo usuário | `recurring_skips` | Não (só impede recriar). |

Por que não há risco de template + ocorrência serem contados juntos: nenhuma view, soma ou o dashboard lê o template; só `transactions`. O template é tabela separada, sem coluna de saldo.

Campos do template: `kind` (receita, despesa ou compra no cartão), descrição, valor (centavos), perfil, conta **ou** cartão, categoria (obrigatória), tags (array), observações, `frequency` (semanal/mensal/anual), `interval_count` (1–24: "a cada N"), `start_date` (âncora), `end_date`, `materialize_from` (nada é gerado antes dele), `is_active`. RLS por household, FKs compostas, sem DELETE (só pausar).

**Recorrência ≠ parcelamento.** Parcelada é compra única dividida (`installment_purchases`); uma ocorrência nunca é parcela (CHECK).

## Datas (regra única)

`public.recurrence_dates` (SQL) e `domain/recurrence.ts → occurrenceDates` (TS) são espelhos e têm os mesmos testes:

- mensal/anual: mês da âncora + N·n, **sempre a partir da âncora**, no dia da âncora limitado ao último dia do mês (31/10 → 30/11 → 31/12 → 31/01 → 28/02 → 31/03; 29/02 → 28/02 em ano comum; 29/02/2028 em ano bissexto);
- semanal: âncora + 7·N·n dias;
- nunca antes da âncora; virada de ano é natural.

## Materialização e idempotência

- **Horizonte: 12 meses** à frente de "hoje" (fuso do household). Nunca infinito.
- **Índice único** `(recurring_transaction_id, occurrence_date)` + `INSERT … ON CONFLICT DO NOTHING`: gerar duas vezes jamais duplica ("Internet novembro" não existe 2x), mesmo com duas abas sincronizando.
- Sem cron: `sync_recurring_transactions` roda **a cada carga da app** (e dentro de criar/editar/pausar). Passos, todos repetíveis:
  1. reativa futuras canceladas **pela regra** que voltaram à agenda;
  2. cancela (pela regra) futuras **planned** fora da agenda (pausa, fim, mudança de agenda);
  3. cria as que faltam (respeita "puladas");
  4. promove `planned → pending` quando a data chegou.
- O passado **não é reconstruído**: `materialize_from = max(start_date, hoje)` na criação.
- Pagas e canceladas **pelo usuário** nunca são tocadas. Cancelamento da regra é marcado (`canceled_by_rule`) e é o único que a regra desfaz.

## Edição (`update_recurring_transaction`)

Altera a regra **daqui para frente** e nunca reescreve o passado:

- pagas, passadas (data da ocorrência < hoje) e canceladas ficam exatamente como estão;
- por padrão (`applyToFuture`), ocorrências futuras **ainda não pagas** (previstas/pendentes, a partir de hoje) recebem os novos campos e tags. Com `false`, só a regra muda (vale para as geradas depois);
- **decisão importante:** edições individuais feitas numa ocorrência futura não paga são sobrescritas quando a regra é editada com `applyToFuture`. Pagas/canceladas por você nunca;
- mudou a agenda (frequência/intervalo/início)? as futuras previstas fora da nova agenda são canceladas pela regra e as novas são criadas a partir de hoje; voltar à agenda anterior reativa (sem duplicar).

## Pausar / reativar (`set_recurring_transaction_active`)

- **Pausar:** para de gerar e **cancela** (não apaga) as futuras previstas, de forma reversível. Pagas, pendentes e passadas intactas.
- **Reativar:** gera daqui para frente (sem preencher o intervalo pausado) e reativa as futuras que a pausa cancelou. A cancelada por você continua cancelada.
- Nenhuma RPC de recorrência usa `DELETE`.

## Excluir uma ocorrência = pular

Excluir uma ocorrência gerada registra um *skip* (trigger `SECURITY DEFINER`); a sincronização, a edição e a pausa/reativação **não a recriam**. Para parar de gerar, pause a regra.

## Cartão

Compra recorrente no cartão foi incluída porque reaproveita exatamente o caminho de compra no cartão: a ocorrência é uma `credit_card_purchase`; o `invoice_id` é decidido pelo **banco** (`invoice_cycle`); não mexe no saldo; consome limite só quando a data chega (a compra prevista não consome); nunca é "paga" (quem quita é o pagamento da fatura). Mesma convenção das parcelas: ocorrências futuras já aparecem nas faturas futuras. Limitação: pausar não consegue cancelar uma ocorrência prevista que esteja numa fatura **totalmente paga** (o banco recusa com `invoice_paid_locked`).

## RPCs

`create_recurring_transaction`, `update_recurring_transaction`, `set_recurring_transaction_active`, `sync_recurring_transactions` (+ `recurrence_dates`). Todas `SECURITY INVOKER` (RLS e FKs compostas valem), o household é derivado do perfil/da regra, `anon` sem acesso. No front: `RecurrenceCommands` (Local/Supabase), sem sequência de inserts no navegador.

## Planejamento futuro

As ocorrências já materializadas respondem "o que se espera em novembro/dezembro/janeiro…" por consulta de `transactions` (janela de datas). Além do horizonte, `occurrenceDates(rule, from, to)` projeta a agenda sem gravar nada.
