# Finora — Arquitetura

## 1. Camadas e pastas

```
app/                     Rotas (Next App Router). (app)/ = área logada; (auth)/ e onboarding/ = entrada.
components/              UI por funcionalidade (transactions, cards, debts, pockets, goals, reports, planning, calendar…)
  ui/ forms/ layout/     Primitivos (Card, Dialog, Menu, ProgressBar…), campos de formulário, shell
  providers/             WorkspaceProvider (dados + comandos + janelas), ToastProvider
domain/                  Regras PURAS (sem React nem I/O): cálculos, snapshot, dívidas, recorrência, planejamento,
                         calendário, cofrinhos, relatórios, períodos, datas
services/                Orquestração: comandos (porta + adaptador local + adaptador Supabase), dashboard, CSV, visões
repositories/            Portas de leitura (Repository<T>…) + adaptadores local (localStorage) e supabase/
schemas/                 Zod dos formulários
lib/                     format, labels, money, csv, supabase (clientes, resilient-fetch)
mocks/                   Dados de DEMONSTRAÇÃO (só modo local; respeitam as mesmas regras do banco — tests/seeds.test.ts)
supabase/                migrations (schema, RLS, RPCs, views) e testes SQL
tests/ e2e/              Vitest (unidade, invariantes, paridade) e E2E de navegador
docs/                    Documentação
```

Regra de dependência: `components → services → repositories/domain`; `domain` não importa nada de fora. **Componentes nunca conhecem o Supabase**: só as portas.

## 2. Portas e adaptadores

| Porta | Adaptador local (demonstração/testes) | Adaptador Supabase |
|---|---|---|
| `Repository<T>` (cadastros), `TransactionRepository.query(janela)`, `PocketRepository`, `GoalRepository` | `LocalStorageRepository` (+ `LocalAccountRepository` com as guardas de lastro) | `Supabase*Repository` (RLS por household) |
| `TransactionCommands` | `LocalTransactionCommands` | RPCs atômicas (`create_transaction`, `pay_invoice`…) |
| `RecurrenceCommands`, `DebtCommands`, `PocketCommands` | `Local*` | RPCs (`create_debt`, `pocket_reserve`, `spend_from_pocket`…) |
| `FinanceReader` (snapshot: saldos, faturas, limite, dívidas, reservas) | derivado das movimentações (`deriveSnapshot`) | views `security_invoker` |

O ponto único de escolha é `repositories/index.ts` (`createDataSource`). O motor local e o banco implementam **as mesmas regras**; a paridade é provada por testes que rodam o mesmo roteiro nos dois (`tests/parity*.supabase.test.ts`).

## 3. Multi-tenancy e segurança

- Tenancy por **household** (`household_id` em toda tabela de negócio); RLS por membership; chaves estrangeiras **compostas** `(household_id, id)` impedem referenciar dado de outro household.
- Escritas de negócio só por **RPC SECURITY INVOKER** (RLS continua valendo); helpers `SECURITY DEFINER` ficam no schema `private` (não exposto), com `search_path` vazio. `anon` não tem acesso a nada.
- O app usa só a chave publishable + sessão do usuário. Nenhum endpoint aceita `household_id` arbitrário (`seed_default_categories(p_household_id)` é INVOKER: o RLS recusa household alheio — testado).
- Detalhes da auditoria: [RELEASE_CANDIDATE.md](./RELEASE_CANDIDATE.md).

## 4. Como evitamos contagem dupla (resumo; regras completas em [FINANCIAL_RULES.md](./FINANCIAL_RULES.md))

1. `Transaction` é a única fonte de valores. `InstallmentPurchase`, `RecurringTransaction`, `Debt` (contrato), `Goal` e `Pocket` **nunca somam**: geram/derivam transações ou são informação.
2. Saldo, faturas, limite, pago de dívida e reservado são **derivados** (views no banco; funções puras no local). Nada disso é gravado.
3. Compra no cartão = consumo na data da compra e obrigação na fatura; **não** mexe no saldo. Pagar a fatura = saída de caixa, **não** é despesa.
4. Transferência/investimento/resgate: neutros no patrimônio consolidado.
5. Cofrinho é divisão **virtual** do dinheiro que já está na conta (nunca aumenta patrimônio); usar a reserva cria uma única despesa.
6. Duas lentes que nunca se misturam: **competência/consumo** e **caixa** (Relatórios).

## 5. Dados e carregamento

`loadWorkspace(source, janela)` carrega cadastros + movimentações da **janela** declarada pela tela (`useTransactionWindow`) + snapshot. No Supabase nunca se baixa o histórico inteiro: janela por data (`paidBetween` opcional para caixa/patrimônio), paginada em blocos de 500, teto de 5.000 (a tela avisa se estourar). Cada mutação roda por `useAction` (trava global de operação em andamento → sem duplo clique, recarrega os dados e dá feedback).

## 6. Rotas

`/` Visão Geral · `/movimentacoes` · `/contas` · `/cartoes` · `/categorias` · `/pessoas` · `/recorrencias` · `/dividas` · `/planejamento` · `/calendario` · `/cofrinhos` · `/objetivos` · `/relatorios` · `/configuracoes` · `/login` `/cadastro` `/onboarding`. Não há mais itens "em breve" além do que o menu indicar.

## 7. Erros

`AppError(message, code, info)` (`repositories/supabase/errors.ts`): toda exceção do banco (códigos das migrations), constraints e SQLSTATE são traduzidos; o motor local produz a mesma mensagem e o mesmo código. A UI nunca mostra texto cru do Postgres; o detalhe vai para `console.warn` só fora de produção. `tests/error-coverage.test.ts` falha se uma migration levantar um código sem tradução.
