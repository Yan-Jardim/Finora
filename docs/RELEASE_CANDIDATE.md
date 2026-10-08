# Release candidate — auditoria (2026-10-07)

Fase de estabilização: **nenhuma funcionalidade financeira nova** e nenhuma regra financeira alterada. Este documento registra o que foi auditado, o que foi corrigido e o que depende de ação manual.

## Resultado dos portões
| Portão | Resultado |
|---|---|
| ESLint / TypeScript | sem avisos nem erros |
| `next build` (supabase e local) | ok (rotas: `/cofrinhos`, `/objetivos`, `/relatorios` incluídas) |
| Vitest | **34 arquivos / 527 testes** passando (inclui paridade com o Supabase real e segurança no banco real) |
| E2E modo local | **319/319** |
| E2E modo Supabase | **353/353** (logout/login, persistência, relatórios, cofrinhos, auditoria de UX) |
| Advisors de segurança | 2 avisos, ambos conhecidos (abaixo) |
| Advisors de performance | 21 `unused_index` (INFO) — recomendação abaixo, sem DROP |
| `npm audit --omit=dev` | 0 vulnerabilidades |

## Bugs encontrados e corrigidos
1. **Demonstração com estado que o banco recusaria**: duas movimentações de exemplo apontavam para recorrências inexistentes (FK) e uma usava `split`, que o banco não representa. Corrigido e **travado por `tests/seeds.test.ts`** (replica `transactions_kind_shape`, `paid_consistency`, FKs, parcelas, faturas, dívidas, lastro, objetivos).
2. **Contraste** (WCAG AA): `muted-foreground` sobre `muted` no tema claro dava 4,40:1; ajustado (`tests/contrast.test.ts` cobre todos os pares dos dois temas).
3. **Gráficos ilegíveis no celular**: o SVG era reduzido pela escala do `viewBox` (texto ≈ 6 px) nos Relatórios e no Planejamento; agora é desenhado na largura real (E2E falha se o texto do gráfico ficar < 9 px).
4. **Dashboard vazio sem `<h1>`** (leitor de tela): corrigido.
5. **Duplo clique**: não havia trava global; `useAction` agora ignora uma nova operação enquanto outra está em andamento (síncrono, vale para dois cliques no mesmo instante). E2E com dois cliques seguidos em: criar despesa, reservar, retirar, gastar reserva (parcial e total), estornar (e pagar fatura/dívida quando há).
6. **Testes**: falhas esporádicas por 502 do gateway (infra) → `resilient-fetch` (leituras/login apenas); esperas fixas do E2E trocadas por sondagem; o runner distingue *recuperada* de *não consegui validar* ([TEST_STABILITY.md](./TEST_STABILITY.md)).
7. **Endurecimento**: cabeçalhos de segurança básicos (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`), verificados no E2E.

## Segurança (banco real, auditado por consulta)
- **RLS ligado nas 18 tabelas** de negócio; **7 views com `security_invoker`**; sem `FORCE RLS` por desenho: as funções `SECURITY DEFINER` ficam no schema `private` (não exposto), rodam como dono e fazem as próprias checagens de membership.
- **Funções**: 79 em `public`/`private`; **todas** com `search_path` fixo; nenhuma executável por `anon` nem por `PUBLIC`; helpers `SECURITY DEFINER` só no schema `private`. `private.*` não é chamável pela API (testado).
- **`anon` sem nenhum privilégio de tabela** (conferido em `information_schema`), e `tests/security.supabase.test.ts` prova com cliente anônimo real: não lê tabela/view, não executa RPC, não escreve.
- **Isolamento**: o usuário vê só o próprio household; INSERT/UPDATE com `household_id` alheio é recusado; `pocket_movements` não tem escrita direta (42501); `bootstrap_household` repetido é recusado. Os testes SQL com dois households ficam em `supabase/tests/*isolation*`.
- **`household_id` arbitrário**: nenhuma RPC pública o recebe, exceto `seed_default_categories(p_household_id)`, que é **INVOKER** (o RLS recusa household alheio — testado). `bootstrap_household` recebe só nomes.
- **Advisors**: (1) `bootstrap_household` é `SECURITY DEFINER` e executável por `authenticated` — **intencional** (cria o household do usuário logado a partir de `auth.uid()`; não aceita ids); (2) **Leaked Password Protection desativada** — é **a única pendência relevante de Auth** e é ação sua no painel.
- **Segredos**: nenhuma `service_role`/chave secreta no código, nos testes ou nos docs (varredura); `.env*` ignorados (só `.env.example` versionável); `.mcp.json` contém apenas o `project_ref`. O app só usa a chave *publishable*.

## Migrations
- **Local 32 = remoto 32**, mesma ordem e mesmos nomes (comparado linha a linha); sem duplicadas; sem arquivo perdido.
- **Funções**: 79 no banco × 78 criadas por migrations; a diferença é `public.rls_auto_enable()`, da plataforma (event trigger que liga RLS), já endurecida (`REVOKE`) pela migration 5. Nenhuma função temporária/órfã de teste; 0 objetos `pg_temp`; 0 households órfãos; nenhuma extensão/schema inesperado.
- Todo SQL manual (dry-runs, testes) foi entregue como arquivo em `supabase/tests/` e executado com rollback; nenhum objeto de teste persistiu.

## Usuários e fixtures de teste (o que ainda existe)
| Usuário | Situação | Ação |
|---|---|---|
| `e2e-bloco2@test.invalid` | sem household, sem uso | **Remover pelo painel** (Authentication → Users) |
| `e2e-bloco3@test.invalid` | **em uso** (`.env.e2e.local`): é o usuário descartável das suítes; mantém um household de teste com dados do último E2E | Manter enquanto for rodar os testes; **remover pelo painel ao terminar** (a remoção apaga o household por cascata). A suíte Vitest apaga os households do usuário a cada execução |
| *(sua conta pessoal)* | **sua conta real** (1 household) | Nunca foi tocada pelos testes |

Arquivos: só `.env.example` (modelo), `.env.local` (URL/chave publishable/modo) e `.env.e2e.local` (credenciais de `e2e-bloco3`, ignorado pelo git). Não existem outros `.env.e2e*`.

## Paridade local × Supabase (matriz)
Suítes: transações/cartões/faturas/parcelas (`parity`), recorrências, dívidas, planejamento, calendário, cofrinhos/objetivos (+ edição de conta com lastro + importação legada) e relatórios (filtros, períodos, janela `paidBetween`). Todas passam; divergências conhecidas:

| # | Divergência | Classe |
|---|---|---|
| 1 | "Hoje": fuso do navegador (local) × fuso do household (Supabase) | intencional |
| 2 | Janela de leitura: local tem tudo em memória; Supabase carrega só o período (teto 5.000, com aviso) | intencional |
| 3 | `WorkspaceData.pocketMovements` no Supabase traz só `use`/`use_reversal`; histórico completo sob demanda | intencional |
| 4 | Sem RLS, sem multiusuário e sem travas de concorrência no local (`localStorage`; duas abas podem se atropelar) | intencional (modo demonstração) |
| 5 | Quando dois erros se aplicam à mesma operação, a precedência pode diferir (ex.: `future_date`) | irrelevante |
| 6 | Status da compra no cartão: decidido no cliente (local) × pelo banco; resultados idênticos (paridade) | irrelevante |
| 7 | Ocorrências excluídas de recorrência: `skippedDates` (local) × tabela `recurring_skips` | irrelevante |
| 8 | Dados de exemplo só existem no local | intencional |
| — | **Precisa corrigir** | **nenhuma** |

## Performance
- Nenhum componente lê o histórico inteiro no Supabase (`transactions.list()` só nos motores locais); leituras por janela, paginadas em 500, teto de 5.000; cofrinhos: histórico com limite (200 / 5.000 nos relatórios); sem N+1 (cada visão é uma consulta; relatórios agregam em memória sobre a janela).
- Cada mutação recarrega cadastros + janela + snapshot (~12 consultas em paralelo): aceitável hoje; otimização registrada.
- **Índices (advisors, 21 "não usados")**: 12 são `*_created_by_idx` (cobrem a FK para `auth.users`, importam na remoção de usuário) e 9 cobrem FKs compostas/filtros de recorrências, dívidas e objetivos. O volume ainda é pequeno, então o planner não os usa. **Recomendação: manter todos agora**; reavaliar com `pg_stat_user_indexes` depois de meses de uso real (candidatos: `recurring_transactions_household_active_idx`, `debts_household_status_idx`). **Nenhum DROP foi feito.**

## Integridade financeira
Invariantes nomeadas + 6 sequências aleatórias de 70 operações (com todos os invariantes conferidos após cada passo), "Disponível de verdade" (9 cenários: nenhuma obrigação em dobro), relatórios conferidos centavo a centavo (tela × CSV × séries), e a mesma matriz no Supabase real — ver [FINANCIAL_RULES.md](./FINANCIAL_RULES.md).

## Pendências manuais
1. **Ativar Leaked Password Protection** (Authentication → Policies/Password security).
2. **Remover** `e2e-bloco2@test.invalid`; remover `e2e-bloco3@test.invalid` quando terminar de rodar testes.
3. **Para uso real/multiusuário**: configurar *Site URL* e *Redirect URLs* do Auth para o domínio de produção, `NEXT_PUBLIC_SITE_URL` e, se for convidar mais pessoas, um SMTP próprio (o padrão do Supabase tem limite baixo de e-mails).
4. **Backup**: confirmar o plano/retenção de backup do projeto Supabase (e considerar exportações periódicas).
5. **Controle de versão**: o projeto **não está num repositório git** — `git init` e primeiro commit (o `.gitignore` já protege os `.env*`).

## Riscos conhecidos
- Gateway esporádico (502): leituras são repetidas; uma **escrita** que cair numa falha de rede mostra erro e não é repetida (por desenho — evita duplicar).
- Janela de 5.000 movimentações: períodos muito longos/volumosos mostram aviso (relatórios por RPC/view são a evolução natural).
- Principal × juros de dívida não decomposto; série histórica do patrimônio cobre só ativos.
- Sem CSP estrita (só cabeçalhos básicos); HSTS depende da hospedagem.
- Mudança de `NEXT_PUBLIC_DATA_SOURCE` exige novo build.

## Gate final de release (artefato exato)
Executado no código final (com os cabeçalhos de segurança): ESLint e TypeScript sem avisos; `next build` ok; Vitest **34 arquivos / 527 testes**; E2E local **321/321**; E2E Supabase **360/360**, sem leituras de rede "não recuperadas".

**Duplo clique em pagar fatura e pagar dívida (cenário determinístico, `e2e/audit-checks.mjs`)** — o teste exige uma fatura/parcela em aberto (pré-condição verificada), dá dois cliques imediatos (25 ms) em "Registrar pagamento" e confere: (a) no Supabase, **uma única** chamada `pay_invoice` / `pay_debt` saiu do navegador; (b) **um único** pagamento persistido de R$ 1,00 e o saldo cai uma vez; (c) a limpeza restaura saldo e pagamentos. Proteções em camadas: `isSubmitting` do formulário + trava global de `useAction`. Passou nos dois modos.
