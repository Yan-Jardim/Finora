/**
 * Suíte do modo Supabase (E2E_MODE=supabase + E2E_EMAIL/E2E_PASSWORD de um usuário de TESTE).
 * Requer build com NEXT_PUBLIC_DATA_SOURCE=supabase. Cria dados com sufixo "E2E" e remove o que a interface
 * permite excluir (pessoas só podem ser desativadas, por desenho).
 *
 * Recebe o "kit" do runner (page, helpers) para reaproveitar login/asserts.
 */
import { calendarChecks } from "./calendar-checks.mjs";
import { pocketChecks, pocketPersistenceChecks } from "./pockets-checks.mjs";
import { reportsChecks, reportsPersistenceChecks } from "./reports-checks.mjs";
import { dialogsAndKeyboard, doubleSubmit, payDebtDouble, payInvoiceDouble, sweep } from "./audit-checks.mjs";

export async function supabaseSuite(k) {
  const { page, BASE, check, wait, text, goto, click, fill, shot, dash, login, pathOf, allow400 } = k;
  const stamp = String(Date.now()).slice(-5);
  const N = {
    person: `Pessoa E2E ${stamp}`,
    person2: `Pessoa E2E ${stamp} B`,
    cat: `Pets E2E ${stamp}`,
    cat2: `Pets E2E ${stamp} B`,
    sub: `Vet E2E ${stamp}`,
    acc: `Conta E2E ${stamp}`,
    acc2: `Conta E2E ${stamp} B`,
    card: `Cartao E2E ${stamp}`,
    card2: `Cartao E2E ${stamp} B`,
    acc3: `Conta E2E ${stamp} C`,
    salary: `Salario E2E ${stamp}`,
    market: `Mercado E2E ${stamp}`,
    marketEd: `Mercado E2E ${stamp} ed`,
    trip: `Viagem E2E ${stamp}`,
    transfer: `Transf E2E ${stamp}`,
    dinner: `Jantar E2E ${stamp}`,
    laptop: `Notebook E2E ${stamp}`,
    accR: `Conta Rec E2E ${stamp}`,
    catR: `Rec E2E ${stamp}`,
    rec: `Internet Rec E2E ${stamp}`,
    accD: `Conta Div E2E ${stamp}`,
    debt: `Emprestimo E2E ${stamp}`,
  };

  const rowButton = (rowText, buttonLabel) =>
    page.evaluate(
      (r, b) => {
        const matches = (y) => y.textContent.trim() === b || y.getAttribute("aria-label") === b;
        const li = [...document.querySelectorAll("main li")].find(
          (x) => x.textContent.includes(r) && [...x.querySelectorAll("button")].some(matches),
        );
        if (!li) throw new Error(`linha/botão não encontrado: ${r} / ${b}`);
        [...li.querySelectorAll("button")].find(matches).click();
      },
      rowText,
      buttonLabel,
    );
  /** Seleciona uma opção pelo TEXTO (os valores são UUIDs) num <select> do diálogo aberto. */
  const pick = (label, optionText) =>
    page.evaluate(
      (l, o) => {
        const lab = [...document.querySelectorAll("dialog[open] label")].find((x) => x.textContent.trim().startsWith(l));
        if (!lab) throw new Error("campo não encontrado: " + l);
        const sel = document.getElementById(lab.htmlFor);
        const opt = [...sel.options].find((x) => x.textContent.includes(o));
        if (!opt) throw new Error("opção não encontrada: " + o);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      },
      label,
      optionText,
    );
  const setFilter = (ariaLabel, value) =>
    page.evaluate(
      (a, v) => {
        const sel = document.querySelector('main select[aria-label="' + a + '"]');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, v);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      },
      ariaLabel,
      value,
    );
  const clickRadio = (labelText) =>
    page.evaluate((t) => {
      const lab = [...document.querySelectorAll("dialog[open] label")].find((x) => x.textContent.trim() === t);
      if (!lab) throw new Error("opção de escopo não encontrada: " + t);
      lab.querySelector("input").click();
    }, labelText);
  const clickCheckbox = () => page.evaluate(() => document.querySelector("dialog[open] input[type=checkbox]").click());
  const menu = async (name, item) => {
    await click("Ações de " + name);
    await wait(150);
    await click(item);
  };
  const newTx = async (kindLabel) => {
    await goto("/movimentacoes");
    await click("Nova movimentação");
    await click(kindLabel, { starts: true, scope: "dialog" });
    await wait(150);
  };
  const submitTx = async () => {
    await click("Registrar");
    await wait(2200);
  };
  const rowText = (name) =>
    page.evaluate((n) => ([...document.querySelectorAll("main li")].find((l) => l.textContent.includes(n))?.textContent ?? "").replace(/\u00a0/g, " "), name);
  const accountRow = async (name) => {
    await goto("/contas");
    return rowText(name);
  };
  const cardRow = async (name) => {
    await goto("/cartoes");
    return rowText(name);
  };
  const rowHas = (name, word) =>
    page.evaluate((n, w) => [...document.querySelectorAll("main li")].find((l) => l.textContent.includes(n))?.textContent.includes(w) ?? false, name, word);

  // ---- modo e aviso de transição ----
  await goto("/");
  let t = await text();
  check("supabase: o aviso de \"Modo de transição\" não existe mais (movimentações vêm do banco)", !t.includes("Modo de transição"));
  check("supabase: dados de DEMONSTRAÇÃO não aparecem", !t.includes("Notebook") && !t.includes("Banco X"));
  await goto("/configuracoes");
  t = await text();
  check("supabase: Configurações não oferece apagar/restaurar", t.includes("Fonte dos dados") && !t.includes("Começar do zero") && !t.includes("Restaurar dados de exemplo"));

  // ---- Pessoas ----
  await goto("/pessoas");
  check("supabase: pessoa do onboarding existe", (await page.$$eval("main ul li", (l) => l.length)) >= 1);
  await click("Nova pessoa");
  await fill("Nome", N.person);
  await click("Salvar");
  await wait(2600);
  check("pessoa: criar", (await text()).includes(N.person));
  await goto("/pessoas");
  check("pessoa: persiste após reload", (await text()).includes(N.person));
  await rowButton(N.person, "Editar");
  await wait(200);
  await fill("Nome", N.person2);
  await click("Salvar");
  await wait(2600);
  check("pessoa: editar", (await text()).includes(N.person2));
  await rowButton(N.person2, "Desativar");
  await wait(2600);
  check("pessoa: desativar", await rowHas(N.person2, "Inativo"));
  await goto("/pessoas");
  check("pessoa: desativada persiste após reload", await rowHas(N.person2, "Inativo"));
  await rowButton(N.person2, "Ativar");
  await wait(2600);
  check("pessoa: reativar", !(await rowHas(N.person2, "Inativo")));
  await click("Nova pessoa");
  await fill("Nome", N.person2.toLowerCase());
  await click("Salvar");
  await wait(500);
  check("pessoa: nome duplicado é recusado", (await text()).includes("Já existe uma pessoa com esse nome."));
  await click("Cancelar");

  // ---- Categorias ----
  await goto("/categorias");
  t = await text();
  check("categorias: padrão semeado no onboarding", t.includes("Moradia") && t.includes("Alimentação") && t.includes("Aluguel"));
  await click("Nova categoria");
  await fill("Nome", N.cat);
  await click("Salvar");
  await wait(2600);
  check("categoria: criar", (await text()).includes(N.cat));
  await click(`Nova subcategoria em ${N.cat}`);
  await wait(200);
  await fill("Nome", N.sub);
  await click("Salvar");
  await wait(2600);
  check("subcategoria: criar", (await text()).includes(N.sub));
  await click(`Editar ${N.cat}`);
  await wait(200);
  await fill("Nome", N.cat2);
  await click("Salvar");
  await wait(2600);
  check("categoria: editar", (await text()).includes(N.cat2) && (await text()).includes(N.sub));
  await goto("/categorias");
  check("categoria e subcategoria persistem após reload", (await text()).includes(N.cat2) && (await text()).includes(N.sub));
  await click(`Excluir ${N.cat2}`);
  await wait(300);
  check("categoria com subcategoria: exclusão bloqueada", (await text()).includes("possui subcategorias"));
  await click("Entendi");

  // ---- Contas ----
  await goto("/contas");
  await click("Nova conta");
  await fill("Nome da conta", N.acc);
  await fill("Instituição", "Banco E2E");
  await fill("Tipo", "digital");
  await fill("Saldo inicial", "1.234,56");
  await click("Salvar");
  await wait(2600);
  t = await text();
  check("conta: criar (saldo = saldo inicial)", t.includes(N.acc) && t.includes("R$ 1.234,56"));
  await goto("/contas");
  check("conta: persiste após reload", (await text()).includes(N.acc) && (await text()).includes("R$ 1.234,56"));
  await click(`Editar ${N.acc}`);
  await wait(200);
  await fill("Nome da conta", N.acc2);
  await fill("Saldo inicial", "2.000,00");
  await click("Salvar");
  await wait(2600);
  t = await text();
  check("conta: editar", t.includes(N.acc2) && t.includes("R$ 2.000,00"));
  await click("Nova conta");
  await fill("Nome da conta", N.acc2.toUpperCase());
  await click("Salvar");
  await wait(600);
  check("conta: nome duplicado é recusado", (await text()).includes("Já existe uma conta com esse nome."));
  await click("Cancelar");
  await shot("sb-contas");

  // ---- Cartões ----
  await goto("/cartoes");
  await click("Novo cartão");
  await fill("Nome do cartão", N.card);
  await fill("Limite", "5.000,00");
  await fill("Dia de fechamento", "3");
  await fill("Dia de vencimento", "10");
  await fill("Últimos 4 dígitos", "4821");
  await page.evaluate((name) => {
    const lab = [...document.querySelectorAll("dialog[open] label")].find((x) => x.textContent.trim().startsWith("Conta padrão"));
    const sel = document.getElementById(lab.htmlFor);
    const opt = [...sel.options].find((o) => o.textContent.includes(name));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, N.acc2);
  await click("Salvar");
  await wait(2600);
  t = await text();
  check("cartão: criar (limite; utilizado zerado)", t.includes(N.card) && t.includes("R$ 5.000,00") && t.includes("•••• 4821"));
  await goto("/cartoes");
  check("cartão: persiste após reload", (await text()).includes(N.card));
  await rowButton(N.card, "Editar");
  await wait(200);
  await fill("Nome do cartão", N.card2);
  await fill("Limite", "7.500,00");
  await click("Salvar");
  await wait(2600);
  t = await text();
  check("cartão: editar", t.includes(N.card2) && t.includes("R$ 7.500,00"));
  await click("Novo cartão");
  await fill("Últimos 4 dígitos", "12ab");
  await click("Salvar");
  await wait(300);
  check("cartão: últimos dígitos inválidos são recusados", (await text()).includes("Informe exatamente 4 dígitos."));
  await click("Cancelar");
  await goto("/contas");
  await click(`Excluir ${N.acc2}`);
  await wait(300);
  check("conta usada por cartão: exclusão bloqueada", (await text()).includes("Não é possível excluir"));
  await click("Entendi");

  // ---- movimentações no Supabase ----
  await goto("/movimentacoes");
  t = await text();
  check("movimentações: estado vazio de um espaço novo", t.includes("Nenhuma movimentação registrada") && t.includes("Nova movimentação"));

  // conta extra para a transferência
  await goto("/contas");
  await click("Nova conta");
  await fill("Nome da conta", N.acc3);
  await fill("Tipo", "checking");
  await click("Salvar");
  await wait(2600);

  // receita (paga) -> aumenta o saldo
  await newTx("Receita");
  await fill("Descrição", N.salary);
  await fill("Valor", "3.000,00");
  await pick("Conta de destino", N.acc2);
  await pick("Categoria", "Salário");
  await submitTx();
  check("receita: criada e listada", (await text()).includes(N.salary));
  check("receita paga: saldo da conta = 2.000 + 3.000", (await accountRow(N.acc2)).includes("R$ 5.000,00"));

  // despesa paga -> reduz o saldo
  await newTx("Despesa");
  await fill("Descrição", N.market);
  await fill("Valor", "150,00");
  await pick("Conta", N.acc2);
  await pick("Categoria", "Alimentação");
  await submitTx();
  check("despesa paga: saldo = 5.000 - 150", (await accountRow(N.acc2)).includes("R$ 4.850,00"));

  // despesa PREVISTA -> não mexe no saldo
  await newTx("Despesa");
  await fill("Descrição", N.trip);
  await fill("Valor", "500,00");
  await fill("Status", "planned");
  await pick("Conta", N.acc2);
  await pick("Categoria", "Alimentação");
  await submitTx();
  check("despesa prevista: listada", (await text()).includes(N.trip));
  check("despesa prevista não reduz o saldo", (await accountRow(N.acc2)).includes("R$ 4.850,00"));

  // transferência
  await newTx("Transferência");
  await fill("Descrição", N.transfer);
  await fill("Valor", "100,00");
  await pick("Conta de origem", N.acc2);
  await pick("Conta de destino", N.acc3);
  await submitTx();
  check("transferência: origem 4.750 e destino 100 (patrimônio inalterado)", (await accountRow(N.acc2)).includes("R$ 4.750,00") && (await accountRow(N.acc3)).includes("R$ 100,00"));

  // compra à vista no cartão: consome limite, NÃO mexe na conta
  await newTx("Compra no cartão");
  await fill("Descrição", N.dinner);
  await fill("Valor", "200,00");
  await pick("Cartão", N.card2);
  await pick("Categoria", "Alimentação");
  await submitTx();
  check("compra no cartão: consome limite (utilizado 200)", /UtilizadoR\$ 200,00/.test(await cardRow(N.card2)));
  check("compra no cartão não reduz a conta", (await accountRow(N.acc2)).includes("R$ 4.750,00"));

  // compra parcelada 3x
  await newTx("Compra no cartão");
  await fill("Descrição", N.laptop);
  await fill("Valor", "900,00");
  await clickCheckbox();
  await wait(150);
  await fill("Número de parcelas", "3");
  await pick("Cartão", N.card2);
  await pick("Categoria", "Alimentação");
  await submitTx();
  t = await text();
  check("parcelamento: parcela 1/3 listada no mês da compra", t.includes(N.laptop) && /Parcela 1\/3/.test(t));
  check("parcelamento: limite usado = 200 + 900 (todas as parcelas)", /UtilizadoR\$ 1\.100,00/.test(await cardRow(N.card2)));
  await goto("/movimentacoes");
  await click("Próximo mês");
  await wait(1800);
  t = await text();
  check("parcelamento: navegar ao mês seguinte mostra a parcela 2/3", t.includes(N.laptop) && /Parcela 2\/3/.test(t));
  await shot("sb-movimentacoes-mes-seguinte");

  // editar, status
  await goto("/movimentacoes");
  await menu(N.market, "Editar");
  await wait(250);
  await fill("Descrição", N.marketEd);
  await click("Salvar alterações");
  await wait(2200);
  check("editar: nova descrição", (await text()).includes(N.marketEd));
  await menu(N.marketEd, "Marcar como pendente");
  await wait(1800);
  check("marcar como pendente devolve o valor ao saldo (4.900)", (await accountRow(N.acc2)).includes("R$ 4.900,00"));
  await goto("/movimentacoes");
  await menu(N.marketEd, "Marcar como pago");
  await wait(1800);
  check("marcar como pago reduz de novo (4.750)", (await accountRow(N.acc2)).includes("R$ 4.750,00"));

  // filtros
  await goto("/movimentacoes");
  await setFilter("Filtrar por tipo", "transfer");
  await wait(200);
  t = await text();
  check("filtro por tipo: só a transferência", t.includes(N.transfer) && !t.includes(N.dinner) && !t.includes(N.salary));
  await setFilter("Filtrar por tipo", "all");
  await setFilter("Filtrar por cartão", await page.evaluate((n) => [...document.querySelectorAll('main select[aria-label="Filtrar por cartão"] option')].find((o) => o.textContent.includes(n)).value, N.card2));
  await wait(200);
  t = await text();
  check("filtro por cartão: só compras do cartão", t.includes(N.dinner) && !t.includes(N.salary));
  await click("Limpar filtros");

  // excluir: despesa prevista; parcelas por escopo
  await menu(N.trip, "Excluir");
  await click("Excluir", { scope: "dialog" });
  // O Supabase tem latência entre a exclusão e a lista refletir: espera (com sondagem, até 15 s) em vez de um tempo fixo.
  for (let i = 0; i < 50 && (await text()).includes(N.trip); i++) await wait(300);
  check("excluir despesa prevista", !(await text()).includes(N.trip));
  await click("Próximo mês");
  await wait(1800);
  await menu(N.laptop, "Excluir");
  await wait(400);
  await clickRadio("Esta e as próximas parcelas");
  await click("Excluir", { scope: "dialog" });
  await wait(1500);
  check("excluir 'esta e as próximas': parcela 2/3 sumiu", !(await text()).includes(N.laptop));
  check("limite usado = 200 + parcela 1 (300)", /UtilizadoR\$ 500,00/.test(await cardRow(N.card2)));

  // DUPLO CLIQUE em "Registrar pagamento" (fatura): a fatura do cartão de teste está em aberto — uma só chamada pay_invoice
  await payInvoiceDouble({ page, goto, click, fill, text, check, wait, shot, dash }, { prefix: "supabase ", pause: 900, expectRpc: true, accountText: N.acc3 });

  // pagamento de fatura: parcial com a conta ESCOLHIDA (não a padrão), depois quitação
  await goto("/cartoes");
  await click("Pagar fatura");
  await wait(300);
  await pick("Pagar com a conta", N.acc3);
  await fill("Valor pago", "100,00");
  await click("Registrar pagamento");
  await wait(2600);
  check("pagamento parcial: sai da conta ESCOLHIDA (acc3 100 -> 0)", (await accountRow(N.acc3)).includes("R$ 0,00"));
  check("pagamento parcial: a conta padrão do cartão não foi usada (4.750)", (await accountRow(N.acc2)).includes("R$ 4.750,00"));
  check("pagamento parcial libera limite (utilizado 400)", /UtilizadoR\$ 400,00/.test(await cardRow(N.card2)));
  await goto("/cartoes");
  await click("Pagar fatura");
  await wait(300);
  await click("Registrar pagamento");
  await wait(2600);
  check("quitar a fatura: conta padrão paga o restante (4.750 - 400)", (await accountRow(N.acc2)).includes("R$ 4.350,00"));
  check("fatura quitada: limite utilizado volta a 0", /UtilizadoR\$ 0,00/.test(await cardRow(N.card2)));

  // dashboard: sem dupla contagem
  const dd = await dash();
  check("dashboard: despesas realizadas = 150 + 200 + 300 (pagamento da fatura NÃO é despesa)", dd.spent === 65000, String(dd.spent));
  check("dashboard: gráfico por categoria bate com as despesas", dd.chartTotal === dd.spent, dd.chartTotal + " vs " + dd.spent);
  check("dashboard: saldo em contas = 4.350 + 0", dd.balance >= 435000, String(dd.balance));

  // ---- recorrências (Supabase) ----
  // A regra e suas ocorrências NÃO são excluíveis pela interface (por desenho: só pausar). Por isso usam conta e categoria
  // próprias, que ficam; o household de teste é removido ao final pelo script de limpeza do usuário descartável.
  await goto("/contas");
  await click("Nova conta");
  await fill("Nome da conta", N.accR);
  await fill("Tipo", "checking");
  await click("Salvar");
  await wait(2600);
  await goto("/categorias");
  await click("Nova categoria");
  await fill("Nome", N.catR);
  await click("Salvar");
  await wait(2600);

  await goto("/recorrencias");
  t = await text();
  check("recorrências: estado vazio de um espaço novo", t.includes("Nenhuma recorrência cadastrada") && t.includes("Nova recorrência"));
  await click("Nova recorrência");
  await fill("Descrição", N.rec);
  await fill("Valor", "120,00");
  await pick("Conta", N.accR);
  await pick("Categoria", N.catR);
  await click("Criar recorrência");
  await wait(2200);
  t = await text();
  check("recorrência: criada e listada (Mensal, Ativa)", t.includes(N.rec) && t.includes("Mensal • Todo dia") && t.includes("Ativa") && t.includes("R$ 120,00"));
  const todayBr = new Date().toLocaleDateString("pt-BR");
  check("recorrência: próxima ocorrência = hoje (a âncora)", t.includes("Próxima ocorrência") && t.includes(todayBr), todayBr);

  await goto("/movimentacoes");
  t = await text();
  check("ocorrência gerada de hoje aparece em Movimentações, identificada como Recorrente", t.includes(N.rec) && t.includes("Recorrente"));
  await click("Próximo mês");
  await wait(1800);
  t = await text();
  check("ocorrência do mês seguinte já existe (horizonte de 12 meses) e é Prevista", t.includes(N.rec) && t.includes("Previsto"));
  await shot("sb-recorrencia-mes-seguinte");

  await goto("/recorrencias");
  t = await text();
  check("recorrência: persiste após recarregar", t.includes(N.rec));

  // editar valor (aplica às futuras não pagas)
  await click("Editar " + N.rec);
  await wait(300);
  await fill("Valor", "150,00");
  await click("Salvar alterações");
  await wait(2200);
  check("recorrência: valor editado", (await text()).includes("R$ 150,00"));
  await goto("/movimentacoes");
  await click("Próximo mês");
  await wait(1800);
  check("edição propagou para a ocorrência futura (R$ 150,00)", (await rowText(N.rec)).includes("R$ 150,00"));

  // pausar: futuras previstas somem da lista; reativar: voltam
  await goto("/recorrencias");
  await click("Pausar " + N.rec);
  await wait(2200);
  check("recorrência pausada", (await text()).includes("Pausada"));
  await goto("/movimentacoes");
  await click("Próximo mês");
  await wait(1800);
  check("pausada: ocorrência futura não aparece mais (cancelada pela regra)", !(await text()).includes(N.rec));
  await goto("/recorrencias");
  await click("Ativar " + N.rec);
  await wait(2200);
  check("recorrência reativada", !(await text()).includes("Pausada"));
  await goto("/movimentacoes");
  await click("Próximo mês");
  await wait(1800);
  check("reativada: a ocorrência futura voltou (sem duplicar)", (await rowText(N.rec)).includes("R$ 150,00") && (await page.$$eval("main li", (l, n) => l.filter((x) => x.textContent.includes(n)).length, N.rec)) === 1);

  // dashboard: a ocorrência de hoje (pendente) é uma conta a pagar comum
  const dr = await dash();
  check("dashboard: ocorrência pendente entra como conta a pagar (sem regra especial)", dr.t.includes("Pendentes R$ 150,00"), "");
  check("dashboard: despesas realizadas continuam batendo com o gráfico", dr.spent === dr.chartTotal);

  // ---- dívidas (Supabase) ----
  // A dívida não é excluível pela interface (por desenho); usa conta própria, que permanece. O household de teste é
  // removido ao final pelo script de limpeza do usuário descartável.
  await goto("/contas");
  await click("Nova conta");
  await fill("Nome da conta", N.accD);
  await fill("Tipo", "checking");
  await fill("Saldo inicial", "20.000,00");
  await click("Salvar");
  await wait(2600);

  await goto("/dividas");
  t = await text();
  check("dívidas: estado vazio de um espaço novo", t.includes("Nenhuma dívida cadastrada") && t.includes("Nova dívida"));
  await click("Nova dívida");
  await fill("Nome", N.debt);
  await fill("Credor", "Banco E2E");
  await fill("Quanto recebeu/deve", "8.000,00");
  await fill("Quanto vai pagar no total", "10.300,00");
  await fill("Número de parcelas", "13");
  await wait(200);
  t = await page.evaluate(() => document.querySelector("dialog[open]").innerText);
  check("dívida: prévia mostra as parcelas sem perder centavos e o custo financeiro", t.includes("10x de R$ 792,31 e 3x de R$ 792,30") && t.includes("R$ 2.300,00"));
  await pick("Conta padrão para pagar", N.accD);
  await click("Cadastrar dívida");
  await wait(2200);
  t = await text();
  check("dívida: cadastrada, com total, 0 de 13 parcelas e próxima parcela", t.includes(N.debt) && t.includes("R$ 10.300,00") && t.includes("0 de 13 parcelas pagas") && t.includes("Próxima:"));
  check("dívida: custo financeiro exibido", t.includes("Custo financeiro R$ 2.300,00"));
  check("dívida: cadastrar NÃO mexe no saldo da conta", (await accountRow(N.accD)).includes("R$ 20.000,00"));
  check("dívidas: 'Parcelas deste mês' soma a parcela em aberto", t.includes("Parcelas deste mês") && t.includes("R$ 792,31"));

  // DUPLO CLIQUE em "Registrar pagamento" (dívida): a dívida de teste tem parcela em aberto — uma só chamada pay_debt
  await payDebtDouble({ page, goto, click, fill, text, check, wait, shot, dash }, { prefix: "supabase ", pause: 900, expectRpc: true, accountText: N.accD, marker: N.debt });

  await goto("/dividas");
  await click("Pagar parcela");
  await wait(300);
  await click("Registrar pagamento");
  await wait(2200);
  t = await text();
  check("pagar parcela: progresso 1 de 13 e R$ 792,31 pagos", t.includes("1 de 13 parcelas pagas") && t.includes("R$ 792,31"));
  check("pagar parcela: reduz a conta escolhida (20.000 - 792,31)", (await accountRow(N.accD)).includes("R$ 19.207,69"));

  await goto("/dividas");
  await click("Pagar parcela");
  await wait(300);
  await fill("Valor pago", "300,00");
  await click("Registrar pagamento");
  await wait(2200);
  t = await text();
  check("pagamento parcial: a parcela seguinte mostra o que falta (R$ 492,31)", t.includes("R$ 492,31"));
  await goto("/dividas");
  await click("Pagar parcela");
  await wait(300);
  await fill("Valor pago", "99.999,00");
  await click("Registrar pagamento");
  await wait(600);
  check("pagar acima do saldo devido é recusado", (await page.evaluate(() => document.querySelector("dialog[open]")?.innerText ?? "")).includes("maior que o saldo devido"));
  await click("Cancelar", { scope: "dialog" });
  await wait(300);

  await goto("/movimentacoes");
  t = await text();
  check("movimentações: pagamentos de dívida aparecem com o selo Dívida", t.includes("Pagamento — " + N.debt) && t.includes("Dívida"));
  await click("Ações de Pagamento — " + N.debt, { starts: true });
  await wait(200);
  const menuItems = await page.evaluate(() => [...document.querySelectorAll("[role=menuitem]")].map((x) => x.textContent.trim()));
  check("movimentações: pagamento de dívida não oferece edição genérica (só excluir)", !menuItems.includes("Editar") && menuItems.includes("Excluir"), menuItems.join("|"));
  await page.keyboard.press("Escape");

  const dv = await dash();
  check("dashboard: pagamentos de dívida entram em Despesas realizadas e o gráfico bate", dv.spent === dv.chartTotal && dv.t.includes("Dívidas a pagar"));
  check("dashboard: despesas incluem 792,31 + 300,00 dos pagamentos", dv.spent >= 109231, String(dv.spent));

  // quitação antecipada: valor efetivamente pago e desconto registrado
  await goto("/dividas");
  await click("Quitar");
  await wait(300);
  await fill("Valor efetivamente pago", "8.000,00");
  await click("Quitar dívida");
  await wait(2200);
  t = await text();
  check("quitação: a dívida sai de 'em andamento' e vai para Quitadas", t.includes("Quitadas e canceladas (1)") && t.includes("Nenhuma dívida em andamento"));
  await page.evaluate(() => document.querySelector("details summary").click());
  await wait(200);
  t = await text();
  check("quitação: mostra o desconto sobre o saldo projetado (R$ 1.207,69)", t.includes("Quitada em") && t.includes("R$ 1.207,69"));
  check("quitação: saiu da conta o valor REAL pago (19.207,69 - 300 - 8.000)", (await accountRow(N.accD)).includes("R$ 10.907,69"));

  // ---- planejamento (Supabase) ----
  const fillMain = (label, value) =>
    page.evaluate(
      (l, v) => {
        const lab = [...document.querySelectorAll("main label")].find((x) => x.textContent.trim().startsWith(l));
        if (!lab) throw new Error("campo não encontrado: " + l);
        const el = document.getElementById(lab.htmlFor);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      label,
      value,
    );
  await goto("/planejamento");
  t = await text();
  check("planejamento: cartões do topo, alertas e meses", ["Saldo inicial projetado", "Saldo final projetado", "Menor saldo no período", "Alertas", "Mês a mês"].every((x) => t.includes(x)));
  check("planejamento: 12 meses (cartão por mês)", (await page.$$eval('button[aria-label^="Detalhes de"]', (b) => b.length)) === 12);
  await page.evaluate(() => document.querySelector('button[aria-label^="Detalhes de"]').click());
  await wait(500);
  t = await page.evaluate(() => document.querySelector("dialog[open]")?.innerText ?? "");
  check("planejamento: o detalhe do mês atual lista a recorrência (despesas recorrentes) com o valor", t.includes(N.rec) && t.includes("Despesas recorrentes"));
  await shot("sb-planejamento-detalhe");
  await page.keyboard.press("Escape");
  await wait(300);
  await page.select('select[aria-label="Período"]', "3");
  await wait(300);
  check("planejamento: filtro de período (3 meses)", (await page.$$eval('button[aria-label^="Detalhes de"]', (b) => b.length)) === 3);
  await page.select('select[aria-label="Período"]', "12");
  await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Filtrar por pessoa"]');
    const opt = [...sel.options].find((o) => o.value !== "all");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await wait(400);
  check("planejamento: filtro por pessoa mantém a tela", (await text()).includes("Saldo inicial projetado"));
  await page.select('select[aria-label="Filtrar por pessoa"]', "all");
  await fillMain("O que vai comprar", "Notebook sim " + stamp);
  await fillMain("Valor total", "4.000,00");
  await fillMain("Parcelas", "10");
  await click("Simular");
  await wait(500);
  t = await text();
  check("simulador: impacto mensal e efeito no saldo (cartão em 10x)", t.includes("Efeito no saldo ao fim do período") && t.includes("Descartar simulação"));
  await shot("sb-planejamento-simulacao");
  await click("Descartar simulação");
  await wait(300);
  check("simulador: descartar remove o resultado", !(await text()).includes("Efeito no saldo ao fim do período"));
  await goto("/movimentacoes");
  check("simulador: NADA foi gravado (a simulação não vira movimentação)", !(await text()).includes("Notebook sim " + stamp));

  // ---- calendário (Supabase) ----
  await calendarChecks({ page, goto, click, text, check, wait, shot }, { prefix: "supabase ", pause: 900, names: { salary: N.salary, rec: N.rec, transfer: N.transfer, dinner: N.dinner } });

  // ---- dashboard combina as fontes ----
  const d = await dash();
  check("supabase: dashboard consistente (Despesas == gráfico; sem despesas = 0)", (d.spent ?? 0) === (d.chartTotal ?? 0));
  check("supabase: saldo em contas inclui a conta do Supabase", d.balance >= 200000);

  // ---- auditoria de UX/acessibilidade/duplo clique (Supabase) ----
  await dialogsAndKeyboard({ page, goto, click, fill, text, check, wait, shot, dash }, { prefix: "supabase ", pause: 900 });
  await doubleSubmit({ page, goto, click, fill, text, check, wait, shot, dash }, { prefix: "supabase ", pause: 1000, account: N.accD, category: "Mercado", stamp, payments: false });
  await sweep({ page, goto, check, wait }, { prefix: "supabase ", pause: 1000 });
  await page.setViewport({ width: 1280, height: 900 });

  // ---- cofrinhos e objetivos (Supabase; conta de teste da dívida, com saldo) ----
  const pocketOpts = { prefix: "supabase ", pause: 900, account: N.accD, category: "Mercado", stamp };
  await pocketChecks({ page, goto, click, fill, text, check, wait, shot, dash, allow400 }, pocketOpts);

  // ---- relatórios (Supabase) ----
  const reportsBefore = await reportsChecks({ page, goto, click, text, check, wait, shot, dash }, { prefix: "supabase ", pause: 1200 });
  await page.setViewport({ width: 1280, height: 900 });

  // ---- logout / login mantendo os dados ----
  await click("Menu do usuário", { starts: true });
  await click("Sair");
  await page.waitForFunction(() => location.pathname === "/login", { timeout: 15000 });
  await page.goto(BASE + "/contas", { waitUntil: "networkidle0" });
  check("logout: rota protegida volta ao login", pathOf().startsWith("/login"));
  await login();
  for (const [path, name] of [["/pessoas", N.person2], ["/categorias", N.cat2], ["/contas", N.acc2], ["/cartoes", N.card2]]) {
    await goto(path);
    check(`login novamente: ${path} mantém os dados`, (await text()).includes(name));
  }
  // Relatórios ANTES da limpeza dos cofrinhos (que zera a reserva): os números precisam ser os mesmos de antes do logout.
  await reportsPersistenceChecks({ page, goto, check, wait }, { prefix: "supabase ", pause: 1200 }, reportsBefore);
  await pocketPersistenceChecks({ page, goto, click, fill, text, check, wait, shot, dash }, pocketOpts);
  await goto("/movimentacoes");
  t = await text();
  check("login novamente: movimentações persistem (receita, despesa editada, transferência, compra)", [N.salary, N.marketEd, N.transfer, N.dinner].every((x) => t.includes(x)));
  await goto("/recorrencias");
  check("login novamente: a recorrência persiste", (await text()).includes(N.rec));
  await goto("/dividas");
  check("login novamente: a dívida quitada persiste", (await text()).includes("Quitadas e canceladas (1)"));
  check("login novamente: o saldo da conta reflete os pagamentos da dívida", (await accountRow(N.accD)).includes("R$ 10.907,69"));
  check("login novamente: saldos e limite persistem", (await accountRow(N.acc2)).includes("R$ 4.350,00") && /UtilizadoR\$ 0,00/.test(await cardRow(N.card2)));

  // ---- responsividade ----
  for (const [name, width, height] of [["mobile", 390, 844], ["tablet", 820, 1100], ["desktop", 1440, 900]]) {
    await page.setViewport({ width, height, isMobile: width < 500 });
    for (const path of ["/", "/movimentacoes", "/recorrencias", "/dividas", "/planejamento", "/calendario", "/pessoas", "/categorias", "/contas", "/cartoes"]) {
      await goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${name} ${path}: sem scroll horizontal`, overflow <= 0, `overflow=${overflow}`);
      await shot(`sb-${name}${path.replace("/", "-")}`);
    }
  }
  // diálogos em telas estreitas (formulário de compra no cartão)
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await goto("/movimentacoes");
  await click("Nova movimentação");
  await click("Compra no cartão", { starts: true, scope: "dialog" });
  await wait(250);
  const dlgOverflow = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    return d.scrollWidth - d.clientWidth;
  });
  check("mobile: formulário de movimentação sem overflow horizontal", dlgOverflow <= 0, "overflow=" + dlgOverflow);
  await shot("sb-mobile-form-cartao");
  await page.keyboard.press("Escape");
  await goto("/recorrencias");
  await click("Nova recorrência");
  await wait(250);
  const recOverflow = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    return d.scrollWidth - d.clientWidth;
  });
  check("mobile: formulário de recorrência sem overflow horizontal", recOverflow <= 0, "overflow=" + recOverflow);
  await shot("sb-mobile-form-recorrencia");
  await page.keyboard.press("Escape");
  await goto("/dividas");
  await click("Nova dívida");
  await wait(250);
  const debtOverflow = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    return d.scrollWidth - d.clientWidth;
  });
  check("mobile: formulário de dívida sem overflow horizontal", debtOverflow <= 0, "overflow=" + debtOverflow);
  await shot("sb-mobile-form-divida");
  await page.keyboard.press("Escape");
  await goto("/planejamento");
  await page.evaluate(() => document.querySelector('button[aria-label^="Detalhes de"]').click());
  await wait(400);
  const planOverflow = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    return d.scrollWidth - d.clientWidth;
  });
  check("mobile: detalhe do mês no planejamento sem overflow horizontal", planOverflow <= 0, "overflow=" + planOverflow);
  await shot("sb-mobile-planejamento-detalhe");
  await page.keyboard.press("Escape");
  await goto("/calendario");
  await wait(1500);
  const calOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile: calendário mensal sem overflow horizontal", calOverflow <= 0, "overflow=" + calOverflow);
  await shot("sb-mobile-calendario");
  await page.evaluate(() => document.querySelector('[data-testid="calendar-day"][aria-current="date"]').click());
  await wait(400);
  const dayOverflow = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    return d.scrollWidth - d.clientWidth;
  });
  check("mobile: dia do calendário (diálogo) sem overflow horizontal", dayOverflow <= 0, "overflow=" + dayOverflow);
  await page.keyboard.press("Escape");
  await page.setViewport({ width: 1280, height: 900 });

  // ---- limpeza (o que a interface permite excluir) ----
  // 1) pagamentos de fatura (reabrem a fatura); 2) as demais movimentações; 3) parcelas pela compra inteira.
  await goto("/movimentacoes");
  for (let i = 0; i < 4; i++) {
    const has = await page.evaluate((n) => [...document.querySelectorAll("main button")].some((b) => (b.getAttribute("aria-label") ?? "").startsWith("Ações de Fatura " + n)), N.card2);
    if (!has) break;
    await click("Ações de Fatura " + N.card2, { starts: true });
    await wait(150);
    await click("Excluir");
    await click("Excluir", { scope: "dialog" });
    await wait(2200);
  }
  for (const name of [N.dinner, N.marketEd, N.transfer, N.salary]) {
    await menu(name, "Excluir");
    await click("Excluir", { scope: "dialog" });
    await wait(2200);
  }
  await menu(N.laptop, "Excluir");
  await wait(400);
  await clickRadio("Compra inteira");
  await click("Excluir", { scope: "dialog" });
  await wait(1500);
  await goto("/movimentacoes");
  // (a ocorrência de recorrência de hoje permanece: regra e ocorrências não são excluíveis pela interface)
  t = await text();
  check("limpeza: movimentações de teste removidas (restam só as de recorrência)", [N.dinner, N.marketEd, N.transfer, N.salary, N.laptop].every((x) => !t.includes(x)));
  await goto("/contas");
  await click("Excluir " + N.acc3);
  await click("Excluir", { scope: "dialog" });
  await wait(2600);
  await goto("/cartoes");
  await click(`Excluir ${N.card2}`);
  await click("Excluir", { scope: "dialog" });
  await wait(2600);
  await goto("/contas");
  await click(`Excluir ${N.acc2}`);
  await click("Excluir", { scope: "dialog" });
  await wait(2600);
  await goto("/categorias");
  await click(`Excluir ${N.sub}`);
  await click("Excluir", { scope: "dialog" });
  await wait(2600);
  await click(`Excluir ${N.cat2}`);
  await click("Excluir", { scope: "dialog" });
  await wait(2600);
  await goto("/cartoes");
  check("limpeza: cartão de teste removido", !(await text()).includes(N.card2));
  await goto("/contas");
  check("limpeza: conta de teste removida", !(await text()).includes(N.acc2));
  await goto("/categorias");
  check("limpeza: categorias de teste removidas", !(await text()).includes(N.cat2) && !(await text()).includes(N.sub));
}
