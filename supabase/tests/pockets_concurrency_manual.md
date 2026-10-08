# Concorrência dos cofrinhos — roteiro de teste com DUAS sessões reais

Rodar **depois** das migrations 1 e 2 (os testes via RPC pública dependem da migration 3). Precisa de dados **commitados**, então usa o
usuário descartável e o `cleanup` que apaga só o household dele (mesma prática dos E2E).

## A. Prova de que a trava serializa (duas conexões, `pg_sleep`)

Fixture (uma vez, commitada): household do usuário descartável com a conta **A** (saldo 100000), o cofrinho **P** em A e o perfil.

**Sessão 1** (segura a trava por 8 s e desfaz):
```sql
do $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub','<uid>','role','authenticated')::text, true);
  set local role authenticated;
  perform private.pocket_write('<P>', 'reserve', 60000, current_date);   -- trava a conta A (FOR NO KEY UPDATE)
  perform pg_sleep(8);
  raise exception 'ROLLBACK da sessao 1';
end $$;
```
**Sessão 2** (iniciar ~2 s depois; mede a espera):
```sql
do $$ declare t0 timestamptz := clock_timestamp(); begin
  perform set_config('request.jwt.claims', json_build_object('sub','<uid>','role','authenticated')::text, true);
  set local role authenticated;
  perform public.create_transaction('expense','Concorrente',50000,current_date,'<perfil>','paid','<A>', null, null, '<categoria>');
  raise exception 'sessao 2 esperou % s', extract(epoch from clock_timestamp()-t0);
end $$;
```
Esperado: a sessão 2 **espera ~6 s** (até a sessão 1 terminar) e só então conclui. Repetir trocando a sessão 2 por: `pay_invoice`,
`pay_debt`, `settle_debt`, transferência A→B (`create_transaction('transfer', …, A, B)`), `update` de receita paga, `update accounts set
initial_balance_cents = …`, e `pocket_write(reserve)` em **outro** cofrinho da conta A. Todas devem esperar. Uma escrita **não paga**
(despesa `planned`) **não** espera.

Com a sessão 1 **commitando** (trocar o `raise exception` por `commit` implícito, ou rodar via `select`), a sessão 2 que
passaria do livre deve falhar com `reserve_shortfall` (a conferência no COMMIT enxerga o que a sessão 1 gravou).

## B. Rodadas concorrentes via API (Vitest, depois da migration 3)

`tests/pockets-concurrency.supabase.test.ts` (a escrever na fase 3), usuário descartável, **duas sessões** do mesmo usuário
(`createClient` x2), `Promise.all` com largada sincronizada, 10 rodadas por cenário, cada rodada com saldo/folga recriados:

| # | Sessão X | Sessão Y | Esperado |
|---|---|---|---|
| 1 | reservar 60 | reservar 60 (folga 100) | exatamente 1 conclui; a outra `insufficient_free` ou `reserve_shortfall` |
| 2 | reservar 60 | despesa paga 60 na mesma conta | exatamente 1 conclui |
| 3 | reservar 60 | `pay_invoice` 60 da conta | exatamente 1 conclui |
| 4 | reservar 60 | `pay_debt` 60 da conta | exatamente 1 conclui |
| 5 | reservar 60 | excluir/reduzir receita paga de 60 | exatamente 1 conclui |
| 6 | reservar 60 | reduzir saldo inicial em 60 | exatamente 1 conclui |
| 7 | transferência A→B (60) | reservar 60 em A | exatamente 1 conclui |
| 8 | transferência A→B | transferência B→A | **ambas** concluem, sem deadlock |
| 9 | retirar 60 do cofrinho (saldo 100) | retirar 60 | exatamente 1 conclui |
| 10 | estornar `use` | retirar o valor estornado | ambas ordens possíveis; invariante preservado |
| 11 | transferir cofrinhos P1→P2 | transferir P2→P1 (mesma conta) | ambas concluem, sem deadlock |

Invariante verificado ao fim de **toda** rodada: `saldo(conta) >= reservado(conta)` (contas com reserva) e nenhum cofrinho negativo;
nenhum `40P01` (deadlock) no cenário 8 e 11.

## C. Ordem de locks (revisada)

`linhas já travadas pelos fluxos existentes (debts, card_invoices, recurring)` → `linha da transação (UPDATE/DELETE)` → `accounts (ordem de
id)` → `pockets (ordem de id)`. Consequência para a migration 3: `reverse_pocket_use` precisa travar a **linha da transação primeiro**
(`select … for update`) e só depois chamar `private.pocket_write`; `spend_from_pocket` cria a despesa (trava a conta no trigger) e depois o
`use`.
