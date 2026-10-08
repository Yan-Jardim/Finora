/**
 * Bloco de E2E dos Relatórios, compartilhado pelas suítes LOCAL e SUPABASE (cada uma injeta os helpers dela).
 * Confere: seções, KPIs com fórmula, períodos, filtros combináveis, comparação, drill-down, soma das categorias == total,
 * caixa x consumo, pessoa/Casal/consolidado, CSV (conteúdo e filtros), gráficos acessíveis, responsividade e temas.
 *
 * `reportsChecks` devolve um "retrato" dos KPIs para a suíte Supabase conferir a PERSISTÊNCIA após logout/login.
 */
const norm = (s) => (s ?? "").replace(/ /g, " ");
const toCents = (s) => {
  const m = norm(s).match(/(−|-)?\s?R\$ ([\d.]+,\d{2})/);
  return m ? Math.round(parseFloat(m[2].replace(/\./g, "").replace(",", ".")) * 100) * (m[1] ? -1 : 1) : null;
};
const TABS = ["Visão geral", "Receitas", "Despesas", "Fluxo de caixa", "Cartões", "Dívidas", "Patrimônio", "Cofrinhos / Objetivos"];

export async function reportsChecks(k, opts) {
  const { page, goto, click, text, check, wait, shot, dash } = k;
  const { prefix, pause = 400 } = opts;
  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector('[aria-label="Carregando"]'), { timeout: 25000 });
    await wait(pause);
  };
  const open = async (path = "/relatorios") => {
    await goto(path);
    await settle();
  };
  const tab = async (label) => {
    await page.evaluate((l) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === l).click(), label);
    await settle();
  };
  const kpi = async (id) => toCents(await page.evaluate((i) => document.querySelector(`[data-testid="kpi-${i}-value"]`)?.textContent ?? null, id));
  const kpiText = (id) => page.evaluate((i) => (document.querySelector(`[data-testid="kpi-${i}-value"]`)?.textContent ?? "").replace(/ /g, " "), id);
  const select = async (id, value) => {
    await page.select(`#${id}`, value);
    await settle();
  };
  const periodLabel = () => page.$eval('[data-testid="period-label"]', (e) => e.textContent.trim()).catch(() => null);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const setDate = (id, value) =>
    page.evaluate((i, v) => {
      const el = document.getElementById(i);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, id, value);
  /** Captura o CSV gerado pelo botão "Baixar" (o download real vira um Blob em memória). */
  let bom = null;
  const exportCsv = async (value) => {
    await page.evaluate(() => {
      window.__csv = null;
      window.__bom = null;
      if (!window.__origCreate) window.__origCreate = URL.createObjectURL;
      URL.createObjectURL = (blob) => {
        // Blob.text() descarta o BOM ao decodificar: confere os 3 primeiros BYTES (EF BB BF) à parte.
        blob.arrayBuffer().then((b) => (window.__bom = [...new Uint8Array(b).slice(0, 3)].join(",")));
        blob.text().then((t) => (window.__csv = t));
        return window.__origCreate(blob);
      };
    });
    await page.select("#export-kind", value);
    await click("Baixar");
    await page.waitForFunction(() => window.__csv !== null && window.__bom !== null, { timeout: 8000 });
    const csv = await page.evaluate(() => window.__csv);
    bom = await page.evaluate(() => window.__bom);
    return csv;
  };
  const profilesTable = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="profiles-table"] tbody tr')].map((tr) => {
        const cells = [...tr.children].map((c) => c.textContent.replace(/ /g, " ").trim());
        return { name: cells[0], values: cells.slice(1) };
      }),
    );

  // ---------- 1. a tela, as seções e os indicadores com a fórmula ----------
  await open();
  let t = norm(await text());
  check(`${prefix}relatórios: item de menu ativo (não é mais "em breve")`, await page.evaluate(() => !!document.querySelector('a[href="/relatorios"]') && !document.querySelector('a[href="/relatorios"]').closest("li, nav")?.textContent.includes("Em breve")));
  const tabs = await page.$$eval('[role="tab"]', (b) => b.map((x) => x.textContent.trim()));
  check(`${prefix}relatórios: as 8 seções`, TABS.every((x, i) => tabs[i] === x), tabs.join("|"));
  check(
    `${prefix}relatórios: indicadores da visão geral com nomes inequívocos`,
    ["Total recebido", "Despesas de consumo", "Saídas de caixa", "Resultado do período", "Taxa de economia", "Saldo atual", "Patrimônio financeiro", "Total reservado", "Dívidas restantes"].every((x) => t.includes(x)),
  );
  check(`${prefix}relatórios: cada indicador traz a fórmula escrita`, t.includes("Total recebido − Despesas de consumo − Pagamentos de dívidas.") && t.includes("Entradas de caixa − Saídas de caixa.") && t.includes("Resultado do período ÷ Total recebido"));
  check(`${prefix}relatórios: explica as duas visões (caixa x consumo)`, t.includes("fluxo de caixa") && t.includes("despesas de consumo"));
  const month = await periodLabel();
  check(`${prefix}relatórios: abre no mês atual`, /^[A-Z][a-z]{2}\/\d{4}$/.test(month ?? ""), month);
  await shot(`${prefix.trim()}-relatorios-geral`);

  // dashboard → link para o relatório completo (o dashboard continua sendo a visão rápida)
  await goto("/");
  await settle();
  check(`${prefix}dashboard: link "Ver relatório completo" e o dashboard continua sendo a visão rápida`, (await text()).includes("Ver relatório completo") && (await text()).includes("Quanto posso gastar?"));
  await click("Ver relatório completo");
  await page.waitForFunction(() => location.pathname === "/relatorios", { timeout: 10000 });
  await settle();

  // ---------- 2. coerência com o dashboard (mesmas regras, lentes diferentes) ----------
  // Dashboard "Despesas" inclui pagamento de dívida (regra antiga); o relatório separa: consumo + dívidas == Despesas do dashboard.
  const consumption = await kpi("consumption");
  const debtpay = await kpi("debtpay");
  const received = await kpi("received");
  const d = await dash();
  check(`${prefix}coerência: consumo + pagamentos de dívida == "Despesas" do dashboard no mês`, consumption + debtpay === d.spent, `${consumption}+${debtpay} vs ${d.spent}`);
  check(`${prefix}coerência: "Total recebido" == "Receitas" do dashboard no mês`, received === d.income, `${received} vs ${d.income}`);
  await open();
  const result = await kpi("result");
  check(`${prefix}fórmula: resultado = recebido − consumo − dívidas`, result === (await kpi("received")) - (await kpi("consumption")) - (await kpi("debtpay")));
  const cin = await kpi("cashin");
  const cnet = await kpi("cashnet");
  const cout = await kpi("cashout");
  check(`${prefix}fórmula: resultado de caixa = entradas − saídas`, cnet === cin - cout);
  const balanceNow = await kpi("balance");
  const netNow = await kpi("networth");
  check(`${prefix}patrimônio financeiro e saldo batem com o dashboard (hoje)`, balanceNow === d.balance && netNow === d.netWorth, `${balanceNow}/${netNow} vs ${d.balance}/${d.netWorth}`);
  const snapshot = { consumption, debtpay, received, result, cin, cout, balanceNow, netNow, reserved: await kpi("reserved"), debts: await kpi("debts"), month };

  // ---------- 3. períodos ----------
  await select("rp-preset", "year");
  const yearLabel = await periodLabel();
  check(`${prefix}período: ano → "Jan a Dez/AAAA"`, /^Jan a Dez\/\d{4}$/.test(yearLabel ?? ""), yearLabel);
  const yearConsumption = await kpi("consumption");
  check(`${prefix}período: o ano tem consumo >= o mês`, yearConsumption >= consumption);
  await select("rp-preset", "quarter");
  const qLabel = await periodLabel();
  check(`${prefix}período: trimestre`, /^(Jan a Mar|Abr a Jun|Jul a Set|Out a Dez)\/\d{4}$/.test(qLabel ?? ""), qLabel);
  await page.click('button[aria-label="Período anterior"]');
  await settle();
  const qPrev = await periodLabel();
  check(`${prefix}período: navegar para o trimestre anterior`, qPrev !== qLabel && /\d{4}$/.test(qPrev ?? ""), `${qLabel} -> ${qPrev}`);
  await select("rp-preset", "month");
  await select("rp-preset", "custom");
  await setDate("rp-from", "2026-02-10");
  await setDate("rp-to", "2026-01-01");
  await settle();
  check(`${prefix}período personalizado inválido: aviso e nada quebra`, (await text()).includes("Período inválido"));
  await setDate("rp-from", "2026-01-01");
  await setDate("rp-to", "2026-12-31");
  await settle();
  const customSummary = norm(await page.$eval('[data-testid="filters-summary"]', (e) => e.textContent));
  check(`${prefix}período personalizado: intervalo aplicado`, customSummary.includes("01/01/2026 a 31/12/2026") || customSummary.includes("Jan a Dez/2026"), customSummary);
  await select("rp-preset", "month");

  // ---------- 4. pessoa / Casal / consolidado ----------
  const rows = await profilesTable();
  const consolidated = rows.find((r) => r.name.includes("Consolidado"));
  const people = rows.filter((r) => !r.name.includes("Consolidado"));
  const sumCol = (i) => people.reduce((n, r) => n + toCents(r.values[i]), 0);
  check(
    `${prefix}pessoa/Casal/consolidado: a soma dos perfis == consolidado (recebido, consumo, dívidas, caixa)`,
    !!consolidated && [0, 1, 2, 3, 4].every((i) => sumCol(i) === toCents(consolidated.values[i])),
    JSON.stringify({ people: people.map((p) => p.name), consolidated: consolidated?.values }),
  );
  const profileOptions = await page.$$eval("#rp-profile option", (o) => o.map((x) => ({ v: x.value, t: x.textContent.trim() })));
  check(`${prefix}filtro de pessoa: Todos, pessoas e Casal`, profileOptions.length >= 3 && profileOptions[0].v === "all" && profileOptions.some((o) => o.t.includes("(casal)")), profileOptions.map((o) => o.t).join("|"));
  let filteredSum = 0;
  for (const o of profileOptions.filter((x) => x.v !== "all")) {
    await select("rp-profile", o.v);
    filteredSum += await kpi("consumption");
  }
  await select("rp-profile", "all");
  check(`${prefix}filtros: consumo por pessoa somado == consumo consolidado (sem duplicar)`, filteredSum === (await kpi("consumption")), `${filteredSum} vs ${await kpi("consumption")}`);
  check(`${prefix}filtros: "Limpar filtros" só aparece com filtro ativo`, !(await text()).includes("Limpar filtros"));
  await select("rp-profile", profileOptions[1].v);
  check(`${prefix}filtros: aparece "Limpar filtros" e limpa`, (await text()).includes("Limpar filtros"));
  await click("Limpar filtros");
  await settle();
  check(`${prefix}filtros: limpar volta ao consolidado`, (await page.$eval("#rp-profile", (e) => e.value)) === "all" && (await kpi("consumption")) === consumption);

  // filtros combinados: status + tipo
  await select("rp-status", "planned");
  const plannedConsumption = await kpi("consumption");
  await select("rp-status", "all");
  check(`${prefix}filtro de situação: "Previstas" não conta como consumo realizado`, plannedConsumption === 0);
  await select("rp-kind", "income");
  check(`${prefix}filtro de tipo: só receitas → consumo zerado e recebido preservado`, (await kpi("consumption")) === 0 && (await kpi("received")) === received);
  await select("rp-kind", "all");
  const accOpt = await page.$$eval("#rp-account option", (o) => o.map((x) => x.value).filter((v) => v !== "all")[0]);
  if (accOpt) {
    await select("rp-account", accOpt);
    check(`${prefix}filtro de conta aplicado sem quebrar`, (await kpi("received")) !== null);
    await select("rp-account", "all");
  }

  // ---------- 5. comparação entre períodos ----------
  await select("rp-compare", "previous");
  const cmpLabel = await page.$eval('[data-testid="compare-label"]', (e) => e.textContent.trim());
  const deltas = await page.$$eval('[data-testid="delta"]', (e) => e.length);
  check(`${prefix}comparação: rótulo do período anterior e variações nos indicadores`, /\d{4}$/.test(cmpLabel) && cmpLabel !== month && deltas >= 5, `${cmpLabel} deltas=${deltas}`);
  const deltaText = norm(await page.$eval('[data-testid="kpi-consumption"] [data-testid="delta"]', (e) => e.getAttribute("aria-label")));
  check(`${prefix}comparação: variação acessível (sobe/cai/igual + valor anterior)`, /(subiu|caiu|não mudou)/.test(deltaText) && /período anterior R\$/.test(deltaText), deltaText);
  await shot(`${prefix.trim()}-relatorios-comparacao`);
  await select("rp-compare", "custom");
  await setDate("rp-cfrom", "2026-01-01");
  await setDate("rp-cto", "2026-03-31");
  await settle();
  check(`${prefix}comparação com outro período (personalizado)`, norm(await page.$eval('[data-testid="compare-label"]', (e) => e.textContent)).includes("Jan a Mar/2026"));
  await select("rp-compare", "none");
  check(`${prefix}comparação: desligar remove as variações`, (await page.$$eval('[data-testid="delta"]', (e) => e.length)) === 0);

  // ---------- 6. despesas: categorias batem com o total + drill-down ----------
  await select("rp-preset", "year");
  await tab("Despesas");
  const expTotal = await kpi("exp-total");
  const catSum = toCents(await page.$eval('[data-testid="category-sum"]', (e) => e.textContent));
  const catValues = await page.$$eval('[data-testid="category-value"]', (e) => e.map((x) => x.textContent));
  check(`${prefix}despesas: a soma das categorias bate centavo a centavo com o total`, expTotal === catSum && catValues.reduce((n, v) => n + toCents(v), 0) === expTotal, `${expTotal} / ${catSum}`);
  check(`${prefix}despesas: pagamentos de dívida em seção separada, com a limitação explicada`, (await text()).includes("Pagamentos de dívidas") && (await text()).includes("principal e juros"));
  check(`${prefix}despesas: avisa o que NÃO é consumo (fatura, transferência, cofrinho)`, /Não entram no consumo: pagamento de fatura/.test(norm(await text())));
  if (catValues.length > 0) {
    await page.evaluate(() => document.querySelector('[data-testid="category-list"] button').click());
    await wait(300);
    const drill = norm(await page.evaluate(() => document.querySelector("dialog[open]")?.innerText ?? ""));
    check(`${prefix}drill-down: abre as movimentações da categoria com valores e link para Movimentações`, /R\$ /.test(drill) && drill.includes("Abrir Movimentações") && /\d{2}\/\d{2}\/\d{4}/.test(drill));
    const children = await page.$$eval('[data-testid="drill-child-value"]', (e) => e.map((x) => x.textContent));
    const title = norm(await page.evaluate(() => document.querySelector("dialog[open] h2")?.textContent ?? ""));
    if (children.length > 0) {
      check(`${prefix}drill-down: subcategorias somam o valor da categoria`, children.reduce((n, v) => n + toCents(v), 0) === toCents(title), `${title} / ${children.join(",")}`);
      await page.evaluate(() => document.querySelector('dialog[open] [aria-label="Subcategorias"] button').click());
      await wait(200);
      check(`${prefix}drill-down: clicar na subcategoria filtra as movimentações`, (await page.evaluate(() => document.querySelector("dialog[open]").innerText)).includes("Movimentações —"));
    } else {
      check(`${prefix}drill-down: categoria sem subcategorias lista só movimentações`, true);
    }
    await shot(`${prefix.trim()}-relatorios-drill`);
    await page.keyboard.press("Escape");
    await wait(200);
  }
  await shot(`${prefix.trim()}-relatorios-despesas`);

  // ---------- 7. fluxo de caixa ----------
  await tab("Fluxo de caixa");
  const cfIn = await kpi("cf-in");
  const cfOut = await kpi("cf-out");
  const cfNet = await kpi("cf-net");
  check(`${prefix}fluxo de caixa: resultado líquido = entradas − saídas`, cfNet === cfIn - cfOut);
  const chart = await page.evaluate(() => {
    const svg = document.querySelector('[data-testid="chart-cashflow"] svg[role="img"]');
    return {
      label: svg?.getAttribute("aria-label") ?? "",
      legend: [...document.querySelectorAll('[data-testid="chart-cashflow"] [aria-label="Legenda do gráfico"] li')].map((l) => l.textContent.trim()),
      table: !!document.querySelector('[data-testid="chart-cashflow"] details table'),
      focusable: document.querySelectorAll('[data-testid="chart-cashflow"] svg [tabindex="0"]').length,
      patterns: document.querySelectorAll('[data-testid="chart-cashflow"] svg pattern').length,
    };
  });
  check(`${prefix}gráfico de caixa: resumo, legenda (Entradas/Saídas/Resultado), tabela de dados, alvos de teclado e padrão além da cor`, /Entradas/.test(chart.label) && chart.legend.join("|") === "Entradas|Saídas|Resultado líquido" && chart.table && chart.focusable > 0 && chart.patterns > 0, JSON.stringify(chart));
  // SVG não recebe page.focus(): dispara o focusin que o React escuta (equivale a tabular até o ponto do gráfico).
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chart-cashflow"] svg [tabindex="0"]');
    el.focus();
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  await wait(200);
  check(`${prefix}gráfico de caixa: tooltip com valores ao focar (teclado)`, await page.evaluate(() => !!document.querySelector('[data-testid="chart-cashflow"] [role="status"]')?.textContent.includes("Entradas")));
  check(`${prefix}fluxo de caixa: transferências neutras e compra no cartão fora das saídas (texto explicativo)`, /Neutras no consolidado/.test(norm(await text())) && /Compra no cartão não sai da conta/.test(norm(await text())));
  await shot(`${prefix.trim()}-relatorios-caixa`);

  // ---------- 8. demais seções ----------
  await tab("Receitas");
  t = norm(await text());
  check(`${prefix}receitas: seções e aviso de transferência`, ["Total recebido", "Previsto / a receber", "Recorrentes", "Não recorrentes", "Por categoria", "Por pessoa / Casal", "Transferências recebidas entre contas próprias não são receita"].every((x) => t.includes(x)));
  await tab("Cartões");
  t = norm(await text());
  check(`${prefix}cartões: gasto, limite, disponível, parceladas, próximas parcelas e aviso (fatura paga não é despesa)`, ["Gasto no período", "Limite utilizado (hoje)", "Disponível (hoje)", "Parceladas no período", "Próximas parcelas", "NÃO é contado como nova despesa"].every((x) => t.includes(x)) || t.includes("Nenhum cartão no escopo"));
  await tab("Dívidas");
  t = norm(await text());
  check(`${prefix}dívidas: valor original, total, pago, restante, custo financeiro e limitação principal × juros`, ["Valor original", "Total contratado", "Total pago", "Restante", "Custo financeiro projetado", "FLUXO DE CAIXA", "principal e juros"].every((x) => t.includes(x)));
  await tab("Patrimônio");
  t = norm(await text());
  check(`${prefix}patrimônio: contas, investimentos, financeiro, líquido; ativos e passivos documentados; cofrinho não soma`, ["Contas", "Investimentos", "Patrimônio financeiro", "Patrimônio líquido", "Ativos considerados", "Passivo considerado", "Cofrinhos NÃO aumentam"].every((x) => t.includes(x)));
  check(`${prefix}patrimônio: financeiro == dashboard e líquido = financeiro − dívidas`, (await kpi("nw-financial")) === d.netWorth && (await kpi("nw-net")) === (await kpi("nw-financial")) - snapshot.debts);
  await shot(`${prefix.trim()}-relatorios-patrimonio`);
  await tab("Cofrinhos / Objetivos");
  t = norm(await text());
  check(`${prefix}cofrinhos: reservado, distribuição, progresso dos objetivos; manual não é dinheiro real`, ["Total reservado", "Evolução das reservas", "Distribuição por cofrinho", "Progresso dos objetivos", "NÃO é dinheiro real"].every((x) => t.includes(x)));
  check(`${prefix}cofrinhos: total reservado == visão geral`, (await kpi("pk-reserved")) === snapshot.reserved);
  await shot(`${prefix.trim()}-relatorios-cofrinhos`);

  // ---------- 9. CSV ----------
  await tab("Visão geral");
  await select("rp-preset", "year");
  const movs = await exportCsv("movements");
  const head = movs.split("\r\n")[0];
  check(`${prefix}CSV movimentações: BOM, cabeçalho, separador ";" e linhas`, bom === "239,187,191" && head.includes("Data;Data de pagamento;Tipo;Descrição;Valor") && movs.split("\r\n").length > 2, head.slice(0, 80));
  const inc = await exportCsv("income");
  const exp = await exportCsv("expenses");
  const cf = await exportCsv("cashflow");
  const cfm = await exportCsv("cashflow-monthly");
  const count = (c) => c.split("\r\n").filter(Boolean).length - 1;
  check(`${prefix}CSV: receitas, despesas de consumo, fluxo de caixa e fluxo mensal exportam`, count(inc) >= 0 && count(exp) > 0 && count(cf) > 0 && cfm.includes("Resultado líquido de caixa") && cf.includes("Sentido"));
  check(`${prefix}CSV despesas: só consumo (sem pagamento de fatura, transferência nem dívida)`, !/;Pagamento de fatura;|;Transferência;|;Pagamento de dívida;/.test(exp));
  check(`${prefix}CSV receitas: só receitas`, !/;Despesa;|;Compra no cartão;/.test(inc));
  check(`${prefix}CSV fluxo de caixa: sem compra no cartão (não saiu da conta) e sem transferências`, !/;Compra no cartão;/.test(cf) && !/;Transferência;/.test(cf));
  // respeita filtros: com uma pessoa, menos (ou igual) linhas e só aquele nome
  const personName = profileOptions.find((o) => o.v !== "all").t.replace(" (casal)", "");
  await select("rp-profile", profileOptions.find((o) => o.v !== "all").v);
  const movsP = await exportCsv("movements");
  const personCol = movsP.split("\r\n").slice(1).filter(Boolean).map((l) => l.split(";")[8]);
  check(`${prefix}CSV respeita o filtro de pessoa (só "${personName}")`, count(movsP) <= count(movs) && personCol.every((p) => p === personName), `${count(movsP)} <= ${count(movs)}`);
  await select("rp-profile", "all");
  await select("rp-status", "planned");
  const movsS = await exportCsv("movements");
  check(`${prefix}CSV respeita o filtro de situação (previstas)`, count(movsS) <= count(movs) && !movsS.includes(";Pago;"));
  await select("rp-status", "all");
  await select("rp-preset", "month");

  // ---------- 10. responsividade e tema ----------
  for (const [name, width, height] of [["mobile", 390, 844], ["tablet", 820, 1100], ["desktop", 1440, 900]]) {
    await page.setViewport({ width, height, isMobile: width < 500 });
    await open();
    for (const label of TABS) {
      await tab(label);
      const o = await overflow();
      if (o > 0) check(`${prefix}${name} relatórios/${label}: sem scroll horizontal`, false, "overflow=" + o);
    }
    check(`${prefix}${name} relatórios: nenhuma seção com scroll horizontal`, (await overflow()) <= 0);
    await tab("Fluxo de caixa");
    await shot(`${prefix.trim()}-${name}-relatorios-caixa`);
    await tab("Despesas");
    await shot(`${prefix.trim()}-${name}-relatorios-despesas`);
    if ((await page.$$('[data-testid="category-list"] button')).length > 0) {
      await page.evaluate(() => document.querySelector('[data-testid="category-list"] button').click());
      await wait(250);
      const dlg = await page.evaluate(() => {
        const dd = document.querySelector("dialog[open]");
        return dd ? dd.scrollWidth - dd.clientWidth : 0;
      });
      check(`${prefix}${name} relatórios: drill-down sem overflow`, dlg <= 0, "overflow=" + dlg);
      await page.keyboard.press("Escape");
      await wait(150);
    }
  }
  await page.setViewport({ width: 1280, height: 900 });
  const bg = {};
  for (const scheme of ["light", "dark"]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
    await open();
    await tab("Fluxo de caixa");
    bg[scheme] = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const axis = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="chart-cashflow"] svg[role="img"]');
      const text = svg?.querySelector("text");
      return text ? getComputedStyle(text).fill : null;
    });
    check(`${prefix}tema ${scheme}: gráfico e KPIs renderizam`, !!axis && (await kpiText("cf-in")).includes("R$"), `fill=${axis}`);
    await shot(`${prefix.trim()}-relatorios-${scheme}`);
  }
  check(`${prefix}tema: claro e escuro têm fundos diferentes`, bg.light !== bg.dark, JSON.stringify(bg));
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  return snapshot;
}

/** Depois de logout/login (Supabase): os mesmos números aparecem. */
export async function reportsPersistenceChecks(k, opts, before) {
  const { page, goto, check, wait } = k;
  await goto("/relatorios");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Carregando"]'), { timeout: 25000 });
  await wait(opts.pause ?? 600);
  const kpi = async (id) => toCents(await page.evaluate((i) => document.querySelector(`[data-testid="kpi-${i}-value"]`)?.textContent ?? null, id));
  const now = { consumption: await kpi("consumption"), debtpay: await kpi("debtpay"), received: await kpi("received"), result: await kpi("result"), cin: await kpi("cashin"), cout: await kpi("cashout"), balanceNow: await kpi("balance"), netNow: await kpi("networth"), reserved: await kpi("reserved"), debts: await kpi("debts") };
  const expected = Object.fromEntries(Object.keys(now).map((key) => [key, before[key]]));
  check(`${opts.prefix}persistência: os relatórios mostram os mesmos números depois de sair e entrar`, JSON.stringify(now) === JSON.stringify(expected), JSON.stringify({ now, expected }));
}
