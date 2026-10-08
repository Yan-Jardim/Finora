// Concorrência dos cofrinhos com DUAS sessões reais (dois logins do usuário descartável, Promise.all) usando as RPCs públicas.
// Cria o próprio fixture (household "CONCORRENCIA RPC") e NÃO limpa: rode o cleanup do household de teste depois.
import { createClient } from "file:///C:/dev/estudos/finora/node_modules/@supabase/supabase-js/dist/index.mjs";
import ws from "file:///C:/dev/estudos/finora/node_modules/ws/wrapper.mjs";
import fs from "node:fs";
const root = "C:/dev/estudos/finora";
const rd = (f) => Object.fromEntries(fs.readFileSync(`${root}/${f}`, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const env = { ...rd(".env.local"), ...rd(".env.e2e.local") };
if (!env.E2E_EMAIL.endsWith("@test.invalid")) throw new Error("só o usuário descartável");

async function session() {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false }, realtime: { transport: ws } });
  const { error } = await sb.auth.signInWithPassword({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD });
  if (error) throw error;
  return sb;
}
const [s1, s2] = [await session(), await session()];
const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const today = new Date().toLocaleDateString("sv", { timeZone: "America/Sao_Paulo" });

// ---------- fixture ----------
const hh = must(await s1.rpc("bootstrap_household", { p_household_name: "CONCORRENCIA RPC", p_display_name: "Teste", p_create_couple_profile: false }), "bootstrap");
const profile = must(await s1.from("financial_profiles").select("id").eq("household_id", hh).eq("kind", "individual").single(), "profile").id;
const cat = must(await s1.from("categories").select("id").eq("household_id", hh).in("kind", ["expense", "both"]).limit(1).single(), "cat").id;
const catInc = must(await s1.from("categories").select("id").eq("household_id", hh).in("kind", ["income", "both"]).limit(1).single(), "catInc").id;
const A = must(await s1.from("accounts").insert({ household_id: hh, owner_profile_id: profile, name: "RPC A", initial_balance_cents: 100000 }).select("id").single(), "acc A").id;
must(await s1.from("accounts").insert({ household_id: hh, owner_profile_id: profile, name: "RPC B", initial_balance_cents: 100000 }).select("id").single(), "acc B");
const P1 = must(await s1.rpc("create_pocket", { p_profile_id: profile, p_account_id: A, p_name: "P1", p_initial_cents: 40000 }), "P1");
const P2 = must(await s1.rpc("create_pocket", { p_profile_id: profile, p_account_id: A, p_name: "P2" }), "P2");
const card = must(await s1.from("credit_cards").insert({ household_id: hh, owner_profile_id: profile, payment_account_id: A, name: "RPC Cartao", limit_cents: 5000000, closing_day: 28, due_day: 5 }).select("id").single(), "card").id;
const debt = must(await s1.rpc("create_debt", { p_name: "RPC Divida", p_principal_cents: 5000000, p_total_cents: 5000000, p_profile_id: profile, p_kind: "other" }), "debt");

// ---------- helpers ----------
const acct = async (id = A) => must(await s1.from("v_account_reserves").select("balance_cents,reserved_cents,free_cents").eq("account_id", id).single(), "reserves");
const pbal = async (p) => must(await s1.from("v_pocket_balances").select("balance_cents").eq("pocket_id", p).single(), "pbal").balance_cents;
const reserve = (s, p, c) => s.rpc("pocket_reserve", { p_pocket_id: p, p_amount_cents: c });
const withdraw = (s, p, c) => s.rpc("pocket_withdraw", { p_pocket_id: p, p_amount_cents: c });
const transfer = (s, a, b, c) => s.rpc("pocket_transfer", { p_from_pocket_id: a, p_to_pocket_id: b, p_amount_cents: c });
const spend = (s, p, c, from) => s.rpc("spend_from_pocket", { p_pocket_id: p, p_description: "conc", p_amount_cents: c, p_amount_from_pocket: from ?? null, p_category_id: cat });
const expense = (s, acc, c) => s.rpc("create_transaction", { p_kind: "expense", p_description: "conc", p_amount_cents: c, p_date: today, p_profile_id: profile, p_status: "paid", p_account_id: acc, p_category_id: cat });
const income = (s, acc, c) => s.rpc("create_transaction", { p_kind: "income", p_description: "topup", p_amount_cents: c, p_date: today, p_profile_id: profile, p_status: "paid", p_account_id: acc, p_category_id: catInc });
const newInvoice = async (c) => {
  must(await s1.rpc("create_transaction", { p_kind: "credit_card_purchase", p_description: "compra", p_amount_cents: c, p_date: today, p_profile_id: profile, p_card_id: card, p_category_id: cat }), "purchase");
  const inv = must(await s1.from("v_card_invoice_totals").select("due_month,open_cents").eq("card_id", card).gt("open_cents", 0).order("due_date").limit(1).single(), "inv");
  return inv.due_month;
};
const payInvoice = (s, due, c) => s.rpc("pay_invoice", { p_card_id: card, p_due_month: due, p_account_id: A, p_amount_cents: c, p_date: today });
const payDebt = (s, c) => s.rpc("pay_debt", { p_debt_id: debt, p_account_id: A, p_amount_cents: c, p_date: today });
const kind = (e) => (!e ? "ok" : e.code === "40P01" || /deadlock/i.test(e.message) ? "DEADLOCK" : (e.message.match(/(reserve_shortfall|insufficient_free|insufficient_pocket|use_pocket_flow|already_reversed|pocket_not_found)/) || [e.message.slice(0, 40)])[0]);
const FAIL_KINDS = new Set(["reserve_shortfall", "insufficient_free", "insufficient_pocket"]);

