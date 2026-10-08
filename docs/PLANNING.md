# Planejamento financeiro

Projeção de **fluxo de caixa** dos próximos 12 meses, derivada dos dados existentes. Nada é gravado (nem totais, nem a simulação).

## 1. Revisão das regras de dívida (recomendação — NÃO aplicada)

O planejamento é fluxo de caixa: pergunta "quanto dinheiro entra e sai da conta?". Nesse olhar, o que importa é o que **sai da conta**, e o motor atual já está correto:

| Evento | Entra no fluxo de caixa? | Entra em "Despesas realizadas" hoje? |
|---|---|---|
| Dinheiro **recebido** do empréstimo | Sim, como entrada — **se** o usuário o registrar como receita (a dívida não gera receita sozinha) | Não |
| **Parcela/pagamento** da dívida (principal + custo) | Sim, saída inteira | **Sim** (decisão da fase de Dívidas) |
| **Compra financiada** (paga com o dinheiro do empréstimo) | Sim, saída na compra | Sim |

**O risco real de dupla contagem fica nos indicadores de DESPESA (competência), não no caixa:** se o usuário registra a compra financiada como despesa **e** depois os pagamentos do empréstimo também contam como despesa, o mesmo gasto aparece duas vezes em "Despesas realizadas" e no gráfico por categoria (o principal pago é só devolução do dinheiro que já foi gasto na compra).

**Modelagem recomendada (para sua aprovação; nenhuma regra foi mudada nesta fase):**

1. Cada pagamento de dívida se divide, de forma **derivada** (nada gravado), em **amortização do principal** e **custo financeiro**, na proporção `custo = pagamento × (total − original) / total` (a mesma aproximação já exibida em "Custo financeiro").
2. **Despesa realizada** passa a contar só a parcela de **custo financeiro** (juros/encargos); a amortização é redução de passivo, não despesa. A compra financiada continua sendo despesa uma única vez, no momento da compra.
3. **Fluxo de caixa (saldo, Planejamento, Disponível de verdade) não muda**: o pagamento inteiro sai da conta.
4. Exibir, na tela de Dívidas e no detalhe do mês, "principal × custo" (informativo).

Isso altera o que "Despesas realizadas" e o gráfico por categoria mostram para pagamentos de dívida (hoje: valor inteiro), por isso **ficou como proposta**. O Planejamento não depende dessa decisão: ele trabalha só com caixa.

## 2. Fórmula

```
saldo inicial(M)  = saldo final(M−1)        (1º mês: saldo ATUAL das contas, sem investimentos — views do banco)
entradas(M)       = receitas em aberto (previstas/pendentes) com vencimento em M
saídas(M)         = contas/despesas em aberto
                  + faturas de cartão em aberto (vencimento da fatura em M)
                  + parcelas em aberto de dívidas ATIVAS (vencimento em M)
                  + transferências que saem do "saldo em contas" (ex.: aporte em investimento)
saldo final(M)    = saldo inicial(M) + entradas(M) − saídas(M)
```

- **Atrasados** (vencimento < hoje, ainda em aberto) caem no **mês atual**, marcados como atrasados.
- Previstos **nunca** viram saldo de hoje: o saldo inicial é o saldo real.
- Pagas, canceladas e o que passa de 12 meses ficam de fora.

## 3. Cartões

Compra no cartão (à vista, parcelada ou recorrente) **nunca** entra como saída pela data da compra. O dinheiro só sai quando a **fatura** é paga, então entra pelo **valor em aberto da fatura** (`v_card_invoice_totals.open_cents`: compras − pagamentos), no vencimento dela. As faturas futuras já contêm as parcelas e as recorrências no cartão. No detalhe do mês, cada fatura lista as compras que a compõem.

## 4. Dívidas

Só as **parcelas em aberto** (derivadas, `v_debt_installments`) de dívidas **ativas** entram. Contrato, pagas, pausadas, quitadas e canceladas não. Dívida **sem parcelas** não tem vencimento: não é projetada.

## 5. Recorrências

Entram pelas **ocorrências já materializadas** (transações previstas/pendentes). Nada é inventado: o horizonte de materialização é 12 meses (último mês projetado = mês atual + 11). Receita recorrente aparece em "Receitas", despesa recorrente em "Despesas recorrentes" (e a compra recorrente no cartão, pela fatura).

## 6. Dupla contagem — como é evitada

Cada obrigação entra por **uma única porta**: despesa/receita pela transação; compra no cartão **só** pela fatura; dívida **só** pela parcela derivada; pago **só** no saldo. Testes cobrem cada caso (compra no cartão × fatura, pagamento parcial de fatura mantém o resultado final, pagamento de dívida sai da projeção e do saldo, pagas/canceladas ignoradas).

## 7. Perfis

Mesma regra do dashboard: cada item tem **um** dono (conta e cartão pelo `owner`, transação e dívida pelo responsável), então Todos = soma das partes, sem duplicar o que é compartilhado. Limitação herdada: a despesa do Casal paga numa conta da Yan reduz o saldo da Yan (saldo é fato da conta) mas aparece na projeção do Casal.

## 8. Arquitetura

- `domain/planning.ts` (puro): `buildPlanning`, `planningAlerts`, `compareSimulation`. Sem I/O, mesmo código no modo local e no Supabase.
- Dados: snapshot (saldos, faturas, parcelas de dívida — views) + movimentações **em aberto** carregadas por uma consulta própria (`TransactionWindow.openOnly`): itens previstos/pendentes até o fim do horizonte, mais compras no cartão dos últimos 2 meses só para detalhar faturas. Nunca o histórico.
- Alertas são estruturados e o texto é composto com os números reais (`lib/planning-messages.ts`).
- Simulador: roda no navegador sobre a projeção; nenhuma escrita.

> **Cofrinhos:** o Planejamento parte do saldo REAL das contas; o dinheiro reservado aparece só como informação (reservado hoje, livre hoje e livre no fim do período "se a reserva não mudar") e não altera a projeção.

> A melhoria sugerida na seção 1 (separar consumo × amortização × juros) está registrada em [FUTURE_IMPROVEMENTS.md](./FUTURE_IMPROVEMENTS.md) e **não** foi aplicada.
