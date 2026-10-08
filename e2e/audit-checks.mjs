/**
 * AUDITORIA de UX, acessibilidade, formato e DUPLO CLIQUE — compartilhada pelas suítes local e Supabase.
 *
 *  - sweep(): todas as telas em 390/820/1440 px: sem overflow horizontal, um <h1>, <main>, nomes acessíveis em
 *    campos/botões/links/gráficos, sem texto técnico (undefined/NaN/[object]/SQLSTATE...), BRL no formato pt-BR e datas
 *    não ISO para o usuário;
 *  - dialogsAndKeyboard(): foco entra no diálogo, Esc fecha, erro de campo associado (aria-invalid + aria-describedby +
 *    role="alert"), Tab percorre elementos reais com anel de foco;
 *  - doubleSubmit(): criar despesa, pagar fatura e pagar dívida com DOIS cliques seguidos: só UMA operação acontece
 *    (conferido pelo efeito no saldo/lista), e o diálogo só fecha com sucesso.
 */

export const ROUTES = ["/", "/movimentacoes", "/contas", "/cartoes", "/categorias", "/recorrencias", "/dividas", "/planejamento", "/calendario", "/cofrinhos", "/objetivos", "/relatorios", "/pessoas", "/configuracoes"];
const VIEWPORTS = [["mobile", 390, 844], ["tablet", 820, 1100], ["desktop", 1440, 900]];

/** Roda DENTRO da página: devolve a lista de problemas encontrados. */
function inPage() {
  const issues = [];
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== "hidden";
  const nameOf = (el) => {
    const aria = (el.getAttribute("aria-label") ?? "").trim();
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      if (t) return t;
    }
    if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(" ").trim();
    if (el.closest("label")) return el.closest("label").textContent.trim();
    if (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "tab") {
      if (el.textContent.trim()) return el.textContent.trim();
      if (el.querySelector("[aria-label]")) return "ok";
    }
    return (el.getAttribute("title") ?? "").trim();
  };
  if (!document.documentElement.lang) issues.push("<html> sem lang");
  if (!document.querySelector("main")) issues.push("sem <main>");
  const h1 = [...document.querySelectorAll("h1")].filter(visible).length;
  if (h1 !== 1) issues.push(`h1 visíveis = ${h1}`);
  for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea, button, a[href], [role="tab"], [role="radio"], [role="menuitem"]')) {
    if (!visible(el)) continue;
    if (!nameOf(el)) issues.push(`sem nome acessível: <${el.tagName.toLowerCase()}> ${el.outerHTML.slice(0, 90)}`);
  }
  for (const svg of document.querySelectorAll("svg[role='img']")) if (!(svg.getAttribute("aria-label") ?? "").trim()) issues.push("svg role=img sem aria-label");
  // gráficos legíveis: o texto do SVG não pode ser reduzido (escala do viewBox) a menos de ~9px
  for (const svg of document.querySelectorAll("svg[role='img']")) {
    const vb = svg.viewBox?.baseVal;
    const text = svg.querySelector("text");
    if (!vb || !vb.width || !text || !visible(svg)) continue;
    const px = parseFloat(getComputedStyle(text).fontSize) * (svg.getBoundingClientRect().width / vb.width);
    if (px < 9) issues.push(`texto do gráfico minúsculo (${px.toFixed(1)}px)`);
  }
  for (const img of document.querySelectorAll("img")) if (!img.hasAttribute("alt")) issues.push("img sem alt");
  const text = (document.querySelector("main")?.innerText ?? "").replace(/ /g, " ");
  const bad = text.match(/\b(undefined|NaN|null)\b|\[object Object\]|SQLSTATE|P0001|violates|constraint|PGRST/);
  if (bad) issues.push(`texto técnico na tela: "${bad[0]}"`);
  const iso = text.match(/\b20\d\d-\d\d-\d\d\b/);
  if (iso) issues.push(`data ISO exibida ao usuário: ${iso[0]}`);
  const dot = text.match(/R\$\s?\d[\d.]*\.\d{1,2}\b(?!,)/);
  if (dot) issues.push(`BRL fora do padrão pt-BR: "${dot[0]}"`);
  const loose = text.match(/R\$\s?\d{4,}(?![\d.,])/);
  if (loose) issues.push(`BRL sem separador de milhar: "${loose[0]}"`);
  const loading = document.querySelector('[aria-label="Carregando"]');
  if (loading) issues.push("ainda carregando");
  return issues;
}

