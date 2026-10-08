# Estabilidade da suíte de paridade (investigação)

## Sintoma
Na primeira execução completa do Vitest logo depois de um E2E Supabase, dois arquivos de paridade falharam no `beforeAll` (login + limpeza + `bootstrap_household`). As execuções seguintes passaram (25/25, 331/331).

## Hipóteses testadas

| Hipótese | Como foi testada | Resultado |
|---|---|---|
| Estado compartilhado / concorrência entre arquivos | `vitest.config.mts` já tem `fileParallelism: false`; os arquivos de paridade rodam em série e cada um cria e remove o próprio household | **Descartada** |
| Limpeza incompleta do E2E deixa um household grande que o `beforeAll` precisa apagar (cascata lenta → timeout de 10 s do hook) | Rodei o E2E Supabase completo e medi a remoção do household que ele deixa (18 movimentações, 2 contas, 2 cofrinhos, 12 movimentos de cofrinho, 1 dívida) | **Descartada**: a cascata levou **201 ms** |
| Lentidão/erro do banco | Logs da API do projeto (`edge_logs`) nas últimas horas: nenhum status ≥ 500; só 400 de regras recusadas de propósito pelos testes; tempos de origem de 10–100 ms | **Descartada** |
| Falha transitória **antes** de chegar ao projeto | Em duas execuções posteriores o Vitest recebeu uma página HTML `502 Bad Gateway` (Cloudflare) e, no E2E, o navegador registrou `CORS ... blocked` + `ERR_FAILED` num GET de `v_card_invoice_totals` — exatamente o que o navegador vê quando o gateway devolve um 502 sem cabeçalhos CORS. Nenhum desses pedidos aparece no log do projeto | **Causa mais provável** |

## Causa
Erros 502/504 esporádicos do gateway (Cloudflare) à frente do Supabase: o pedido não chega ao projeto (por isso não há log) e o `beforeAll` — que faz login, uma leitura, uma remoção e o bootstrap — quebra na primeira chamada que cai nessa janela. É infraestrutura, não estado dos testes. (Não consegui reproduzir a falha original sob demanda; a evidência é a ocorrência posterior do mesmo tipo de erro e a eliminação das outras hipóteses.)

## O que mudou (sem "só aumentar o timeout")
1. **`lib/supabase/resilient-fetch.ts`**: `fetch` que repete (2 vezes no app, 4 no harness, com espera exponencial) **somente** o que é seguro repetir — leituras (GET/HEAD) e o login (`POST /auth/v1/token`) — diante de 502/503/504 ou queda de conexão. **Escritas nunca são repetidas** (RPC, PATCH, DELETE, POST em geral): se a primeira tentativa tivesse chegado ao banco, repetir duplicaria a operação. Testes em `tests/resilient-fetch.test.ts`.
2. Usado no **cliente do navegador** (`lib/supabase/client.ts`) — o app também deixa de mostrar "sem conexão" por um 502 isolado numa leitura — e no **harness de paridade**.
3. `hookTimeout: 60_000` no Vitest: o `beforeAll` agora pode incluir essas repetições (o padrão de 10 s não comporta o backoff). Foi um ajuste *consequente* à repetição, não o conserto em si.

## Limitações conhecidas
- Uma escrita que cair exatamente numa falha transitória ainda falha (por desenho). A suíte de paridade tem poucas dessas janelas; se uma escrita falhar por 502, o teste falha de forma explícita em vez de duplicar dados.
- Uma leitura que esgote as tentativas continua falhando (e o E2E a reporta como INCONCLUSIVO, ver abaixo): nunca é tratada como sucesso.

## Revisão do `resilient-fetch` (release candidate)
Conferido em código e por teste (`tests/resilient-fetch.test.ts`, 7 casos):
- **Só GET/HEAD e `POST /auth/v1/token` (login)** são repetidos. RPC, PATCH, DELETE, PUT e qualquer outro POST (inclusive outros endpoints de auth) **nunca**.
- **Backoff limitado**: no máximo `retries + 1` tentativas (app: 3; harness: 5) com espera exponencial `400 ms · 2ⁿ` — sem laço infinito (o contador sempre avança e o último resultado é devolvido).
- **4xx e respostas normais não são repetidos**; só 502/503/504 e erro de rede (`TypeError`).
- **Cancelamento** (`AbortSignal`) não é repetido, nem durante a espera do backoff, e o `AbortError` é propagado.
- **Falha que esgota as tentativas não vira sucesso**: devolve a última resposta de erro (ou relança o erro), e o teste falha de forma explícita.

## E2E: "falha transitória recuperada" × "não consegui validar"
O navegador loga como erro cada tentativa de leitura que falhou por rede (o gateway devolve 502 sem CORS). O runner (`e2e/run.mjs`) agora:
1. registra cada leitura ao Supabase que falhou por rede (`requestfailed`, só GET/HEAD);
2. marca como **recuperada** só se a **mesma URL** for respondida com sucesso depois (aparece como "Falhas transitórias de rede RECUPERADAS: n");
3. qualquer leitura **não recuperada** reprova a execução como **INCONCLUSIVO — não consegui validar o resultado**;
4. um log de rede sem nenhuma falha de leitura correspondente continua sendo **erro**; 4xx/5xx de regra e exceções de página também seguem reprovando. Nada é rebaixado a "aviso" sem prova de recuperação.
