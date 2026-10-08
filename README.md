# Finora

Finanças pessoais e de casal: contas, cartões, movimentações, recorrências, dívidas, planejamento, calendário, cofrinhos, objetivos e relatórios. Next.js 16 · React 19 · TypeScript · Tailwind 4 · Supabase (Auth + Postgres com RLS) · Vitest · E2E com Puppeteer.

> Dinheiro é sempre **centavos inteiros** (`bigint` no banco, `number` seguro no app); datas são ISO (`AAAA-MM-DD`) e o "hoje" é o do **fuso do household**.

## Rodando

```bash
npm install
cp .env.example .env.local   # preencha URL e chave PUBLISHABLE do Supabase (NUNCA a service_role)
npm run dev                  # http://localhost:3000
```

| Variável | Para quê |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Cliente Supabase (a chave publishable é pública por desenho; o que cada usuário vê é decidido pelo RLS) |
| `NEXT_PUBLIC_DATA_SOURCE` | `supabase` (dados reais) ou `local` (demonstração em `localStorage`). Resolvido **no build**. |
| `E2E_EMAIL`, `E2E_PASSWORD` (`.env.e2e.local`) | Usuário **descartável** `@test.invalid` para os testes de integração/E2E |

Todos os arquivos `.env*` (menos `.env.example`) são ignorados pelo git.

## Qualidade

```bash
npm run lint && npx tsc --noEmit
npm test                                   # Vitest: unitários + invariantes + paridade local × Supabase (precisa do usuário de teste)
npm run build                              # build do modo escolhido em NEXT_PUBLIC_DATA_SOURCE
node --env-file=.env.e2e.local e2e/run.mjs                    # E2E modo local (build com NEXT_PUBLIC_DATA_SOURCE=local)
E2E_MODE=supabase node --env-file=.env.e2e.local e2e/run.mjs  # E2E modo Supabase (build padrão)
```

Sem as credenciais de teste, as suítes que tocam o banco real são **puladas** (não falham). Detalhes e a investigação de flakes em [docs/TEST_STABILITY.md](docs/TEST_STABILITY.md).

## Mapa da documentação

| Documento | Assunto |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Camadas, pastas, portas/adaptadores, como evitamos contagem dupla |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | Modo local × Supabase, o que vem de onde, RPCs, janelas de leitura, fuso |
| [docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md) | **Regras financeiras e invariantes** (fonte única), "Disponível de verdade" |
| [docs/REPORTS.md](docs/REPORTS.md) | Relatórios: caixa × consumo, métricas, filtros, CSV |
| [docs/PLANNING.md](docs/PLANNING.md), [docs/CALENDAR.md](docs/CALENDAR.md) | Projeção de caixa e calendário financeiro |
| [docs/RECURRENCES.md](docs/RECURRENCES.md), [docs/DEBTS.md](docs/DEBTS.md), [docs/POCKETS.md](docs/POCKETS.md) | Recorrências, dívidas, cofrinhos e objetivos |
| [docs/TEST_STABILITY.md](docs/TEST_STABILITY.md) | Estabilidade dos testes, `resilient-fetch`, E2E |
| [docs/RELEASE_CANDIDATE.md](docs/RELEASE_CANDIDATE.md) | Auditoria do release candidate (segurança, migrations, performance, paridade, pendências) |
| [docs/FUTURE_IMPROVEMENTS.md](docs/FUTURE_IMPROVEMENTS.md) | Melhorias propostas e NÃO implementadas |
| [docs/POCKETS_PROPOSAL.md](docs/POCKETS_PROPOSAL.md) | Histórico do desenho dos cofrinhos (decisões e revisões) |

## Banco de dados

`supabase/migrations/` é a fonte da verdade do schema (32 migrations, idênticas ao projeto remoto). `supabase/tests/` guarda os testes SQL (isolamento, guardas, RPCs, concorrência manual). Nada é aplicado sem migration correspondente.

> Next.js: esta versão tem mudanças de API em relação ao que a maioria conhece — consulte `node_modules/next/dist/docs/` antes de mexer em convenções do framework (veja `AGENTS.md`).
