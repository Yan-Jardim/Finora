# Relatórios financeiros

Página `/relatorios`. Motor puro em `domain/reports.ts` (+ `domain/report-periods.ts`), o mesmo nos modos local e Supabase; CSV em `services/report-csv.ts` / `lib/csv.ts`; telas em `components/reports/`.

## Duas lentes (nunca misturadas)

| | **Fluxo de caixa** | **Despesas de consumo** |
|---|---|---|
| Pergunta | Quanto dinheiro entrou e saiu das contas? | Quanto foi gasto economicamente? |
| Data | pagamento (`paidAt ?? date`) | competência (`date`) |
| Compra no cartão | não sai da conta na compra | consumo na data da compra (cada parcela na sua data) |
| Pagamento de fatura | **saída de caixa** | **não** é despesa |
| Pagamento de dívida | **saída de caixa** | **fora** do consumo (seção "Pagamentos de dívidas") |
| Transferência/investimento/resgate | neutro no consolidado | não entra |
| Reserva/retirada de cofrinho | não move caixa | não entra |
| Uso de reserva | a despesa criada (1×) | a despesa criada (1×) |
| Estorno do uso | despesa cancelada: sai de tudo | idem |

## Métricas (Visão geral)
- **Total recebido** = receitas pagas no período (competência).
- **Despesas de consumo** = despesas pagas em conta + compras no cartão já feitas.
- **Saídas de caixa** = despesas pagas + faturas pagas + dívidas pagas (data do pagamento). **Entradas de caixa** = receitas pagas (data do pagamento).
- **Pagamentos de dívidas** = `debt_payment` pagos no período.
- **Resultado do período** = Total recebido − Despesas de consumo − Pagamentos de dívidas. **Taxa de economia** = Resultado ÷ Total recebido (sem receita: "—").
- **Resultado de caixa** = Entradas − Saídas de caixa.
- Fotografias de **hoje**: **Saldo atual** (contas ativas, sem investimentos), **Patrimônio financeiro** (contas + investimentos das contas ativas incluídas no patrimônio), **Total reservado** (soma dos cofrinhos; já está dentro do saldo), **Dívidas restantes** (ativas e pausadas).

## Patrimônio
- Ativos: contas ativas com "incluir no patrimônio" (correntes, digitais, poupança, carteira, dinheiro e investimentos).
- Passivo considerado: saldo devido das dívidas ativas/pausadas. **Patrimônio líquido = patrimônio financeiro − dívidas restantes.**
- Faturas de cartão em aberto são exibidas à parte e **não** deduzidas.
- Cofrinhos **não** aumentam o patrimônio (divisão virtual do mesmo dinheiro).
- Evolução: saldo de cada fim de mês = saldo de hoje − movimentações pagas depois dessa data (só olha o que foi carregado para o período em diante). O passivo não é reconstruído mês a mês.

## Pessoa, Casal e consolidado
Cada movimentação pertence a **um** perfil. "Casal" é um perfil compartilhado; "Consolidado" é o household inteiro = soma dos perfis (testado). A divisão percentual de despesas do casal (`split`) não é usada.

## Filtros
Período (mês/trimestre/ano/intervalo), pessoa/Casal, conta, cartão, categoria (raiz ou sub), tipo de movimentação e situação (realizadas / em aberto / previstas). Compra no cartão pertence à conta que paga a fatura do cartão quando se filtra por conta. Canceladas nunca entram.

## Comparação
Período anterior do mesmo tamanho: meses inteiros recuam o mesmo número de meses (Jan–Jun/2027 → Jul–Dez/2026); intervalos quebrados recuam o mesmo número de dias. Variação: período anterior zero → sem percentual ("anterior zerado"). Também há comparação com um intervalo livre.

## Consultas
Nenhuma migration/RPC/view nova. A tela declara a janela com `useTransactionWindow({ from, to, paidBetween: true })` (novo, sem migration): traz o que tem competência no período **ou foi pago** nele (conta de setembro paga em outubro). `to` vai até 12 meses à frente de hoje (próximas parcelas). Saldos, faturas, dívidas e reservas vêm do snapshot (views); o histórico de cofrinhos vem de `repos.pockets.movements`. Limite de 5.000 itens por janela: se estourar, a tela avisa que os totais podem estar incompletos.

## Limitações
- **Principal × juros** de dívida não é decomposto: pagamento de dívida é só caixa (e seção própria). "Custo financeiro" = total contratado − valor original, sem taxa efetiva.
- Série histórica de patrimônio cobre ativos; passivos só "hoje".
- Pagamentos feitos com data futura (raro) não são reconstruídos na série histórica do patrimônio.
- Dashboard usa a regra antiga (pagamento de dívida dentro de "Despesas"); o relatório separa. Consumo + pagamentos de dívida = "Despesas" do dashboard (conferido no E2E).
- Sem PDF; CSV: movimentações, receitas, despesas de consumo, fluxo de caixa (movimentações e mensal), com os filtros ativos, separador `;`, vírgula decimal, BOM UTF-8 e proteção contra fórmula (`=`, `+`, `-`, `@`).
