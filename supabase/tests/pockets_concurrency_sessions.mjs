// Concorrência com DUAS sessões reais (dois logins do usuário descartável, Promise.all). Requer um fixture commitado: household
// "CONCORRENCIA TESTE" com contas "CC A"/"CC B", cofrinho P1 em A com 60000 reservados. Limpar com o script de cleanup do household de teste.
import { createClient } from "file:///C:/dev/estudos/finora/node_modules/@supabase/supabase-js/dist/index.mjs";
import ws from "file:///C:/dev/estudos/finora/node_modules/ws/wrapper.mjs";
import fs from "node:fs";
const root = "C:/dev/estudos/finora";
const rd = (f) => Object.fromEntries(fs.readFileSync(`${root}/${f}`, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const env = { ...rd(".env.local"), ...rd(".env.e2e.local") };
if (!env.E2E_EMAIL.endsWith("@test.invalid")) throw new Error("só o usuário descartável");

// DUAS sessões independentes (dois tokens, duas conexões HTTP) do mesmo usuário descartável.
async function session() {
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false }, realtime: { transport: ws } });
  const { error } = await sb.auth.signInWithPassword({ email: env.E2E_EMAIL, password: env.E2E_PASSWORD });
  if (error) throw error;
  return sb;
}
const [s1, s2] = [await session(), await session()];
const hh = (await s1.from("households").select("id").eq("name", "CONCORRENCIA TESTE").single()).data.id;
const profile = (await s1.from("financial_profiles").select("id").eq("household_id", hh).eq("kind", "individual").single()).data.id;
const cat = (await s1.from("categories").select("id").eq("household_id", hh).in("kind", ["expense", "both"]).limit(1).single()).data.id;
const catInc = (await s1.from("categories").select("id").eq("household_id", hh).in("kind", ["income", "both"]).limit(1).single()).data.id;
const accs = (await s1.from("accounts").select("id,name").eq("household_id", hh)).data;
const A = accs.find((a) => a.name === "CC A").id;
const B = accs.find((a) => a.name === "CC B").id;
const today = new Date().toLocaleDateString("sv", { timeZone: "America/Sao_Paulo" });

const reserves = async (acc) => (await s1.from("v_account_reserves").select("balance_cents,reserved_cents,free_cents").eq("account_id", acc).single()).data;
const expense = (s, acc, cents, d = "conc") => s.rpc("create_transaction", { p_kind: "expense", p_description: d, p_amount_cents: cents, p_date: today, p_profile_id: profile, p_status: "paid", p_account_id: acc, p_category_id: cat });
const income = (s, acc, cents) => s.rpc("create_transaction", { p_kind: "income", p_description: "topup", p_amount_cents: cents, p_date: today, p_profile_id: profile, p_status: "paid", p_account_id: acc, p_category_id: catInc });
const transfer = (s, from, to, cents) => s.rpc("create_transaction", { p_kind: "transfer", p_description: "tr", p_amount_cents: cents, p_date: today, p_profile_id: profile, p_status: "paid", p_account_id: from, p_to_account_id: to });
const topUpFree = async (target) => {
  const r = await reserves(A);
  if (r.free_cents < target) await income(s1, A, target - r.free_cents);
};
const kind = (e) => (e ? (e.message.includes("reserve_shortfall") ? "reserve_shortfall" : e.code === "40P01" ? "DEADLOCK" : e.message.slice(0, 50)) : "ok");