// Volta ao estado-base: saldo A = 100000, P1 = 40000, P2 = 0.
async function normalize() {
  let r = await acct();
  if (r.balance_cents < 100000) must(await income(s1, A, 100000 - r.balance_cents), "norm income");
  for (const p of [P2]) { const b = await pbal(p); if (b > 0) must(await withdraw(s1, p, b), "norm withdraw P2"); }
  let b1 = await pbal(P1);
  if (b1 > 40000) must(await withdraw(s1, P1, b1 - 40000), "norm withdraw P1");
  r = await acct();
  if (r.balance_cents > 100000) must(await expense(s1, A, r.balance_cents - 100000), "norm expense");
  b1 = await pbal(P1);
  if (b1 < 40000) must(await reserve(s1, P1, 40000 - b1), "norm reserve P1");
  r = await acct();
  if (r.balance_cents !== 100000 || r.reserved_cents !== 40000) throw new Error("normalize falhou: " + JSON.stringify(r));
}
const log = (s) => console.log(s);
let fails = 0;
const check = (name, ok, extra = "") => { if (!ok) fails++; log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
const invariant = async () => {
  const r = await acct();
  const neg = (await Promise.all([P1, P2].map(pbal))).some((x) => x < 0);
  return r.balance_cents >= r.reserved_cents && !neg;
};
const ROUNDS = 10;
async function scenario(name, expectExactlyOne, setup, a, b, post) {
  const seen = new Set();
  let bad = 0;
  for (let i = 0; i < ROUNDS; i++) {
    await normalize();
    const ctx = setup ? await setup() : undefined;
    const [r1, r2] = await Promise.all([a(ctx), b(ctx)]);
    const k = [kind(r1.error), kind(r2.error)].sort().join("+");
    seen.add(k);
    const ok = (expectExactlyOne ? [...k.split("+")].filter((x) => x === "ok").length === 1 && k.split("+").some((x) => FAIL_KINDS.has(x)) : k === "ok+ok") && (await invariant()) && !k.includes("DEADLOCK") && (!post || (await post(r1, r2)));
    if (!ok) bad++;
  }
  check(`${name} (${ROUNDS} rodadas)`, bad === 0, [...seen].join(" | "));
}

log(`estado inicial A: ${JSON.stringify(await acct())}`);
await scenario("K1 reservar x reservar (40000 + 40000 > livre 60000): exatamente 1 conclui", true, null, () => reserve(s1, P1, 40000), () => reserve(s2, P2, 40000));
await scenario("K2 reservar x despesa paga na conta (50000 + 50000 > livre 60000): exatamente 1 conclui", true, null, () => reserve(s1, P2, 50000), () => expense(s2, A, 50000));
await scenario("K3 reservar x pay_invoice (50000 + 50000 > livre 60000): exatamente 1 conclui", true, () => newInvoice(50000), () => reserve(s1, P2, 50000), (due) => payInvoice(s2, due, 50000));
await scenario("K4 reservar x pay_debt (50000 + 50000 > livre 60000): exatamente 1 conclui", true, null, () => reserve(s1, P2, 50000), () => payDebt(s2, 50000));
await scenario("K5 despesa x despesa (40000 + 40000 > livre 60000): exatamente 1 conclui", true, null, () => expense(s1, A, 40000), () => expense(s2, A, 40000));
// P2 com 60000 para os cenários de cofrinho
const withP2 = async () => { await reserve(s1, P2, 60000); }; // livre = 100000 - 100000 = 0 depois
await scenario("K6 retirar x retirar do mesmo cofrinho (40000 + 40000 > 60000): exatamente 1 conclui", true, () => income(s1, A, 60000).then(withP2), () => withdraw(s1, P2, 40000), () => withdraw(s2, P2, 40000));
await scenario("K7 gastar x gastar do mesmo cofrinho (40000 + 40000 de reserva > 60000): exatamente 1 conclui", true, () => income(s1, A, 60000).then(withP2), () => spend(s1, P2, 40000), () => spend(s2, P2, 40000));
await scenario("K8 transferir P1->P2 x P2->P1 (mesma conta, ordem cruzada): ambas concluem, sem deadlock", false, () => income(s1, A, 60000).then(withP2), () => transfer(s1, P1, P2, 1000), () => transfer(s2, P2, P1, 1000));

// K9: estorno x retirada do mesmo cofrinho: qualquer ordem vale; invariante preservado e sem deadlock
{
  let bad = 0; const seen = new Set();
  for (let i = 0; i < ROUNDS; i++) {
    await normalize();
    await income(s1, A, 60000); await withP2();
    const sp = must(await spend(s1, P2, 30000), "spend K9");
    const [r1, r2] = await Promise.all([s1.rpc("reverse_pocket_use", { p_transaction_id: sp.transaction_id }), withdraw(s2, P2, 40000)]);
    const k = [kind(r1.error), kind(r2.error)].join("+");
    seen.add(k);
    const okR = !r1.error; // o estorno deve sempre concluir (nada o bloqueia)
    if (!okR || !(await invariant()) || k.includes("DEADLOCK")) bad++;
  }
  check(`K9 estorno x retirada (${ROUNDS} rodadas): estorno sempre conclui, invariante preservado, sem deadlock`, bad === 0, [...seen].join(" | "));
}

await normalize();
const fin = await acct();
log(`estado final A: ${JSON.stringify(fin)} (saldo >= reservado: ${fin.balance_cents >= fin.reserved_cents})`);
log(fails === 0 ? "TODOS OS CENÁRIOS DE CONCORRÊNCIA PASSARAM" : `${fails} CENÁRIO(S) FALHARAM`);
process.exit(fails === 0 ? 0 : 1);
