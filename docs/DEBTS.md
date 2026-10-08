# Dívidas e empréstimos

## Modelagem (sem dupla contagem)

| Conceito | Onde | Entra em saldo/despesas? |
|---|---|---|
| **Dívida** (contrato) | tabela `debts` | **Nunca.** |
| **Parcela** | **derivada** (view `v_debt_installments` / `domain/debts.ts`) | **Nunca** (é obrigação futura, não dinheiro movido). |
| **Pagamento** | `transactions` (`kind = debt_payment`, `status = paid`, `debt_id`) | **Sim**: baixa o saldo e é despesa realizada. |
| Pago / restante / progresso / "quitada" | **derivados** (view `v_debt_summary`) | — (nada disso é gravado). |

### A decisão A × B (parcela como Transaction × entidade `DebtInstallment`)

Nenhuma das duas, na forma pura. Foi adotada uma **B enxuta**: a parcela existe, mas **não é tabela nem transação**.

- **Por que não A (parcela = Transaction planejada):** não resolve pagamento parcial (800 pagos 500 → quem fica com os 300?), pagamento adiantado, quitação com desconto nem dívida sem parcelas (pagamentos livres): seria preciso criar transações ad hoc de qualquer jeito, ficando com dois tipos de linha para o mesmo conceito, e mudar o total exigiria reescrever linhas.
- **Por que não B pura (`debt_installments` + pagamento ligado):** o cronograma é totalmente determinístico a partir de `total`, `nº de parcelas` e `1º vencimento` (`split_cents` + datas). Gravá-lo duplicaria a fonte de verdade e exigiria sincronizar a tabela a cada edição.
- **O que fica:** o contrato guarda só o necessário; as parcelas são calculadas; os **pagamentos cobrem as parcelas em ordem** (cascata), então pagar 500 de uma parcela de 800 deixa 300 em aberto e pagar adiantado cobre as seguintes — sem vincular pagamento a parcela e sem nenhum total gravado.

## Semântica financeira

- **Criar uma dívida não move saldo.** (Se o dinheiro do empréstimo entrou na conta, registre uma receita à parte.)
- **Pagamento de dívida é saída real:** reduz o saldo da conta escolhida e **entra em "Despesas realizadas"**, com classificação própria ("Dívidas", ou a categoria da dívida) para não parecer uma compra nova. `debt_payment` passou a ser `isExpenseLike`.
- **Sem dupla contagem:** o contrato e as parcelas nunca somam; só o pagamento (uma transação) entra em despesas, e o gráfico por categoria continua batendo com "Despesas realizadas".
- **"Quitada" é derivada** (restante = 0 ou quitação antecipada): não há botão que marque quitada sem pagar. Status gravados: `active`, `paused`, `canceled` (só sem pagamentos).
- **Juros:** só exibição — custo financeiro = total − original (e % aproximado). Sem motor de juros.

## Parcelas e datas

`split_cents(total, N)`: R$ 10.300 em 13x → 10 × 792,31 + 3 × 792,30 (soma exata). Vencimento da parcela n = 1º vencimento + (n−1) meses, dia limitado ao mês (31/01 → 28/02 → 31/03). Dívida sem parcelas: pagamentos livres até zerar. Pagar **nunca** passa do saldo devido (RPC + trigger deferido `debt_overpaid`).

## RPCs (atômicas, `SECURITY INVOKER`, sem `DELETE`)

| RPC | O que faz |
|---|---|
| `create_debt` | cria o contrato |
| `update_debt` | descritivos sempre; valores/cronograma só se não quitada e **nunca abaixo do já pago**; o histórico de pagamentos não muda |
| `pay_debt` | dívida travada (`FOR UPDATE`) + valida o restante + cria a transação paga — **ou nada** |
| `settle_debt` | **quitação antecipada**: registra o valor **efetivamente pago** (se > 0) e encerra, guardando `settled_at` e o desconto (saldo projetado − pago); nunca aceita pagar mais que o projetado |
| `reopen_debt` | desfaz a quitação (o desconto volta a ser saldo devido) |
| `set_debt_status` | `active` ↔ `paused`; `canceled` só sem pagamentos |

Proteções no banco: `transactions.debt_id` só em `debt_payment` pago (CHECK); pagamento de dívida **não é editável** pelo fluxo genérico (`use_debt_flow`); excluir um pagamento reabre o saldo, exceto de dívida **quitada** (`debt_settled_locked`; a exclusão em cascata do household é permitida). Clientes não excluem dívidas (sem DELETE).

## Dashboard e "Disponível de verdade"

```
disponível = saldo em contas
           − contas a pagar pendentes/atrasadas até o mês
           − despesas previstas do mês
           − faturas em aberto com vencimento ≤ mês
           − PARCELAS EM ABERTO de dívidas ATIVAS com vencimento ≤ mês   (derivadas; inclui atrasadas)
           − dinheiro reservado
```

Pagar uma parcela baixa o saldo **e** a obrigação em aberto na mesma medida → o disponível **não muda** (teste explícito). Pagar **além** do que vence até o mês adianta parcela futura (que ainda não conta): o disponível cai exatamente nesse excedente. Dívida pausada/cancelada/quitada não entra. Dívida sem parcelas não tem obrigação datada: não entra no disponível (aparece na tela de Dívidas).

## Modo local

`LocalDebtCommands` aplica as mesmas regras e mensagens; `deriveDebtViews` é o espelho das views. A demonstração traz um empréstimo (R$ 10.300 em 13x, 4 pagas). Os testes de paridade comparam local × Supabase real.
