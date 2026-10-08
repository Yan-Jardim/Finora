# Regras financeiras e invariantes (fonte única)

Cada regra abaixo é imposta **no banco** (constraints, triggers, RPCs) **e** no motor local, e conferida por testes: `tests/invariants.test.ts` (invariantes nomeadas + sequências aleatórias com semente fixa), `tests/available.test.ts`, `tests/reports.test.ts`, `tests/seeds.test.ts`, `tests/parity*.supabase.test.ts` (mesmo roteiro no Supabase real) e `supabase/tests/*.sql`.

## Modelo
- Dinheiro em **centavos inteiros**. Datas ISO; "hoje" = fuso do household.
- `Transaction` é a **única** fonte de valores. Tipos: `income`, `expense`, `credit_card_purchase`, `transfer`, `card_payment`, `debt_payment`, `investment`, `redemption`.
- **Nunca somam**: `InstallmentPurchase` (agrupador), `RecurringTransaction` (template), `Debt` (contrato), parcelas de dívida (obrigação derivada), `Pocket`, `Goal`.

## Invariantes
| # | Invariante | Onde é garantida |
|---|---|---|
| 1 | **Conta**: saldo = saldo inicial + efeito das transações **pagas** (pendente, prevista e cancelada não mexem) | views `v_account_balances` / `accountBalance` |
| 2 | **Cartão**: compra não reduz a conta; pagar a fatura reduz a conta; o pagamento **não cria despesa** | `balanceDelta`, `card_payment` fora de `isExpenseLike`, RPC `pay_invoice` |
| 3 | **Fatura**: pago ≤ total; em aberto = total − pago; fatura paga é imutável | triggers `check_invoice_not_overpaid`, `guard_paid_invoice` |
| 4 | **Parcelamento**: soma das parcelas = valor original (sobra de centavos na 1ª); o agrupador não soma | `split_cents`, `buildInstallments` |
| 5 | **Recorrência**: o template não entra em somas; a ocorrência não duplica (`recurring_id` + `occurrence_date` único); sincronizar é idempotente | constraint única, `sync_recurring` |
| 6 | **Dívida**: o contrato não altera saldo; o pagamento altera saldo **uma** vez; pago ≤ total | `transactions_debt_payment_only` (pagamento de dívida é sempre pago), `check_debt_not_overpaid`, `guard_debt_payment` |
| 7 | **Transferência/investimento/resgate**: contas distintas; não altera patrimônio consolidado nem receita/consumo | `transactions_kind_shape` (conta de origem ≠ destino) |
| 8 | **Cofrinho**: não guarda saldo (derivado do histórico imutável); saldo ≥ 0; **lastro** — com reserva na conta, saldo ≥ reservado; só contas de consumo ativas; arquivar exige saldo 0 | `check_pocket_nonneg`, `z_reserve_backing` (triggers deferidos), `reserve-guard` no local |
| 9 | **Uso da reserva**: cria UMA despesa paga + um movimento `use` (atômico, `spend_from_pocket`); a despesa não se exclui nem muda valor/data/status/conta (só estorno); estorno cancela a despesa e devolve só o que o uso tirou | `guard_pocket_use`, `check_use_consistency_*` |
| 10 | **Objetivo**: ligado a cofrinho ⇒ progresso = saldo real (manual = 0, **não restaurado** ao desligar); manual nunca é dinheiro reservado, nem entra em disponível ou patrimônio; um cofrinho por objetivo | `goals_manual_xor_pocket`, `link_goal_pocket` |
| 11 | **Relatórios**: consumo e caixa são lentes separadas (ver [REPORTS.md](./REPORTS.md)); soma das categorias = total de consumo; soma dos perfis = consolidado | `domain/reports.ts` |
| 12 | **Multi-tenancy**: nada cruza households (RLS + FKs compostas) | RLS, `prevent_tenant_change` |

## "Disponível de verdade"
```
disponível = saldo das contas (ativas, incluídas no patrimônio, SEM investimentos)
           − contas restantes   despesas pendentes/atrasadas com data ≤ mês exibido
                                + despesas previstas DO mês   (compra no cartão NÃO entra aqui)
           − faturas em aberto  com vencimento ≤ mês exibido  (a compra no cartão é descontada AQUI, uma vez)
           − dívidas            parcelas em aberto de dívidas ativas com vencimento ≤ mês
                                + contas de dívida soltas pendentes (legado)
           − reservado          soma dos cofrinhos das contas (já está dentro do saldo)
```
Cada obrigação é descontada **uma vez**. Pagar uma obrigação reduz o saldo e a obrigação na mesma medida, então **o disponível não muda no pagamento** (conta pendente, fatura — parcial ou total —, parcela de dívida). Reservar reduz o disponível sem mexer no saldo; **usar a reserva** reduz saldo e reservado na mesma medida (uso total: disponível igual; uso parcial: cai só a parte que não veio da reserva); estorno restaura. Transferência entre contas de consumo não muda; aporte em investimento reduz (o dinheiro deixa de ser gastável). Todos esses casos têm teste em `tests/available.test.ts`.

Escopo: filtro por pessoa/Casal usa o dono da **movimentação** para obrigações e o dono da **conta** para saldo e reservado.

Dívida e contas soltas: um `debt_payment` **ligado a uma dívida** nunca é pendente (a constraint `transactions_debt_payment_only` exige `paid`), então uma parcela não é descontada duas vezes (como parcela em aberto e como conta solta). Só `debt_payment` pendente **sem** dívida (legado) entra como conta solta.

## Dashboard × Relatórios
O Dashboard mantém a regra antiga em que o pagamento de dívida entra em "Despesas realizadas" (com a categoria própria "Dívidas"). O Relatório separa: **consumo + pagamentos de dívida = "Despesas" do dashboard** (conferido em teste e no E2E). A decomposição principal × juros é melhoria futura ([FUTURE_IMPROVEMENTS.md](./FUTURE_IMPROVEMENTS.md)).
