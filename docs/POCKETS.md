# Cofrinhos e objetivos (como está implementado)

> Histórico do desenho e das revisões: [POCKETS_PROPOSAL.md](./POCKETS_PROPOSAL.md). Este documento descreve o **estado atual**.

## Conceitos
- **Conta**: onde o dinheiro está de verdade (o saldo bancário).
- **Cofrinho**: separação **virtual** dentro de UMA conta de consumo ativa (a conta não muda depois de criado). Não cria dinheiro, não é despesa, **não aumenta patrimônio** e **não guarda saldo**.
- **Objetivo**: meta com valor e prazo. Ligado a um cofrinho, o progresso é o saldo real dele; sem cofrinho, é um valor **informado à mão** (nunca é dinheiro reservado).

## Modelo (sem saldo gravado)
- `pockets` (cadastro) e `pocket_movements` (histórico **imutável**: `reserve`, `withdraw`, `transfer_in`, `transfer_out`, `use`, `use_reversal`). Ninguém escreve em `pocket_movements` pela API: só funções internas chamadas pelas RPCs.
- Saldo do cofrinho = soma com sinal do histórico (`v_pocket_balances`; local: `domain/pockets.ts`). Reservado da conta = soma dos cofrinhos (`v_account_reserves`). Livre = saldo − reservado.
- **Lastro**: com reserva, saldo ≥ reservado. Qualquer operação que violaria (despesa, transferência, pagamento, reduzir saldo inicial, desativar a conta…) é recusada com `reserve_shortfall` e o valor que falta; **nada é alterado automaticamente**.

## Operações (todas RPC atômica; o modo local espelha regra, ordem e mensagens)
| Operação | Efeito |
|---|---|
| Criar (`create_pocket`) | cofrinho + reserva inicial opcional (respeita o livre); `legacy_ref` torna a importação idempotente |
| Reservar / Retirar | só alocação virtual: saldo da conta e despesas **não** mudam; mexe no livre |
| Transferir | entre cofrinhos da **mesma** conta; saldo e reservado total não mudam |
| Gastar (`spend_from_pocket`) | uma despesa paga na conta do cofrinho + `use` (total ou **parcial**); saldo cai pela despesa inteira, reservado só pela parte usada |
| Estornar (`reverse_pocket_use`) | cancela a despesa (saldo volta inteiro), devolve ao cofrinho só o que o uso tirou; histórico preservado |
| Arquivar / Reativar | arquivar exige saldo 0; reativar exige conta ativa |
| Vincular objetivo (`link_goal_pocket`) | zera o valor manual (**não restaurado** ao desvincular); um cofrinho por objetivo |

A despesa criada pelo uso não pode ser excluída nem ter valor/data/status/conta alterados (só **Estornar**); descrição, categoria, tags e notas seguem editáveis.

## Telas
`/cofrinhos` (cards, reservar/retirar/transferir com resumo antes de confirmar, histórico, arquivar, aviso de importação) · `/objetivos` (manual × vinculado, prazo, aviso ao vincular) · despesa com "Usar dinheiro de um cofrinho" · Dashboard (cartão "Cofrinhos e objetivos") · Planejamento e Relatórios (reservado como informação).

## Cofrinhos da versão antiga
Formato antigo `{ id, name, accountId, amountCents }` em `finora:v1:pockets` (local) ou `finora:v1:sb:<household>:pockets`. A importação é **ação explícita** ("Importar cofrinhos"), idempotente (`legacy:<id>`), respeita o lastro (se o valor não cabe, o cofrinho nasce vazio e o resultado avisa) e **nunca apaga a chave antiga**.

## Divergências local × Supabase (todas classificadas em [RELEASE_CANDIDATE.md](./RELEASE_CANDIDATE.md))
`WorkspaceData.pocketMovements` no Supabase traz só `use`/`use_reversal` (para marcar despesas); o histórico completo vem de `repos.pockets.movements` sob demanda.