const out = [];
const log = (s) => { out.push(s); console.log(s); };
const ROUNDS = 12;
let fails = 0;
const check = (name, ok, extra = "") => { if (!ok) fails++; log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

log(`estado inicial A: ${JSON.stringify(await reserves(A))}`);

// C1: duas despesas pagas de 300 na conta A com folga 400 (reservado 600): exatamente UMA pode concluir.
{
  let bad = 0, results = [];
  for (let i = 0; i < ROUNDS; i++) {
    await topUpFree(40000);
    const [r1, r2] = await Promise.all([expense(s1, A, 30000, "c1-s1"), expense(s2, A, 30000, "c1-s2")]);
    const k = [kind(r1.error), kind(r2.error)].sort().join("+");
    results.push(k);
    const after = await reserves(A);
    if (k !== "ok+reserve_shortfall" || after.balance_cents < after.reserved_cents) bad++;
  }
  check(`C1 duas despesas simultâneas acima da folga (${ROUNDS} rodadas): exatamente 1 conclui, a outra recebe reserve_shortfall, invariante saldo>=reservado`, bad === 0, [...new Set(results)].join(" | "));
}

// C2: despesa x transferência de saída da mesma conta com folga para só uma.
{
  let bad = 0, results = [];
  for (let i = 0; i < ROUNDS; i++) {
    await topUpFree(40000);
    const [r1, r2] = await Promise.all([expense(s1, A, 30000, "c2-exp"), transfer(s2, A, B, 30000)]);
    const k = [kind(r1.error), kind(r2.error)].sort().join("+");
    results.push(k);
    const after = await reserves(A);
    if (k !== "ok+reserve_shortfall" || after.balance_cents < after.reserved_cents) bad++;
  }
  check(`C2 despesa x transferência de saída (${ROUNDS} rodadas): exatamente 1 conclui`, bad === 0, [...new Set(results)].join(" | "));
}

// C3: transferências CRUZADAS A->B e B->A ao mesmo tempo: ambas concluem, sem deadlock (40P01).
{
  let bad = 0, results = [];
  for (let i = 0; i < ROUNDS; i++) {
    await topUpFree(40000);
    const [r1, r2] = await Promise.all([transfer(s1, A, B, 1000), transfer(s2, B, A, 1000)]);
    const k = [kind(r1.error), kind(r2.error)].sort().join("+");
    results.push(k);
    if (k !== "ok+ok") bad++;
  }
  check(`C3 transferências cruzadas A->B x B->A (${ROUNDS} rodadas): ambas concluem, nenhum deadlock`, bad === 0, [...new Set(results)].join(" | "));
}

// C4: conta SEM reserva (B): duas despesas simultâneas que levam o saldo ao negativo continuam permitidas (regra anterior aos cofrinhos).
{
  const before = (await reserves(B)).balance_cents;
  const [r1, r2] = await Promise.all([expense(s1, B, before + 10000, "c4-s1"), expense(s2, B, 5000, "c4-s2")]);
  const after = await reserves(B);
  check("C4 conta sem reserva: duas despesas simultâneas levando o saldo ao negativo continuam permitidas", !r1.error && !r2.error && after.balance_cents < 0 && after.reserved_cents === 0, `${kind(r1.error)}+${kind(r2.error)} saldo=${after.balance_cents}`);
}

// C5: receita sendo reduzida x despesa (ambas mexem no saldo da conta com reserva)
{
  let bad = 0, results = [];
  for (let i = 0; i < ROUNDS; i++) {
    await topUpFree(40000);
    const inc = await income(s1, A, 30000); // cria receita de 300 (folga 700)
    const incId = inc.data;
    await expense(s1, A, 30000, "c5-prep"); // folga volta a 400... e a receita de 300 entra de novo no saldo
    const r0 = await reserves(A);
    const slack = r0.free_cents; // cabe a redução OU a despesa, não as duas
    const [r1, r2] = await Promise.all([
      s1.rpc("update_transaction", { p_transaction_id: incId, p_patch: { amount_cents: 1 } }),
      expense(s2, A, Math.max(slack - 100, 1), "c5-exp"),
    ]);
    const after = await reserves(A);
    const k5 = [kind(r1.error), kind(r2.error)].sort().join("+");
    results.push(k5);
    if (k5 !== "ok+reserve_shortfall" || after.balance_cents < after.reserved_cents) bad++;
  }
  check(`C5 reduzir receita x despesa simultâneas (${ROUNDS} rodadas): exatamente 1 conclui e o invariante saldo>=reservado se mantém`, bad === 0, [...new Set(results)].join(" | "));
}

const fin = await reserves(A);
log(`estado final A: ${JSON.stringify(fin)} (saldo >= reservado: ${fin.balance_cents >= fin.reserved_cents})`);
log(fails === 0 ? "TODOS OS CENÁRIOS DE CONCORRÊNCIA PASSARAM" : `${fails} CENÁRIO(S) FALHARAM`);
process.exit(fails === 0 ? 0 : 1);
