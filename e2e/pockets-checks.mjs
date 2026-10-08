/**
 * Bloco de E2E de Cofrinhos e Objetivos, compartilhado pelas suítes LOCAL e SUPABASE (cada uma injeta os helpers dela).
 *
 * opts:
 *  - prefix ........ prefixo dos nomes dos checks ("local " / "supabase ").
 *  - pause ......... espera após ações (Supabase é mais lento).
 *  - account ....... trecho do nome da conta de CONSUMO usada (precisa ter pelo menos R$ 600 livres).
 *  - category ...... nome de uma categoria de despesa existente (ex.: "Mercado").
 *  - stamp ......... sufixo único dos nomes criados.
 *  - legacy ........ (local) { accountId }: monta cofrinhos da versão anterior no localStorage para testar a importação.
 *
 * Saldo e reserva são conferidos pela tela; "Disponível de verdade" e patrimônio pelo dashboard (`dash`).
 */
import { doubleClick } from "./audit-checks.mjs";

const norm = (s) => (s ?? "").replace(/ /g, " ");
const toCents = (s) => {
  if (s == null) return null;
  const m = norm(s).match(/(−|-)?\s?R\$ ([\d.]+,\d{2})/);
  if (!m) return null;
  return Math.round(parseFloat(m[2].replace(/\./g, "").replace(",", ".")) * 100) * (m[1] ? -1 : 1);
};
const brl = (c) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100).replace(/ /g, " ");
const UNSAFE = /sqlstate|p0001|violates|constraint|duplicate key|pgrst|exception/i;