export async function sweep(k, { prefix, pause = 400, routes = ROUTES, label = "" }) {
  const { page, goto, check, wait } = k;
  const original = page.viewport();
  for (const [name, width, height] of VIEWPORTS) {
    await page.setViewport({ width, height, isMobile: width < 500 });
    const problems = [];
    for (const route of routes) {
      await goto(route);
      await page.waitForFunction(() => !document.querySelector('[aria-label="Carregando"]'), { timeout: 25000 });
      await wait(pause);
      const issues = await page.evaluate(inPage);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) issues.push(`overflow horizontal ${overflow}px`);
      for (const i of issues) problems.push(`${route}: ${i}`);
    }
    check(`${prefix}auditoria${label} ${name} (${width}px): ${routes.length} telas sem overflow, com nomes acessíveis, sem texto técnico e com BRL/datas no padrão`, problems.length === 0, problems.slice(0, 6).join(" | "));
  }
  await page.setViewport(original ?? { width: 1280, height: 900 });
}

export async function dialogsAndKeyboard(k, { prefix, pause = 400 }) {
  const { page, goto, click, check, wait } = k;
  await goto("/movimentacoes");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Carregando"]'), { timeout: 25000 });
  await wait(pause);

  // foco entra no diálogo, título associado, Esc fecha e devolve o foco
  await click("Nova movimentação");
  await wait(250);
  const dlg = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    return { open: !!d, focusInside: !!d && d.contains(document.activeElement), labelled: !!d && !!document.getElementById(d.getAttribute("aria-labelledby") ?? ""), modal: !!d && d.matches(":modal") };
  });
  check(`${prefix}diálogo: modal, título associado (aria-labelledby) e foco dentro ao abrir`, dlg.open && dlg.modal && dlg.labelled && dlg.focusInside, JSON.stringify(dlg));
  await page.keyboard.press("Escape");
  await wait(250);
  check(`${prefix}diálogo: Esc fecha`, !(await page.evaluate(() => !!document.querySelector("dialog[open]"))));

  // erro de campo associado: abre Despesa, envia vazio
  await click("Nova movimentação");
  await click("Despesa", { starts: true, scope: "dialog" });
  await wait(250);
  await click("Registrar", { scope: "dialog" });
  await wait(500);
  const errors = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    const alerts = [...d.querySelectorAll('[role="alert"]')];
    return alerts.map((a) => {
      const field = d.querySelector(`[aria-describedby~="${a.id}"]`);
      return { text: a.textContent.trim(), linked: !!field, invalid: field?.getAttribute("aria-invalid") === "true" };
    });
  });
  check(`${prefix}formulário: cada mensagem de erro é role="alert" ligada ao campo (aria-describedby) com aria-invalid`, errors.length >= 2 && errors.every((e) => e.linked && e.invalid && e.text.length > 3), JSON.stringify(errors).slice(0, 220));
  check(`${prefix}formulário: o erro aparece em texto legível (sem código técnico)`, errors.every((e) => !/undefined|zod|invalid_type|Required/i.test(e.text)));
  await page.keyboard.press("Escape");
  await wait(250);

  // teclado: Tab percorre elementos reais e há indicação de foco
  await goto("/");
  await page.waitForFunction(() => !document.querySelector('[aria-label="Carregando"]'), { timeout: 25000 });
  await page.evaluate(() => document.activeElement?.blur());
  const seen = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        const cs = el ? getComputedStyle(el) : null;
        return { tag: el?.tagName, interactive: !!el && el !== document.body && /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName), ring: !!cs && (cs.outlineStyle !== "none" || cs.boxShadow !== "none") };
      }),
    );
  }
  check(`${prefix}teclado: Tab percorre 12 elementos interativos reais com anel de foco visível`, seen.every((s) => s.interactive && s.ring), JSON.stringify(seen.filter((s) => !s.interactive || !s.ring)).slice(0, 200));
  await page.evaluate(() => document.activeElement?.blur());
}

// ---------------------------------------------------------------------------------------------------------------------
// Duplo clique
// ---------------------------------------------------------------------------------------------------------------------

