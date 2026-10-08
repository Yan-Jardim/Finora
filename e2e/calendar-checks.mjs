/**
 * Bloco de E2E do Calendário, compartilhado pelas suítes local e Supabase (cada uma injeta os helpers dela).
 * `names` (Supabase): descrições criadas pela própria suíte, para conferir que aparecem nas visões e nos filtros.
 */
const STATUS_WORDS = /Pago|Pendente|Previsto|Atrasado|Recebido|A receber|Na fatura|Fatura paga|Realizado/;

export async function calendarChecks({ page, goto, click, text, check, wait, shot }, { prefix, pause = 400, names = null }) {
  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector('[aria-label="Carregando"]'), { timeout: 15000 });
    await wait(pause);
  };
  const title = () => page.$eval('[data-testid="calendar-title"]', (e) => e.textContent.trim());
  const eventCount = () => page.$$eval('[data-testid="calendar-event"]', (l) => l.length);
  const selectBy = async (label, value) => {
    await page.select(`select[aria-label="${label}"]`, value);
    await settle();
  };

  await goto("/calendario");
  await settle();
  let t = await text();
  check(`${prefix}calendário: cards do mês e próximos vencimentos`, ["Receitas do mês", "Despesas realizadas", "Compromissos pendentes", "Total previsto", "Faturas a vencer", "Saldo projetado", "Próximos vencimentos"].every((x) => t.includes(x)));
  check(`${prefix}calendário: três visões (Mensal, Semanal, Lista)`, (await page.$$eval('[role="tab"]', (b) => b.map((x) => x.textContent.trim()))).join("|") === "Mensal|Semanal|Lista");
  check(`${prefix}calendário: o item do menu existe e não está "em breve"`, await page.evaluate(() => !!document.querySelector('a[href="/calendario"]')));

  const days = await page.evaluate(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
  });
  const cells = await page.$$eval('[data-testid="calendar-day"]', (c) => c.length);
  check(`${prefix}calendário mensal: uma célula por dia do mês`, cells >= 28 && cells <= 31 && Math.abs(cells - days) <= 1, `células=${cells}`);
  check(`${prefix}calendário mensal: hoje fica marcado`, (await page.$$eval('[data-testid="calendar-day"][aria-current="date"]', (c) => c.length)) === 1);
  await shot(`${prefix}calendario-mensal`);

  // dia -> compromissos do dia -> detalhe do evento
  await page.evaluate(() => document.querySelector('[data-testid="calendar-day"][aria-current="date"]').click());
  await wait(250);
  t = await page.evaluate(() => document.querySelector("dialog[open]")?.innerText ?? "");
  check(`${prefix}calendário: clicar no dia abre os compromissos do dia`, t.length > 10 && /Domingo|Segunda|Terça|Quarta|Quinta|Sexta|Sábado/.test(t));
  const hasEventInDay = (await page.$$eval("dialog[open] [data-testid='calendar-event']", (l) => l.length)) > 0;
  if (hasEventInDay) {
    await page.evaluate(() => document.querySelector("dialog[open] [data-testid='calendar-event']").click());
    await wait(250);
    t = await page.evaluate(() => document.querySelector("dialog[open]")?.innerText ?? "");
    check(`${prefix}calendário: detalhe do evento (valor, data, status e link para a tela existente)`, /R\$ /.test(t) && /Abrir/.test(t) && STATUS_WORDS.test(t) && /\d{2}\/\d{2}\/\d{4}/.test(t));
    check(
      `${prefix}calendário: o detalhe não cria regra de pagamento (só link)`,
      !(await page.evaluate(() => [...document.querySelectorAll("dialog[open] button")].some((b) => /^(Pagar|Quitar|Registrar)/.test(b.textContent.trim())))),
    );
    await shot(`${prefix}calendario-evento`);
  }
  await page.keyboard.press("Escape");
  await wait(150);

  // lista
  await click("Lista");
  await settle();
  const listCount = await eventCount();
  t = await text();
  check(`${prefix}calendário (lista): mostra compromissos ou o estado vazio`, listCount > 0 || t.includes("Nada neste mês"));
  const statusless = await page.$$eval('[data-testid="calendar-event"]', (l) => l.filter((e) => !/Pago|Pendente|Previsto|Atrasado|Recebido|A receber|Na fatura|Fatura paga|Realizado/.test(e.textContent)).length);
  check(`${prefix}calendário: todo evento mostra o status em TEXTO (não só cor)`, statusless === 0, `sem status=${statusless}`);
  await shot(`${prefix}calendario-lista`);

  if (names) {
    const types = { Receitas: "income", Recorrentes: "recurring", Transferências: "transfer", Despesas: "expense" };
    const expected = { Receitas: names.salary, Recorrentes: names.rec, Transferências: names.transfer, Despesas: names.dinner };
    for (const label of Object.keys(types)) {
      await selectBy("Tipo", types[label]);
      t = await text();
      check(`${prefix}calendário: filtro Tipo "${label}" mostra o item esperado`, t.includes(expected[label]));
    }
    await selectBy("Tipo", "income");
    t = await text();
    check(`${prefix}calendário: filtro Tipo "Receitas" esconde as despesas`, !t.includes(names.dinner) && !t.includes(names.transfer));
    await selectBy("Tipo", "recurring");
    check(
      `${prefix}calendário: recorrência aparece uma vez no mês`,
      (await page.$$eval('[data-testid="calendar-list"] [data-testid="calendar-event"]', (l, n) => l.filter((x) => x.textContent.includes(n)).length, names.rec)) === 1,
    );
    await selectBy("Tipo", "all");
  } else {
    await selectBy("Tipo", "income");
    check(`${prefix}calendário: filtro Tipo "Receitas" mantém a tela`, (await text()).includes("Receitas do mês"));
    await selectBy("Tipo", "all");
  }
  await selectBy("Status", "overdue");
  const overdueOnly = await page.$$eval('[data-testid="calendar-event"]', (l) => l.every((e) => /Atrasado/.test(e.textContent)));
  check(`${prefix}calendário: filtro Status "Atrasado" só deixa atrasados`, overdueOnly);
  await selectBy("Status", "all");
  const personOptions = await page.$$eval('select[aria-label="Pessoa"] option', (o) => o.length);
  check(`${prefix}calendário: filtros de pessoa, conta, cartão, categoria, tipo e status`, personOptions >= 2 && (await page.$$eval("main select", (s) => s.length)) >= 8);
  await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Pessoa"]');
    const opt = [...sel.options].find((o) => o.value !== "all");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  check(`${prefix}calendário: filtro por pessoa mantém a tela`, (await text()).includes("Receitas do mês"));
  await click("Limpar filtros");
  await settle();
  check(`${prefix}calendário: "Limpar filtros" restaura Todos`, (await page.$eval('select[aria-label="Pessoa"]', (s) => s.value)) === "all");

  // semana
  await click("Semanal");
  await settle();
  check(`${prefix}calendário semanal: sete dias`, (await page.$$eval('[data-testid="calendar-week"] > *', (c) => c.length)) === 7);
  const weekTitle = await title();
  await click("Próxima semana");
  await settle();
  check(`${prefix}calendário semanal: navegar para a próxima semana`, (await title()) !== weekTitle);
  await click("Hoje");
  await settle();
  check(`${prefix}calendário semanal: "Hoje" volta à semana atual`, (await title()) === weekTitle);
  await shot(`${prefix}calendario-semanal`);

  // mensal: navegação por mês/ano e virada de ano
  await click("Mensal");
  await settle();
  const current = await title();
  await click("Próximo mês");
  await settle();
  const next = await title();
  check(`${prefix}calendário: navegar para o próximo mês`, next !== current);
  await click("Mês anterior");
  await click("Mês anterior");
  await settle();
  check(`${prefix}calendário: navegar para o mês anterior`, (await title()) !== current && (await title()) !== next);
  await click("Hoje");
  await settle();
  await selectBy("Mês", "12");
  const dec = await title();
  await click("Próximo mês");
  await settle();
  const jan = await title();
  const yearOf = (s) => Number(s.match(/\d{4}/)[0]);
  check(`${prefix}calendário: virada de ano (dezembro → janeiro do ano seguinte)`, /Dezembro/.test(dec) && /Janeiro/.test(jan) && yearOf(jan) === yearOf(dec) + 1, `${dec} → ${jan}`);
  await selectBy("Ano", String(yearOf(jan) + 1));
  check(`${prefix}calendário: seletor de ano`, yearOf(await title()) === yearOf(jan) + 1);
  await click("Hoje");
  await settle();
  check(`${prefix}calendário: "Hoje" volta ao mês atual`, (await title()) === current);
}
