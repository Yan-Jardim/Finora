# Contas do mês

A lista que antes ficava no WhatsApp: tudo o que vence no mês, "Pago" com um toque e o total pendente. Tela `/contas-do-mes`, lógica pura em `domain/bills.ts`. **Sem tabela nem migration nova.**

## De onde vem a lista

`buildMonthBills` reaproveita `collectEvents` do Calendário (cada obrigação por uma única porta):

- **A pagar:** toda saída de caixa em aberto do mês (despesa pendente/prevista, ocorrência de recorrência, fatura em aberto, parcela de dívida ativa) e, do mês atual em diante, as atrasadas de meses anteriores. Compra no cartão não entra (entra pela fatura).
- **Pagas:** só o que é conta — despesa com vencimento ou recorrente, pagamento de fatura e de dívida. Gasto do dia a dia (sem vencimento) não polui a lista.
- **Pago:** despesa → `commands.setStatus(tx, "paid")` (desfazer volta para `pending`); fatura e parcela abrem os diálogos de Cartões/Dívidas.

## Colar lista

`parseBillList` lê o texto como vocês escrevem: valor antes ou depois do nome, milhar com ponto ("1.100"), "ok"/"pago"/✅ = já paga, "(5x10)" ou "5/10" = parcela atual/total; linhas sem valor e "Total…" são ignoradas. Cada linha é conferida antes de salvar (pessoa, repete, vencimento, categoria); as que já estão no mês (mesmo nome e valor) vêm desmarcadas.

`planBill`: a conta **deste** mês é sempre uma despesa comum (dá para marcar paga mesmo com vencimento passado). "Todo mês" cria uma recorrência a partir do **mês seguinte** (a regra nunca duplica a conta do mês); "parcela 5/10" cria a recorrência até a parcela 10.