/** Dois cliques seguidos (25 ms) no botão do diálogo aberto. */
export const doubleClick = (page, label) =>
  page.evaluate(
    (l) =>
      new Promise((resolve, reject) => {
        const find = () => [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent.trim() === l);
        const first = find();
        if (!first) return reject(new Error("botão não encontrado: " + l));
        first.click();
        setTimeout(() => {
          find()?.click(); // se o diálogo já fechou, não existe (ok); se ainda existe, o segundo clique NÃO pode disparar de novo
          resolve(true);
        }, 25);
      }),
    label,
  );

export async function doubleSubmit(k, { prefix, pause = 600, account, category, stamp, local = false, payments = true }) {
  const { page, goto, click, fill, check, wait } = k;
  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector('[aria-label="Carregando"]'), { timeout: 25000 });
    await wait(pause);
  };
  const pickByText = (label, optionText) =>
    page.evaluate((l, o) => {
      const lab = [...document.querySelectorAll("dialog[open] label")].find((x) => x.textContent.trim().startsWith(l));
      if (!lab) throw new Error("campo não encontrado: " + l);
      const sel = document.getElementById(lab.htmlFor);
      const opt = o ? [...sel.options].find((x) => x.textContent.includes(o)) : [...sel.options].find((x) => x.value);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, label, optionText);
  const rowsWith = (text) => page.evaluate((t) => [...document.querySelectorAll("main li")].filter((l) => l.textContent.includes(t)).length, text);
  const deleteRow = async (text) => {
    await page.evaluate((t) => {
      const li = [...document.querySelectorAll("main li")].find((l) => l.textContent.includes(t));
      const menu = li && [...li.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Ações de"));
      if (!menu) throw new Error("linha não encontrada: " + t);
      menu.click();
    }, text);
    await wait(150);
    await click("Excluir");
    await click("Excluir", { scope: "dialog" });
    await wait(pause + 1200);
  };

  // --- criar despesa ---
  const desc = `Duplo clique ${stamp}`;
  await goto("/movimentacoes");
  await settle();
  await click("Nova movimentação");
  await click("Despesa", { starts: true, scope: "dialog" });
  await wait(200);
  await fill("Descrição", desc);
  await fill("Valor", "12,34");
  await pickByText("Conta", account);
  await pickByText("Categoria", category);
  await doubleClick(page, "Registrar");
  await wait(pause + 1500);
  await goto("/movimentacoes");
  await settle();
  const created = await rowsWith(desc);
  check(`${prefix}duplo clique em "Registrar" (despesa): cria UMA só movimentação`, created === 1, `linhas=${created}`);
  for (let i = 0; i < created; i++) await deleteRow(desc);
  await goto("/movimentacoes");
  await settle();
  check(`${prefix}duplo clique (despesa): limpeza — nenhuma sobra`, (await rowsWith(desc)) === 0);

  // --- pagar fatura e pagar dívida: cenário determinístico (veja payInvoiceDouble / payDebtDouble) ---
  if (payments) {
    await payInvoiceDouble(k, { prefix, pause, expectRpc: !local });
    await payDebtDouble(k, { prefix, pause, expectRpc: !local });
  }

  // --- recorrência (só local: a regra não é excluível pela interface) ---
  if (local) {
    await goto("/recorrencias");
    await settle();
    const name = `Rec duplo ${stamp}`;
    await click("Nova recorrência");
    await wait(250);
    await fill("Descrição", name);
    await fill("Valor", "5,00");
    await pickByText("Categoria", category);
    await pickByText("Conta", account).catch(() => {});
    await doubleClick(page, "Criar recorrência");
    await wait(pause + 1200);
    await goto("/recorrencias");
    await settle();
    const rules = await page.evaluate((n) => [...document.querySelectorAll("main li, main section")].filter((e) => e.children.length < 12 && e.textContent.includes(n) && e.tagName === "LI").length, name);
    check(`${prefix}duplo clique em "Criar recorrência": cria UMA só regra`, rules === 1, `regras=${rules}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Pagar fatura / pagar dívida com DOIS CLIQUES IMEDIATOS (cenário determinístico: o chamador garante fatura/dívida em aberto)
// ---------------------------------------------------------------------------------------------------------------------

/** Conta as RPCs financeiras DISPARADAS pelo navegador (só existem no modo Supabase). */
function trackRpc(page, name) {
  const calls = [];
  const onRequest = (request) => {
    if (request.method() === "POST" && request.url().includes(`/rest/v1/rpc/${name}`)) calls.push(request.url());
  };
  page.on("request", onRequest);
  return { count: () => calls.length, stop: () => page.off("request", onRequest) };
}

async function payDouble(k, { prefix, pause = 600, expectRpc, label, rpc, openFrom, button, marker, accountText, valueLabel = "Valor pago" }) {
  const { page, goto, click, fill, check, wait, dash } = k;
  const settle = async () => {
    await page.waitForFunction(() => !document.querySelector('[aria-label="Carregando"]'), { timeout: 25000 });
    await wait(pause);
  };
  const rows = async () => {
    await goto("/movimentacoes");
    await settle();
    return page.evaluate((m) => [...document.querySelectorAll("main li")].filter((l) => l.textContent.includes(m) && l.textContent.replace(/\u00a0/g, " ").includes("R$ 1,00")).length, marker);
  };
  const pickAccount = (text) =>
    page.evaluate((o) => {
      const lab = [...document.querySelectorAll("dialog[open] label")].find((x) => x.textContent.trim().startsWith("Pagar com a conta"));
      const sel = document.getElementById(lab.htmlFor);
      const opt = o ? [...sel.options].find((x) => x.textContent.includes(o)) : [...sel.options].find((x) => x.value);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, text);

  const balanceBefore = (await dash()).balance;
  const rowsBefore = await rows();
  await goto(openFrom);
  await settle();
  const enabled = await page.evaluate((b) => [...document.querySelectorAll("main button")].some((x) => x.textContent.trim() === b && !x.disabled), button);
  check(`${prefix}${label}: o cenário tem ${button === "Pagar fatura" ? "fatura" : "parcela"} em aberto (pré-condição determinística)`, enabled);
  if (!enabled) return;
  await click(button);
  await wait(300);
  await fill(valueLabel, "1,00");
  await pickAccount(accountText);
  const tracker = trackRpc(page, rpc);
  await doubleClick(page, "Registrar pagamento");
  await wait(pause + 1800);
  tracker.stop();
  const balanceAfter = (await dash()).balance;
  const rowsAfter = await rows();
  if (expectRpc) check(`${prefix}${label}: dois cliques imediatos disparam UMA só chamada ${rpc}`, tracker.count() === 1, `chamadas=${tracker.count()}`);
  check(`${prefix}${label}: UM só pagamento persistido (R$ 1,00) e o saldo cai uma vez`, rowsAfter - rowsBefore === 1 && balanceBefore - balanceAfter === 100, `pagamentos +${rowsAfter - rowsBefore}; saldo ${balanceBefore} -> ${balanceAfter}`);

  // limpeza: remove o(s) pagamento(s) de R$ 1,00 criados (restaura saldo e fatura/dívida)
  for (let i = 0; i < Math.max(1, rowsAfter - rowsBefore); i++) {
    const found = await page.evaluate((m) => {
      const li = [...document.querySelectorAll("main li")].find((l) => l.textContent.includes(m) && l.textContent.replace(/\u00a0/g, " ").includes("R$ 1,00"));
      if (!li) return false;
      [...li.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Ações de")).click();
      return true;
    }, marker);
    if (!found) break;
    await wait(150);
    await click("Excluir");
    await click("Excluir", { scope: "dialog" });
    await wait(pause + 1500);
    await goto("/movimentacoes");
    await settle();
  }
  check(`${prefix}${label}: limpeza — saldo e pagamentos restaurados`, (await dash()).balance === balanceBefore && (await rows()) === rowsBefore);
}

/** pay_invoice: exige uma fatura em aberto. */
export const payInvoiceDouble = (k, opts) =>
  payDouble(k, { ...opts, label: "duplo clique em pagar fatura", rpc: "pay_invoice", openFrom: "/cartoes", button: "Pagar fatura", marker: "Fatura", accountText: opts.accountText ?? "" });

/** pay_debt: exige uma dívida com parcela em aberto. */
export const payDebtDouble = (k, opts) =>
  payDouble(k, { ...opts, label: "duplo clique em pagar dívida", rpc: "pay_debt", openFrom: "/dividas", button: "Pagar parcela", marker: opts.marker ?? "Pagamento", accountText: opts.accountText ?? "" });