export async function pocketChecks(k, opts) {
  const { page, goto, click, fill, text, check, wait, shot, dash } = k;
  const { prefix, pause = 500, account, category, stamp, legacy } = opts;
  const P = {
    a: `Cofrinho A E2E ${stamp}`,
    aEd: `Cofrinho A E2E ${stamp} ed`,
    b: `Cofrinho B E2E ${stamp}`,
    gManual: `Meta manual E2E ${stamp}`,
    gLinked: `Meta ligada E2E ${stamp}`,
    gOther: `Meta outra E2E ${stamp}`,
    use1: `Compra parcial E2E ${stamp}`,
    use2: `Compra total E2E ${stamp}`,
  };
  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector('[aria-label="Carregando"]'), { timeout: 20000 });
    await wait(pause);
  };

  // ---------- helpers de tela ----------
  const section = (name) =>
    page.evaluate((n) => (document.querySelector(`section[aria-label="Cofrinho ${n}"]`)?.innerText ?? "").replace(/\u00a0/g, " "), name).catch(() => "");
  const hasCard = (name) => page.evaluate((n) => !!document.querySelector(`section[aria-label="Cofrinho ${n}"]`), name);
  const cardMoney = async (name, testid) =>
    toCents(await page.evaluate((n, id) => document.querySelector(`section[aria-label="Cofrinho ${n}"] [data-testid="${id}"]`)?.textContent ?? null, name, testid));
  /** Livre e reservado da CONTA, como o cofrinho mostra. */
  const accountPos = async (name) => {
    const t = norm(await page.evaluate((n) => document.querySelector(`section[aria-label="Cofrinho ${n}"] [data-testid="pocket-account-free"]`)?.textContent ?? "", name));
    const [free, reserved] = [...t.matchAll(/(−|-)?\s?R\$ [\d.]+,\d{2}/g)].map((m) => toCents(m[0]));
    return { free, reserved };
  };
  const inCard = (name, label) =>
    page.evaluate(
      (n, l) => {
        const root = document.querySelector(`section[aria-label="Cofrinho ${n}"]`);
        if (!root) throw new Error("cofrinho não encontrado: " + n);
        const el = [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === l || (b.getAttribute("aria-label") ?? "") === l);
        if (!el) throw new Error("botão não encontrado: " + l);
        el.click();
      },
      name,
      label,
    );
  const buttonState = (name, label) =>
    page.evaluate(
      (n, l) => {
        const root = document.querySelector(`section[aria-label="Cofrinho ${n}"]`);
        const el = root && [...root.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "") === l || b.textContent.trim() === l);
        return el ? { found: true, disabled: el.disabled } : { found: false, disabled: false };
      },
      name,
      label,
    );
  const pick = (label, optionText) =>
    page.evaluate(
      (l, o) => {
        const lab = [...document.querySelectorAll("dialog[open] label")].find((x) => x.textContent.trim().startsWith(l));
        if (!lab) throw new Error("campo não encontrado: " + l);
        const sel = document.getElementById(lab.htmlFor);
        const opt = [...sel.options].find((x) => x.textContent.includes(o));
        if (!opt) throw new Error("opção não encontrada: " + o + " em " + l);
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      },
      label,
      optionText,
    );
  const dialogText = () => page.evaluate(() => (document.querySelector("dialog[open]")?.innerText ?? "").replace(/ /g, " "));
  const toastOrBody = async () => norm(await text());
  const submit = async (label) => {
    await click(label, { scope: "dialog" });
    await wait(pause + 1200);
  };
  /** DOIS cliques seguidos: o resultado esperado (saldo, reserva) só bate se a operação rodou UMA vez. */
  const dsubmit = async (label) => {
    await doubleClick(page, label);
    await wait(pause + 1200);
  };
  /** Espera (com sondagem) até a condição valer: o Supabase tem latência entre a ação e a tela refletir. */
  const until = async (fn, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const value = await fn().catch(() => null);
      if (value) return value;
      if (Date.now() > end) return null;
      await wait(300);
    }
  };
  const open = async (path) => {
    await goto(path);
    await settle();
  };
  const overflowOf = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const dialogOverflow = () =>
    page.evaluate(() => {
      const d = document.querySelector("dialog[open]");
      return d ? d.scrollWidth - d.clientWidth : 0;
    });
  const closeDialog = async () => {
    await page.keyboard.press("Escape");
    await wait(200);
  };
  const clickCheckboxByText = (label) =>
    page.evaluate((l) => {
      const lab = [...document.querySelectorAll("dialog[open] label")].find((x) => x.textContent.includes(l));
      if (!lab) throw new Error("checkbox não encontrado: " + l);
      lab.querySelector("input[type=checkbox]").click();
    }, label);
  const rowMenu = async (desc, item) => {
    await click("Ações de " + desc);
    await wait(150);
    await click(item);
  };
  const rowInfo = (desc) =>
    page.evaluate(
      (n) => {
        const li = [...document.querySelectorAll("main li")].find((l) => l.textContent.includes(n));
        return li ? { text: li.textContent.replace(/ /g, " ") } : null;
      },
      desc,
    );
  const menuItems = async (desc) => {
    // Sem nenhuma ação possível o menu nem existe (ex.: despesa já estornada).
    if (!(await page.evaluate((d) => !!document.querySelector(`button[aria-label="Ações de ${d}"]`), desc))) return [];
    await click("Ações de " + desc);
    await wait(150);
    const items = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim()));
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.body.click());
    await wait(100);
    return items;
  };

  // ---------- 0. a tela existe e o menu não está "em breve" ----------
  await open("/cofrinhos");
  let t = await text();
  check(`${prefix}cofrinhos: item de menu ativo e tela funcional`, (await page.evaluate(() => !!document.querySelector('a[href="/cofrinhos"]'))) && (t.includes("Novo cofrinho") || t.includes("Total reservado")));
  check(`${prefix}objetivos: item de menu ativo`, await page.evaluate(() => !!document.querySelector('a[href="/objetivos"]')));
  check(`${prefix}cofrinhos: cartões do topo (Total reservado e Dinheiro livre)`, t.includes("Total reservado") && t.includes("Dinheiro livre"));

  // ---------- 1. criar ----------
  const dashBefore = await dash();
  await open("/cofrinhos");
  await click("Novo cofrinho");
  await wait(250);
  await fill("Nome", P.a);
  await pick("Conta vinculada", account);
  await fill("Reserva inicial", "300,00");
  t = await dialogText();
  check(`${prefix}criar cofrinho: mostra o livre da conta antes e depois da reserva inicial`, /Livre na conta agora/.test(t) && /depois/.test(t));
  await shot(`${prefix.trim()}-cofrinho-form`);
  await submit("Criar cofrinho");
  await settle();
  check(`${prefix}criar cofrinho: aparece com saldo reservado de R$ 300,00`, (await hasCard(P.a)) && (await cardMoney(P.a, "pocket-balance")) === 30000);
  let sec = await section(P.a);
  check(`${prefix}cofrinho: card mostra nome, responsável, conta, status e livre da conta`, sec.includes(P.a) && sec.includes("Ativo") && sec.includes(account) && /Livre na conta/.test(sec) && /Saldo reservado/.test(sec));
  const afterCreate = await dash();
  check(`${prefix}criar com reserva: "Disponível de verdade" cai 300,00 e o patrimônio NÃO muda`, afterCreate.available === dashBefore.available - 30000 && afterCreate.netWorth === dashBefore.netWorth, `${dashBefore.available}->${afterCreate.available}`);
  check(`${prefix}criar cofrinho: não criou despesa nem receita (Despesas do mês iguais)`, afterCreate.spent === dashBefore.spent && afterCreate.income === dashBefore.income);

  // ---------- 2. editar (conta não muda) ----------
  await open("/cofrinhos");
  await inCard(P.a, `Editar ${P.a}`);
  await wait(250);
  t = await dialogText();
  check(`${prefix}editar cofrinho: a conta vinculada NÃO pode ser trocada (campo fixo)`, t.includes("não pode ser trocada") && (await page.evaluate(() => [...document.querySelectorAll("dialog[open] label")].find((l) => l.textContent.startsWith("Conta vinculada")) && document.getElementById([...document.querySelectorAll("dialog[open] label")].find((l) => l.textContent.startsWith("Conta vinculada")).htmlFor)?.tagName !== "SELECT")));
  check(`${prefix}editar cofrinho: não oferece reserva inicial`, !t.includes("Reserva inicial"));
  await fill("Nome", P.aEd);
  await submit("Salvar alterações");
  await settle();
  check(`${prefix}editar cofrinho: renomeia e mantém o saldo`, (await hasCard(P.aEd)) && !(await hasCard(P.a)) && (await cardMoney(P.aEd, "pocket-balance")) === 30000);

  // ---------- 3. reservar ----------
  await open("/cofrinhos");
  const posBefore = await accountPos(P.aEd);
  const dashR0 = await dash();
  await open("/cofrinhos");
  await inCard(P.aEd, "Reservar");
  await wait(250);
  await fill("Valor a reservar", "100,00");
  await wait(150);
  t = await dialogText();
  check(`${prefix}reservar: mostra Saldo da conta, Reservado, Livre atual, Quanto será reservado e Livre depois`, ["Saldo da conta", "Reservado", "Livre atual", "Quanto será reservado", "Livre depois da reserva"].every((x) => t.includes(x)));
  check(`${prefix}reservar: prévia = livre atual − 100,00`, t.includes(brl(posBefore.free)) && t.includes(brl(posBefore.free - 10000)), `livre=${posBefore.free}`);
  check(`${prefix}reservar: avisa que não é despesa, receita nem transferência`, /não é uma despesa, receita nem transferência/.test(t));
  await shot(`${prefix.trim()}-cofrinho-reservar`);
  await dsubmit("Reservar");
  await settle();
  const posR = await accountPos(P.aEd);
  check(`${prefix}reservar: cofrinho 400,00, livre −100,00 e reservado da conta +100,00`, (await cardMoney(P.aEd, "pocket-balance")) === 40000 && posR.free === posBefore.free - 10000 && posR.reserved === posBefore.reserved + 10000, JSON.stringify([posBefore, posR]));
  const dashR1 = await dash();
  check(`${prefix}reservar: "Disponível de verdade" −100,00; saldo e patrimônio inalterados; sem despesa`, dashR1.available === dashR0.available - 10000 && dashR1.balance === dashR0.balance && dashR1.netWorth === dashR0.netWorth && dashR1.spent === dashR0.spent);

  // erro traduzido: reservar além do livre
  await open("/cofrinhos");
  await inCard(P.aEd, "Reservar");
  await wait(250);
  await fill("Valor a reservar", "99.999.999,00");
  k.allow400?.(true);
  await submit("Reservar");
  k.allow400?.(false);
  const body = await toastOrBody();
  check(`${prefix}erro insufficient_free: mostra pedido, livre e quanto falta (sem texto técnico)`, /Saldo livre insuficiente/.test(body) && /você pediu/.test(body) && /faltam/.test(body) && !UNSAFE.test(body), body.match(/Saldo livre[^.]*\./)?.[0]);
  await closeDialog();

  // ---------- 4. retirar ----------
  await open("/cofrinhos");
  const posW0 = await accountPos(P.aEd);
  const dashW0 = await dash();
  await open("/cofrinhos");
  await inCard(P.aEd, "Retirar");
  await wait(250);
  await fill("Valor a retirar", "50,00");
  await wait(150);
  t = await dialogText();
  check(`${prefix}retirar: mostra Reservado atual, Valor a retirar, Reservado restante e Livre da conta depois`, ["Reservado atual", "Valor a retirar", "Reservado restante", "Livre da conta depois da retirada"].every((x) => t.includes(x)));
  await dsubmit("Retirar");
  await settle();
  const posW1 = await accountPos(P.aEd);
  check(`${prefix}retirar: cofrinho 350,00 e livre +50,00 (saldo bancário não muda)`, (await cardMoney(P.aEd, "pocket-balance")) === 35000 && posW1.free === posW0.free + 5000);
  const dashW1 = await dash();
  check(`${prefix}retirar: "Disponível de verdade" +50,00; saldo em contas inalterado`, dashW1.available === dashW0.available + 5000 && dashW1.balance === dashW0.balance);
  await open("/cofrinhos");
  await inCard(P.aEd, "Retirar");
  await wait(250);
  await fill("Valor a retirar", "99.999,00");
  k.allow400?.(true);
  await submit("Retirar");
  k.allow400?.(false);
  check(`${prefix}erro insufficient_pocket: informa quanto o cofrinho tem e quanto falta`, /O cofrinho tem só/.test(await toastOrBody()) && !UNSAFE.test(await toastOrBody()));
  await closeDialog();

  // ---------- 5. transferir ----------
  await open("/cofrinhos");
  await click("Novo cofrinho");
  await wait(250);
  await fill("Nome", P.b);
  await pick("Conta vinculada", account);
  await submit("Criar cofrinho");
  await settle();
  check(`${prefix}segundo cofrinho criado vazio (R$ 0,00)`, (await hasCard(P.b)) && (await cardMoney(P.b, "pocket-balance")) === 0);
  const posT0 = await accountPos(P.aEd);
  await inCard(P.aEd, "Transferir");
  await wait(250);
  await pick("Destino", P.b);
  await fill("Valor", "50,00");
  await wait(150);
  t = await dialogText();
  check(`${prefix}transferir: mostra Origem, Destino e Valor e que não altera o saldo nem o reservado total`, t.includes("Origem") && t.includes("Destino") && t.includes("Valor") && /não mudam/.test(t));
  await shot(`${prefix.trim()}-cofrinho-transferir`);
  await submit("Transferir");
  await settle();
  const posT1 = await accountPos(P.aEd);
  check(`${prefix}transferir: origem 300,00, destino 50,00; livre e reservado da conta iguais`, (await cardMoney(P.aEd, "pocket-balance")) === 30000 && (await cardMoney(P.b, "pocket-balance")) === 5000 && posT1.free === posT0.free && posT1.reserved === posT0.reserved);

  // ---------- 6. histórico ----------
  await inCard(P.aEd, `Histórico de ${P.aEd}`);
  await wait(pause + 500);
  t = await dialogText();
  check(`${prefix}histórico: tipos amigáveis (Reserva, Retirada, Transferência enviada) com data e valor`, ["Reserva", "Retirada", "Transferência enviada"].every((x) => t.includes(x)) && /\d{2}\/\d{2}\/\d{4}/.test(t) && /R\$ 50,00/.test(t) && !/transfer_out|withdraw|reserve/.test(t));
  await shot(`${prefix.trim()}-cofrinho-historico`);
  check(`${prefix}histórico: nome do tipo "Reserva" tem a observação/valor da reserva inicial (R$ 300,00)`, t.includes("R$ 300,00"));
  await closeDialog();
  await inCard(P.b, `Histórico de ${P.b}`);
  await wait(pause + 500);
  check(`${prefix}histórico do destino: "Transferência recebida"`, (await dialogText()).includes("Transferência recebida"));
  await closeDialog();

  // ---------- 7. arquivar (só sem saldo) / reativar ----------
  let st = await buttonState(P.b, `Arquivar ${P.b}`);
  check(`${prefix}arquivar: BLOQUEADO enquanto houver saldo (botão desabilitado e orientação)`, st.found && st.disabled && (await section(P.b)).includes("retire a reserva antes"));
  await inCard(P.b, "Retirar");
  await wait(250);
  await fill("Valor a retirar", "50,00");
  await submit("Retirar");
  await settle();
  st = (await until(async () => {
    const x = await buttonState(P.b, `Arquivar ${P.b}`);
    return x.found && !x.disabled ? x : null;
  })) ?? (await buttonState(P.b, `Arquivar ${P.b}`));
  check(`${prefix}arquivar: liberado com saldo zero`, st.found && !st.disabled, (await section(P.b)).replace(/\s+/g, " ").slice(0, 160));
  await inCard(P.b, `Arquivar ${P.b}`);
  await wait(pause + 800);
  await settle();
  t = (await until(async () => (/Arquivados \(\d+\)/.test(await text()) ? await text() : null))) ?? (await text());
  check(`${prefix}arquivar: vai para "Arquivados" com o selo Arquivado`, /Arquivados \(\d+\)/.test(t));
  await page.evaluate(() => [...document.querySelectorAll("summary")].find((s) => s.textContent.includes("Arquivados"))?.click());
  await wait(200);
  check(`${prefix}arquivar: card arquivado sem ações de movimentação`, (await section(P.b)).includes("Arquivado") && !(await buttonState(P.b, "Reservar")).found);
  await until(async () => (await buttonState(P.b, `Reativar ${P.b}`)).found);
  await inCard(P.b, `Reativar ${P.b}`);
  await wait(pause + 800);
  await settle();
  check(`${prefix}reativar: volta a ficar ativo`, !!(await until(async () => (await section(P.b)).includes("Ativo"))));

  // ---------- 8. usar a reserva em despesa (parcial e total) ----------
  const newExpense = async (desc, amount, usePocket, fromAmount) => {
    await open("/movimentacoes");
    await click("Nova movimentação");
    await click("Despesa", { starts: true, scope: "dialog" });
    await wait(200);
    await fill("Descrição", desc);
    await fill("Valor", amount);
    await pick("Conta", account);
    await pick("Categoria", category);
    await wait(150);
    if (usePocket) {
      await clickCheckboxByText("Usar dinheiro de um cofrinho");
      await wait(150);
      await pick("Cofrinho", P.aEd);
      if (fromAmount) await fill("Valor da reserva a utilizar", fromAmount);
      await wait(150);
    }
  };
  await open("/cofrinhos");
  const posU0 = await accountPos(P.aEd);
  const balU0 = (await dash()).balance;
  const availU0 = (await dash()).available;
  await newExpense(P.use1, "100,00", true, "40,00");
  t = await dialogText();
  check(`${prefix}usar reserva (parcial): resumo — saldo cai 100,00, cofrinho cai 40,00, livre cai só 60,00`, /Saldo da conta cai\s*R\$ 100,00/.test(t) && /Cofrinho cai\s*R\$ 40,00/.test(t) && /Dinheiro livre cai apenas\s*R\$ 60,00/.test(t), t.slice(t.indexOf("Usar dinheiro"), t.indexOf("Usar dinheiro") + 400));
  await shot(`${prefix.trim()}-despesa-usa-cofrinho`);
  await dsubmit("Registrar");
  await settle();
  await open("/cofrinhos");
  const posU1 = await accountPos(P.aEd);
  check(`${prefix}uso parcial: cofrinho 260,00 e livre da conta cai apenas 60,00`, (await cardMoney(P.aEd, "pocket-balance")) === 26000 && posU1.free === posU0.free - 6000 && posU1.reserved === posU0.reserved - 4000, JSON.stringify([posU0, posU1]));
  const dashU1 = await dash();
  check(`${prefix}uso parcial: saldo em contas −100,00 e "Disponível de verdade" −60,00 (sem dupla contagem)`, dashU1.balance === balU0 - 10000 && dashU1.available === availU0 - 6000, `${balU0}/${availU0} -> ${dashU1.balance}/${dashU1.available}`);
  await newExpense(P.use2, "30,00", true, "");
  await dsubmit("Registrar");
  await settle();
  await open("/cofrinhos");
  const cardU2 = await cardMoney(P.aEd, "pocket-balance");
  const dashU2 = await dash();
  check(`${prefix}uso total: cofrinho 230,00 e "Disponível de verdade" NÃO muda (reserva cobre a despesa inteira)`, cardU2 === 23000 && dashU2.available === dashU1.available && dashU2.balance === dashU1.balance - 3000);

  // ---------- 9. despesa ligada: sem Excluir, com Estornar ----------
  await open("/movimentacoes");
  const row = await rowInfo(P.use1);
  check(`${prefix}despesa com cofrinho: mostra o selo do cofrinho`, !!row && row.text.includes("Cofrinho:") && row.text.includes(P.aEd));
  const items = await menuItems(P.use1);
  check(`${prefix}despesa com cofrinho: NÃO mostra "Excluir" e mostra "Estornar"`, !items.includes("Excluir") && items.includes("Estornar"), items.join("|"));
  await shot(`${prefix.trim()}-despesa-estornar-menu`);
  await rowMenu(P.use1, "Estornar");
  await wait(250);
  t = await dialogText();
  check(`${prefix}estorno: explica despesa cancelada, saldo restaurado, valor usado volta ao cofrinho e histórico preservado`, /ficará como cancelada/.test(t) && /saldo da conta será restaurado/.test(t) && /valor efetivamente usado da reserva voltará ao cofrinho/.test(t) && /histórico será preservado/.test(t));
  await dsubmit("Estornar");
  await settle();
  check(`${prefix}estorno com duplo clique: sem erro de "já estornado" (a operação rodou uma vez)`, !/já foi estornado/.test(norm(await text())));
  const rowAfter = await rowInfo(P.use1);
  check(`${prefix}estorno: a despesa fica cancelada/estornada e sem novo estorno`, !!rowAfter && /Estornada|Cancelado/.test(rowAfter.text) && !(await menuItems(P.use1)).includes("Estornar"));
  await open("/cofrinhos");
  const cardU3 = await cardMoney(P.aEd, "pocket-balance");
  const dashU3 = await dash();
  await open("/cofrinhos");
  check(`${prefix}estorno: só os 40,00 usados voltam ao cofrinho (270,00) e a despesa inteira volta ao saldo`, cardU3 === 27000 && dashU3.balance === dashU2.balance + 10000, `${dashU2.balance}->${dashU3.balance}`);
  await inCard(P.aEd, `Histórico de ${P.aEd}`);
  await wait(pause + 500);
  t = await dialogText();
  check(`${prefix}histórico: "Utilizado em despesa" e "Estorno" preservados, com a despesa vinculada`, t.includes("Utilizado em despesa") && t.includes("Estorno") && t.includes("Despesa vinculada"));
  await closeDialog();

  // ---------- 10. objetivos ----------
  await open("/objetivos");
  await click("Novo objetivo");
  await wait(250);
  await fill("Nome", P.gManual);
  await fill("Valor da meta", "1.000,00");
  await fill("Progresso informado manualmente", "250,00");
  await submit("Criar objetivo");
  await settle();
  const goalText = (name) => page.evaluate((n) => (document.querySelector(`section[aria-label="Objetivo ${n}"]`)?.innerText ?? "").replace(/\u00a0/g, " "), name).catch(() => "");
  const goalCurrent = async (name) => toCents(await page.evaluate((n) => document.querySelector(`section[aria-label="Objetivo ${n}"] [data-testid="goal-current"]`)?.textContent ?? null, name));
  let g = await goalText(P.gManual);
  check(`${prefix}objetivo manual: "Progresso informado manualmente" e valor 250,00 de 1.000,00 (25%)`, g.includes("Progresso informado manualmente") && (await goalCurrent(P.gManual)) === 25000 && g.includes("25%") && !g.includes("Reservado em cofrinho"));
  const dashG = await dash();
  await open("/objetivos");
  check(`${prefix}objetivo manual: NÃO entra no reservado nem no disponível`, dashG.available === dashU3.available);
  await shot(`${prefix.trim()}-objetivos`);

  await click("Novo objetivo");
  await wait(250);
  await fill("Nome", P.gLinked);
  await fill("Valor da meta", "600,00");
  await fill("Progresso informado manualmente", "100,00");
  await fill("Prazo", "2030-12-31");
  await submit("Criar objetivo");
  await settle();
  await click("Novo objetivo");
  await wait(250);
  await fill("Nome", P.gOther);
  await fill("Valor da meta", "300,00");
  await submit("Criar objetivo");
  await settle();

  // vincular: aviso exato
  await click(`Vincular cofrinho a ${P.gLinked}`);
  await wait(250);
  await pick("Cofrinho", P.aEd);
  await wait(150);
  t = await dialogText();
  check(
    `${prefix}vincular: avisa ANTES que o valor manual será substituído e não será restaurado`,
    t.includes("O progresso informado manualmente será substituído pelo valor realmente reservado neste cofrinho. O valor manual anterior não será restaurado automaticamente se você desvincular depois."),
  );
  await shot(`${prefix.trim()}-objetivo-vincular`);
  await submit("Vincular cofrinho");
  await settle();
  g = await goalText(P.gLinked);
  check(`${prefix}objetivo vinculado: "Reservado em cofrinho" e progresso = saldo real do cofrinho (270,00)`, g.includes("Reservado em cofrinho") && (await goalCurrent(P.gLinked)) === 27000 && !g.includes("Progresso informado manualmente"), g);
  check(`${prefix}objetivo: mostra o prazo`, g.includes("31/12/2030"));
  // progresso acompanha o cofrinho
  await open("/cofrinhos");
  await inCard(P.aEd, "Retirar");
  await wait(250);
  await fill("Valor a retirar", "20,00");
  await submit("Retirar");
  await settle();
  await open("/objetivos");
  check(`${prefix}objetivo vinculado: acompanha o cofrinho (retirou 20,00 → 250,00)`, (await goalCurrent(P.gLinked)) === 25000);
  // um cofrinho por objetivo
  await click(`Vincular cofrinho a ${P.gOther}`);
  await wait(250);
  const options = await page.evaluate(() => [...document.querySelectorAll("dialog[open] select option")].map((o) => o.textContent));
  check(`${prefix}vincular: cofrinho já ligado a outro objetivo não é oferecido`, !options.some((o) => o.includes(P.aEd)), options.join("|"));
  await closeDialog();
  // desvincular: volta a manual com 0 (não restaura)
  await click(`Cofrinho de ${P.gLinked}`);
  await wait(250);
  await pick("Cofrinho", "Nenhum");
  await wait(150);
  check(`${prefix}desvincular: avisa que o valor manual anterior não é restaurado`, /não é restaurado/.test(await dialogText()));
  await submit("Desvincular");
  await settle();
  g = await goalText(P.gLinked);
  check(`${prefix}desvincular: volta a "informado manualmente" com R$ 0,00 (100,00 antigo NÃO restaurado)`, g.includes("Progresso informado manualmente") && (await goalCurrent(P.gLinked)) === 0);
  // religa para o teste de persistência e dashboard
  await click(`Vincular cofrinho a ${P.gLinked}`);
  await wait(250);
  await pick("Cofrinho", P.aEd);
  await submit("Vincular cofrinho");
  await settle();
  // editar
  await click(`Editar ${P.gOther}`);
  await wait(250);
  await fill("Nome", P.gOther + " ed");
  await fill("Progresso informado manualmente", "60,00");
  await submit("Salvar alterações");
  await settle();
  g = await goalText(P.gOther + " ed");
  check(`${prefix}objetivo: editar nome e valor manual`, g.includes("60,00") || (await goalCurrent(P.gOther + " ed")) === 6000);
  // excluir com confirmação
  await click(`Excluir ${P.gOther} ed`);
  await wait(250);
  t = await dialogText();
  check(`${prefix}objetivo: excluir pede confirmação`, /Excluir/.test(t) && /Cancelar/.test(t));
  await submit("Excluir");
  await settle();
  check(`${prefix}objetivo: excluído some da lista (o cofrinho/dinheiro intactos)`, (await goalText(P.gOther + " ed")) === "" && (await goalText(P.gLinked)) !== "");

  // ---------- 11. dashboard ----------
  await goto("/");
  await settle();
  t = norm(await text());
  const dashReserved = toCents(await page.evaluate(() => document.querySelector('[data-testid="dash-reserved"]')?.textContent ?? null));
  check(`${prefix}dashboard: cartão "Cofrinhos e objetivos" com total reservado, livre e objetivos ativos`, t.includes("Cofrinhos e objetivos") && t.includes("Total reservado") && t.includes("Objetivos ativos") && dashReserved !== null && dashReserved >= 25000);
  check(`${prefix}dashboard: progresso dos principais objetivos (${P.gManual})`, t.includes(P.gManual) || t.includes(P.gLinked));
  check(`${prefix}dashboard: "Dinheiro reservado" aparece na decomposição do Disponível de verdade`, t.includes("Dinheiro reservado"));
  await shot(`${prefix.trim()}-dashboard-cofrinhos`);

  // ---------- 12. planejamento ----------
  await open("/planejamento");
  await wait(pause);
  t = norm(await text());
  check(`${prefix}planejamento: mostra o dinheiro reservado como informação (sem mudar a projeção)`, t.includes("Dinheiro reservado em cofrinhos") && t.includes("a projeção continua partindo do saldo real"));

  // ---------- 13. filtro por pessoa/Casal ----------
  await open("/cofrinhos");
  const filters = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Filtrar por perfil"] a')].map((a) => ({ name: a.textContent.trim(), href: a.getAttribute("href") })));
  const owner = (await section(P.aEd));
  let filterOk = filters.length > 1;
  for (const f of filters.filter((x) => x.name !== "Todos")) {
    await goto(f.href);
    await settle();
    const visible = await hasCard(P.aEd);
    // o responsável aparece no card: o cofrinho só aparece no filtro do próprio responsável
    if (visible !== owner.includes(f.name)) filterOk = false;
  }
  await goto("/cofrinhos");
  await settle();
  check(`${prefix}cofrinhos: filtro por pessoa/Casal mostra o cofrinho só para o responsável (Todos mostra)`, filterOk && (await hasCard(P.aEd)), JSON.stringify(filters.map((f) => f.name)));

  // ---------- 14. importação dos cofrinhos antigos (modo local; no Supabase: testes de paridade) ----------
  if (legacy) {
    await page.evaluate((accountId) => {
      localStorage.setItem(
        "finora:v1:pockets",
        JSON.stringify([
          { id: "old-e2e-1", name: "Antigo E2E", accountId, amountCents: 5000 },
          { id: "old-e2e-2", name: "Antigo grande E2E", accountId, amountCents: 99999900 },
        ]),
      );
    }, legacy.accountId);
    await open("/cofrinhos");
    t = norm(await text());
    check(`${prefix}legado: aviso discreto "Encontramos cofrinhos da versão anterior." com o botão Importar`, t.includes("Encontramos cofrinhos da versão anterior.") && t.includes("Importar cofrinhos"));
    check(`${prefix}legado: NADA é importado sem ação do usuário`, !(await hasCard("Antigo E2E")));
    await shot(`${prefix.trim()}-cofrinhos-legado`);
    await click("Importar cofrinhos");
    await wait(pause + 1200);
    t = norm(await text());
    check(`${prefix}legado: resultado mostra importados, sem reserva por falta de saldo livre e falhas`, /Importados: 1/.test(t) && /sem reserva por falta de saldo livre: 1/.test(t) && /Falhas: 0/.test(t), t.match(/Importação dos cofrinhos[\s\S]{0,300}/)?.[0]);
    check(`${prefix}legado: cofrinho importado com a reserva (R$ 50,00) e o grande sem reserva (R$ 0,00)`, (await cardMoney("Antigo E2E", "pocket-balance")) === 5000 && (await cardMoney("Antigo grande E2E", "pocket-balance")) === 0);
    const kept = await page.evaluate(() => localStorage.getItem("finora:v1:pockets"));
    check(`${prefix}legado: a chave antiga NUNCA é apagada`, !!kept && kept.includes("old-e2e-1"));
    await click("Entendi");
    await wait(200);
    await open("/cofrinhos");
    check(`${prefix}legado: depois de importar o aviso some e não duplica`, !(await text()).includes("Encontramos cofrinhos da versão anterior.") && (await page.evaluate(() => document.querySelectorAll('section[aria-label="Cofrinho Antigo E2E"]').length)) === 1);
    // limpeza dos importados (saldo 50 → retirar e arquivar)
    await inCard("Antigo E2E", "Retirar");
    await wait(250);
    await fill("Valor a retirar", "50,00");
    await submit("Retirar");
    await settle();
    await inCard("Antigo E2E", "Arquivar Antigo E2E");
    await wait(pause + 800);
    await inCard("Antigo grande E2E", "Arquivar Antigo grande E2E");
    await wait(pause + 800);
    await page.evaluate(() => localStorage.removeItem("finora:v1:pockets"));
  }

  // ---------- 14b. estorna também o uso total: o saldo da conta volta ao que era antes deste bloco ----------
  await open("/movimentacoes");
  await rowMenu(P.use2, "Estornar");
  await wait(250);
  await submit("Estornar");
  await settle();
  await open("/cofrinhos");
  check(
    `${prefix}estorno do uso total: cofrinho volta a R$ 280,00 e o saldo em contas fica como antes do bloco`,
    (await cardMoney(P.aEd, "pocket-balance")) === 28000 && (await dash()).balance === dashBefore.balance,
  );

  // ---------- 15. responsividade ----------
  for (const [name, width, height] of [["mobile", 390, 844], ["tablet", 820, 1100], ["desktop", 1440, 900]]) {
    await page.setViewport({ width, height, isMobile: width < 500 });
    for (const path of ["/cofrinhos", "/objetivos", "/"]) {
      await open(path);
      check(`${prefix}${name} ${path}: sem scroll horizontal`, (await overflowOf()) <= 0, "overflow=" + (await overflowOf()));
    }
    await open("/cofrinhos");
    await shot(`${prefix.trim()}-${name}-cofrinhos`);
    await inCard(P.aEd, "Reservar");
    await wait(250);
    await fill("Valor a reservar", "1,00");
    check(`${prefix}${name}: diálogo de reserva sem overflow`, (await dialogOverflow()) <= 0, "overflow=" + (await dialogOverflow()));
    await shot(`${prefix.trim()}-${name}-reservar`);
    await closeDialog();
    await inCard(P.aEd, `Histórico de ${P.aEd}`);
    await wait(pause + 500);
    check(`${prefix}${name}: histórico sem overflow`, (await dialogOverflow()) <= 0, "overflow=" + (await dialogOverflow()));
    await shot(`${prefix.trim()}-${name}-historico`);
    await closeDialog();
    await open("/objetivos");
    await shot(`${prefix.trim()}-${name}-objetivos`);
    await click(`Vincular cofrinho a ${P.gOther}`).catch(() => {});
    await closeDialog();
    await click("Novo objetivo").catch(() => {});
    await wait(250);
    check(`${prefix}${name}: diálogo de objetivo sem overflow`, (await dialogOverflow()) <= 0, "overflow=" + (await dialogOverflow()));
    await closeDialog();
    await open("/movimentacoes");
    await click("Nova movimentação");
    await click("Despesa", { starts: true, scope: "dialog" });
    await wait(200);
    await pick("Conta", account);
    await clickCheckboxByText("Usar dinheiro de um cofrinho").catch(() => {});
    await wait(200);
    check(`${prefix}${name}: despesa usando cofrinho sem overflow`, (await dialogOverflow()) <= 0, "overflow=" + (await dialogOverflow()));
    await shot(`${prefix.trim()}-${name}-despesa-cofrinho`);
    await closeDialog();
  }
  await page.setViewport({ width: 1280, height: 900 });
}

