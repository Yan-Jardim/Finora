# Calendário financeiro

Visão por data dos compromissos (Mensal, Semanal, Lista), **derivada** dos dados existentes. Só leitura: nada é gravado e não há tabela nem migration nova. Pagar e editar continuam em Movimentações, Cartões e Dívidas (o detalhe do evento só tem um link).

## 1. Como os eventos são obtidos

`domain/calendar.ts` (puro, igual nos modos local e Supabase) junta três fontes, cada obrigação por **uma única porta**:

| Evento | Fonte | Observação |
|---|---|---|
| Receita, despesa, transferência, recorrência, parcelamento, pagamento realizado | Movimentações | recorrência = ocorrência **já materializada** (nada é inventado) |
| Compra no cartão | Movimentações | só **informativa** (aparece na data da compra, "entra na fatura"); não é saída de caixa nem "pendente" |
| Fatura | `snapshot.invoices` (view) | evento = valor **em aberto**, no vencimento; fatura paga **não** vira evento (aparece o pagamento, que não é despesa) |
| Parcela de dívida | `snapshot.debtInstallments` (view) | só parcelas em aberto de dívidas **ativas**; o pago aparece como pagamento realizado |

Consulta ao banco (`services/calendar-window.ts` → `TransactionWindow.openOnly.withWindow`): tudo (qualquer status) do mês visto, mais os itens **em aberto** até o fim do mês visto ou do próximo mês (o que for mais distante). Na semana que atravessa meses, a janela cobre a semana inteira. Nunca o histórico.

## 2. Regras de cálculo

- **Status:** `paid` (pago/recebido/realizado), `pending`, `planned` (previsto), `overdue`. Cancelados não aparecem. Fatura ainda aberta (antes do fechamento) é *prevista*; fechada é *pendente*; vencida é *atrasada*.
- **Atrasado mantém a data original** (diferente do Planejamento, que o leva para hoje). Os de meses anteriores aparecem em "Atrasados de meses anteriores" e entram em "Compromissos pendentes" do mês atual em diante.
- **Hoje** vem do fuso da família (`useWorkspace().today`); nada usa o relógio do navegador.
- **Receitas do mês:** recebidas (e, na dica, a receber). **Despesas realizadas:** o motor existente (`isRealizedExpense`: despesa/dívida paga, compra no cartão na data da compra; pagamento de fatura nunca). **Pendentes:** pendentes + atrasados de saída de caixa. **Total previsto:** pendentes + previstos. **Faturas a vencer:** faturas em aberto do mês. **Saldo projetado:** o do Planejamento no fim do mês (mês atual até +11); "—" em mês passado, além de 12 meses ou com filtros de conta/cartão/categoria/tipo/status.
- O que está pago não é descontado de novo: pendentes/previstos olham só o que está em aberto.
- Valores do mesmo dia são somados (receitas, saídas de caixa e compras no cartão em separado).

## 3. Filtros

Pessoa (inclui Casal), conta, cartão, categoria, tipo (receitas, despesas, transferências, faturas, dívidas, recorrentes, parcelamentos) e status, combinados com **E**. Cada evento tem **um** dono, então "Todos" = soma das partes e uma despesa do Casal nunca conta duas vezes. Itens sem conta (fatura, parcela de dívida, compra no cartão) saem ao filtrar por conta; sem cartão/categoria saem ao filtrar por cartão/categoria.

## 4. Interface

- Cores: verde = receita, vermelho = despesa/dívida, roxo (cor primária) = cartão/transferência, amarelo = pendente, cinza = previsto. **Status sempre em texto + ícone** (Pago/Recebido, Pendente, Previsto, Atrasado), nunca só cor.
- Mensal: célula com valores no desktop e **marcadores** no celular; clicar no dia abre os compromissos do dia; clicar no evento abre o detalhe. Semanal e Lista seguem o mesmo componente de evento.
- "Próximos vencimentos": atrasados primeiro (data original), depois os próximos.

## 5. Limitações

- "Próximos vencimentos" e os atrasados olham até o fim do próximo mês (ou do mês visto), não 12 meses.
- Em mês passado, atrasados de meses anteriores não são mostrados (não faz sentido reconstruir o que estava em atraso naquela época).
- Se houver mais movimentações no período que o limite de carga, um aviso é exibido.
- A separação consumo × amortização × juros continua como melhoria futura (ver `FUTURE_IMPROVEMENTS.md`): `debt_payment` conta inteiro.
