# Melhorias futuras (documentadas, NÃO implementadas)

## Despesas de consumo × amortização × juros × fluxo de caixa

**Estado atual (mantido):** no **Dashboard**, todo pagamento de dívida (`debt_payment`) conta **inteiro** como saída de caixa **e** como despesa realizada (decisão da fase de Dívidas). Os **Relatórios** já separam: pagamento de dívida fica fora do consumo, em seção própria, e entra no fluxo de caixa; principal × juros continua **não** decomposto. O Planejamento e o Calendário trabalham com caixa e não dependem desta melhoria.

**Problema:** se a compra financiada é registrada como despesa e depois os pagamentos do empréstimo também contam como despesa, o mesmo gasto aparece duas vezes nos indicadores de **despesa** (competência) e no gráfico por categoria. O principal pago é só devolução do dinheiro que já foi gasto; despesa econômica de verdade é o **custo financeiro** (juros e encargos).

**Quatro conceitos que precisam ser distinguidos:**

| Conceito | O que é | Hoje |
|---|---|---|
| Dinheiro recebido do empréstimo | entrada de caixa (receita só se o usuário registrar) | manual |
| Pagamento do **principal** (amortização) | saída de caixa, **redução de passivo**, não é despesa | conta como despesa |
| **Juros / custo financeiro** | saída de caixa **e** despesa econômica | conta como despesa (junto com o principal) |
| Despesa de **consumo** | gasto efetivo (a compra financiada) | correto |

**Proposta (precisa de aprovação antes de qualquer mudança):**

1. Dividir cada pagamento de dívida, de forma **derivada** (nada gravado), em amortização e custo, proporcionalmente: `custo = pagamento × (total − original) / total`.
2. "Despesas realizadas" e o gráfico por categoria passariam a contar só o custo financeiro; a compra financiada continua despesa uma única vez, no momento da compra.
3. **Fluxo de caixa não muda** (saldo, Planejamento, Calendário, Disponível de verdade): o pagamento inteiro continua saindo da conta.
4. Exibir "principal × custo" (informativo) em Dívidas e no detalhe dos pagamentos.
5. Quitação com desconto: o desconto reduz o custo (não o principal).

**Cuidados:** a divisão proporcional é uma aproximação (não reconstrói a taxa efetiva do contrato); mudar o que "Despesas realizadas" mostra para dívidas altera relatórios já vistos pelo usuário; dívidas sem juros (original = total) ficariam com despesa zero nos pagamentos — o que é o comportamento economicamente correto, mas deve ser comunicado.

## Outras melhorias registradas (não implementadas)

- **Git**: o projeto ainda não está sob controle de versão. Recomendado `git init` + primeiro commit (o `.gitignore` já protege `.env*`).
- **Índices**: 21 índices aparecem como "não usados" nos advisors (volume ainda pequeno). Todos cobrem FKs ou filtros; **manter** e reavaliar com dados reais (`pg_stat_user_indexes`). Candidatos a remover só depois de meses de uso: `recurring_transactions_household_active_idx`, `debts_household_status_idx`. Nenhum DROP foi feito.
- **Recarregar menos**: cada mutação recarrega cadastros + janela + snapshot (≈12 consultas em paralelo). Dá para recarregar só o afetado (ex.: só movimentações e snapshot após uma despesa).
- **Patrimônio líquido histórico**: reconstruir o passivo (dívidas) mês a mês; hoje só a série de ativos é histórica.
- **Relatórios por RPC/view**: se um período passar de ~5.000 movimentações, mover as agregações (consumo/caixa por mês e categoria) para uma view/RPC.
- **Divisão do casal** (`split` por percentual): o tipo existe no domínio, mas nenhuma regra nem o banco o usam.
- **Exclusão de recorrência/ocorrência** pela interface, exportação em PDF, Open Finance e importação bancária (fora do escopo até autorização).
- **Leaked Password Protection** (Auth): ação manual no painel do Supabase.
- **CSP (Content-Security-Policy)**: hoje só há os cabeçalhos básicos (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`). Uma CSP estrita exige nonces para os scripts inline do Next; fazer em etapa própria. HSTS: ativar na hospedagem.