/**
 * Persistência (depois de logout/login no Supabase; depois de recarregar no local) e limpeza: o que foi criado continua
 * lá com os mesmos saldos; no fim, retira a reserva, arquiva os cofrinhos e remove os objetivos de teste.
 */
export async function pocketPersistenceChecks(k, opts) {
  const { page, goto, click, fill, text, check, wait } = k;
  const { prefix, pause = 500, stamp } = opts;
  const A = `Cofrinho A E2E ${stamp} ed`;
  const B = `Cofrinho B E2E ${stamp}`;
  const gLinked = `Meta ligada E2E ${stamp}`;
  const gManual = `Meta manual E2E ${stamp}`;
  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector('[aria-label="Carregando"]'), { timeout: 20000 });
    await wait(pause);
  };
  const sectionText = (label, name) => page.evaluate((l, n) => (document.querySelector(`section[aria-label="${l} ${n}"]`)?.innerText ?? "").replace(/ /g, " "), label, name);
  const inCard = (name, label) =>
    page.evaluate(
      (n, l) => {
        const root = document.querySelector(`section[aria-label="Cofrinho ${n}"]`);
        const el = root && [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === l || (b.getAttribute("aria-label") ?? "") === l);
        if (!el) throw new Error("botão não encontrado: " + l);
        el.click();
      },
      name,
      label,
    );

  await goto("/cofrinhos");
  await settle();
  let a = await sectionText("Cofrinho", A);
  check(`${prefix}persistência: cofrinho mantém o saldo (R$ 280,00) e o histórico`, a.includes(A) && a.includes("R$ 280,00"), a.slice(0, 120));
  await goto("/objetivos");
  await settle();
  const linked = await sectionText("Objetivo", gLinked);
  const manual = await sectionText("Objetivo", gManual);
  check(`${prefix}persistência: objetivo vinculado (progresso = saldo do cofrinho) e manual mantidos`, linked.includes("Reservado em cofrinho") && linked.includes("R$ 280,00") && manual.includes("Progresso informado manualmente") && manual.includes("R$ 250,00"));

  // limpeza
  for (const name of [gLinked, gManual]) {
    await click(`Excluir ${name}`);
    await wait(250);
    await click("Excluir", { scope: "dialog" });
    await wait(pause + 1200);
  }
  await goto("/cofrinhos");
  await settle();
  await inCard(A, "Retirar");
  await wait(250);
  await fill("Valor a retirar", "280,00");
  await click("Retirar", { scope: "dialog" });
  await wait(pause + 1200);
  // O botão só habilita quando a tela reflete o saldo zero (no Supabase há latência entre a ação e a tela): espera com sondagem.
  const enabled = (name) =>
    page.evaluate((n) => {
      const root = document.querySelector(`section[aria-label="Cofrinho ${n}"]`);
      const b = root && [...root.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") ?? "") === `Arquivar ${n}`);
      return !!b && !b.disabled;
    }, name);
  const until = async (fn, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn().catch(() => false)) return true;
      await wait(300);
    }
    return false;
  };
  await until(() => enabled(A));
  await inCard(A, `Arquivar ${A}`);
  await wait(pause + 1000);
  await until(() => enabled(B));
  await inCard(B, `Arquivar ${B}`);
  await wait(pause + 1000);
  await goto("/cofrinhos");
  await settle();
  await page.evaluate(() => [...document.querySelectorAll("summary")].find((s) => s.textContent.includes("Arquivados"))?.click());
  await wait(200);
  const done = await until(() => page.evaluate((x, y) => [x, y].every((n) => (document.querySelector(`section[aria-label="Cofrinho ${n}"]`)?.innerText ?? "").includes("Arquivado")), A, B));
  check(`${prefix}limpeza: cofrinhos de teste sem reserva e arquivados`, done);
  void text;
}
