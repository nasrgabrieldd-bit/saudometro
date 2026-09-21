// Testes da lógica pura do app (sem navegador nem banco). Rodam com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import * as people from "../js/people.js";
import * as util from "../js/util.js";
import { cycleInfo, averageCycleLength, cyclePhaseOnDate } from "../js/cycle.js";
import { MOODS } from "../js/moods.js";
import { QUESTIONS, questionForWeek } from "../js/questions.js";
import { CHALLENGES, challengeForDay } from "../js/challenges.js";
import { PERKS, PERK_BY_ID, suggestedReward, customToPerk } from "../js/perks.js";
import { pickSaudadeNudge } from "../js/nudges.js";

const reset = () => people.setPeopleSettings(null);

// ---------- casal antigo (Gabriel e Tata) tem que continuar idêntico ----------
test("casal sem configuração mantém a identidade antiga", () => {
  reset();
  assert.equal(people.nameOf("gabriel"), "Gabriel");
  assert.equal(people.nameOf("tata"), "Tata");
  assert.equal(people.genderOf("gabriel"), "homem");
  assert.equal(people.genderOf("tata"), "mulher");
  assert.equal(people.emojiOf("gabriel"), "🦁");
  assert.equal(people.emojiOf("tata"), "🦋");
});

test("casal antigo: tudo ligado, ordem e regras de moedas padrão", () => {
  reset();
  for (const id of ["kiss", "goal", "next", "recharge", "miss"]) assert.equal(people.homeWidgetOn(id), true, id);
  for (const id of ["mood", "together", "special"]) assert.equal(people.homeWidgetOn(id), false, id);
  assert.deepEqual(people.homeOrder(), people.HOME_WIDGETS);
  assert.equal(people.goalTarget(), 2);
  assert.equal(people.luckyOn(), true);
  for (const [k, v] of Object.entries(people.COIN_DEFAULTS)) assert.equal(people.coinRule(k), v, k);
});

// ---------- casais novos ----------
test("casal com nomes usa os nomes dele e nunca cai em Gabriel/Tata", () => {
  people.setPeopleSettings({ names: { gabriel: "Duda" } });
  assert.equal(people.nameOf("gabriel"), "Duda");
  assert.equal(people.nameOf("tata"), "Seu par");
  reset();
});

test("cleanName remove caracteres perigosos e limita o tamanho", () => {
  assert.equal(people.cleanName('<b>Ana</b> "x"'), "bAna/b x");
  assert.equal(people.cleanName("  a   b  "), "a b");
  assert.equal(people.cleanName("x".repeat(50)).length, 24);
  assert.equal(people.cleanName(null), "");
});

test("emoji inválido volta ao padrão", () => {
  people.setPeopleSettings({ emojis: { gabriel: "<script>", tata: "🌸" } });
  assert.equal(people.emojiOf("gabriel"), "🦁");
  assert.equal(people.emojiOf("tata"), "🌸");
  reset();
});

test("emojis padrão são diferentes em qualquer combinação de gêneros", () => {
  for (const a of ["homem", "mulher"]) for (const b of ["homem", "mulher"]) {
    const [e1, e2] = people.defaultEmojis(a, b);
    assert.notEqual(e1, e2, `${a}+${b}`);
  }
});

test("recursos desligados, ordem da home e regras personalizadas", () => {
  people.setPeopleSettings({
    features: { recharge: false, together: true, home_order: ["miss", "miss", "zzz", "kiss"], coin_rules: { mood: 0, note: 99, lucky: false }, perks_off: ["cafe_na_cama"] },
  });
  assert.equal(people.feat("recharge"), false);
  assert.equal(people.homeWidgetOn("recharge"), false);
  assert.equal(people.homeWidgetOn("together"), true);
  assert.deepEqual(people.homeOrder().slice(0, 2), ["miss", "kiss"]);
  assert.equal(new Set(people.homeOrder()).size, people.HOME_WIDGETS.length);
  assert.equal(people.coinRule("mood"), 0);
  assert.equal(people.coinRule("note"), people.COIN_DEFAULTS.note); // 99 fora do limite
  assert.equal(people.luckyOn(), false);
  assert.equal(people.perkHidden("cafe_na_cama"), true);
  assert.equal(people.perkHidden("outro"), false);
  reset();
});

test("meta de encontros e data de 'dias juntos' validam o valor", () => {
  people.setPeopleSettings({ features: { goal_target: 4, together_since: "2024-02-10" } });
  assert.equal(people.goalTarget(), 4);
  assert.equal(people.togetherSince(), "2024-02-10");
  people.setPeopleSettings({ features: { goal_target: 99, together_since: "ontem" } });
  assert.equal(people.goalTarget(), 2);
  assert.equal(people.togetherSince(), null);
  reset();
});

// ---------- concordância de gênero ----------
test("gen concorda o texto com o gênero", () => {
  assert.equal(people.gen("Cansada(o) e bobo(a)", "mulher"), "Cansada e boba");
  assert.equal(people.gen("Cansada(o) e bobo(a)", "homem"), "Cansado e bobo");
  assert.equal(people.gen("ele(a) chegou", "mulher"), "ela chegou");
  assert.equal(people.gen("ele(a) chegou", "homem"), "ele chegou");
});

test("genMixed separa quem lê de quem é o parceiro", () => {
  assert.equal(people.genMixed("Estou cansada(o), ele(a) também", "mulher", "homem"), "Estou cansada, ele também");
  assert.equal(people.genMixed("Estou cansada(o), ele(a) também", "homem", "mulher"), "Estou cansado, ela também");
});

test("nenhum texto do app deixa '(o)' ou '(a)' sobrando depois de concordar", () => {
  const textos = [
    ...MOODS.map((m) => m.label), ...QUESTIONS, ...CHALLENGES,
    ...PERKS.flatMap((p) => [p.title, p.desc]),
  ];
  for (const t of textos) for (const g of ["homem", "mulher"]) {
    const out = people.gen(t, g);
    assert.ok(!/\((o|a|e)\)/.test(out), `sobrou marcador em: ${t} -> ${out}`);
  }
});

// ---------- datas ----------
test("datas: chave de mês, ISO e navegação entre meses", () => {
  assert.equal(util.toISODate(new Date(2026, 8, 5)), "2026-09-05");
  assert.equal(util.monthKey(new Date(2026, 0, 31)), "2026-01");
  assert.equal(util.prevMonthKey("2026-01"), "2025-12");
  assert.equal(util.nextMonthKey("2026-12"), "2027-01");
  assert.equal(util.toISODate(util.parseISODate("2026-02-28")), "2026-02-28");
  assert.equal(util.toISODate(util.addDays(util.parseISODate("2026-02-28"), 1)), "2026-03-01");
});

test("fim de semana: sexta, sábado e domingo apontam para a mesma sexta", () => {
  const sex = util.parseISODate("2026-09-18"); // sexta
  assert.equal(util.toISODate(util.fridayOfWeekend(sex)), "2026-09-18");
  assert.equal(util.toISODate(util.fridayOfWeekend(util.addDays(sex, 1))), "2026-09-18");
  assert.equal(util.toISODate(util.fridayOfWeekend(util.addDays(sex, 2))), "2026-09-18");
  assert.equal(util.fridayOfWeekend(util.addDays(sex, 3)), null); // segunda
  assert.equal(util.toISODate(util.fridayOfWeekContaining(util.parseISODate("2026-09-14"))), "2026-09-18");
});

test("código do casal: 10 caracteres, sem letras confusas, e não se repete", () => {
  const codes = new Set();
  for (let i = 0; i < 200; i++) {
    const c = util.genCoupleCode();
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
    codes.add(c);
  }
  assert.equal(codes.size, 200);
});

// ---------- ciclo ----------
test("cycleInfo: dia do ciclo e próxima menstruação", () => {
  const s = { last_period_start: "2026-09-01", cycle_length: 28, period_length: 5 };
  const c = cycleInfo(s, new Date(2026, 8, 19));
  assert.equal(c.day, 19);
  assert.equal(c.toNext, 10);
  assert.equal(util.toISODate(c.nextMens), "2026-09-29");
  assert.equal(c.ov, 14);
});

test("cyclePhaseOnDate: menstruação, ovulação, fértil e TPM (e o que fica escondido no modo básico)", () => {
  const s = { last_period_start: "2026-09-01", cycle_length: 28, period_length: 5 };
  const on = (iso, full) => cyclePhaseOnDate(s, util.parseISODate(iso), full);
  assert.equal(on("2026-09-03", true), "mens");
  assert.equal(on("2026-09-14", true), "ovul");
  assert.equal(on("2026-09-12", true), "fert");
  assert.equal(on("2026-09-25", true), "tpm");
  assert.equal(on("2026-09-14", false), null); // sem ver o detalhe, ovulação não aparece
  assert.equal(on("2026-09-12", false), null);
  assert.equal(on("2026-09-25", false), "tpm");
  assert.equal(on("2026-09-30", true), "mens"); // ciclo seguinte
});

test("averageCycleLength precisa de 3 inícios e ignora intervalos absurdos", () => {
  assert.equal(averageCycleLength(["2026-05-01", "2026-05-29"]), null);
  assert.equal(averageCycleLength(["2026-05-01", "2026-05-29", "2026-06-26", "2026-07-24"]), 28);
  assert.equal(averageCycleLength(["2026-01-01", "2026-05-01", "2026-05-29"]), null);
});

// ---------- dados fixos do app ----------
test("ids únicos em humores e itens da lojinha", () => {
  assert.equal(new Set(MOODS.map((m) => m.id)).size, MOODS.length);
  assert.equal(new Set(PERKS.map((p) => p.id)).size, PERKS.length);
  for (const p of PERKS) {
    assert.ok(p.title && p.emoji && p.cost > 0 && p.fulfillReward > 0, p.id);
    assert.equal(PERK_BY_ID[p.id], p);
  }
});

test("pergunta da semana e desafio do dia nunca ficam vazios (dão a volta)", () => {
  for (const i of [0, 1, QUESTIONS.length, QUESTIONS.length * 3 + 2]) assert.ok(questionForWeek(i), `pergunta ${i}`);
  for (const i of [0, 1, CHALLENGES.length, CHALLENGES.length * 3 + 2]) assert.ok(challengeForDay(i), `desafio ${i}`);
});

test("item criado pelo casal vira item da lojinha; recompensa sugerida é ~25% do custo", () => {
  const p = customToPerk({ id: "abc", title: "Massagem", cost: 8, fulfill_reward: 2 });
  assert.equal(p.id, "custom:abc");
  assert.equal(p.custom, true);
  assert.equal(p.emoji, "🎁");
  assert.equal(suggestedReward(8), 2);
  assert.equal(suggestedReward(1), 1);
});

test("mensagem de saudade: prioriza humor do par, depois beijo, depois semana vazia, e concorda o gênero", () => {
  const base = { role: "gabriel", todayISO: "2026-09-19", partnerName: "Duda", partnerGender: "mulher", daysSinceKiss: 0, weekHasSomething: true };
  assert.equal(pickSaudadeNudge(base), null);
  assert.ok(pickSaudadeNudge({ ...base, partnerNeedsCare: true }));
  assert.ok(pickSaudadeNudge({ ...base, daysSinceKiss: 10 }));
  assert.ok(pickSaudadeNudge({ ...base, weekHasSomething: false }));
  for (const g of ["homem", "mulher"]) {
    const t = pickSaudadeNudge({ ...base, partnerGender: g, partnerNeedsCare: true });
    assert.ok(!/\((o|a|e)\)/.test(t), t);
  }
  // mesmo dia + mesma pessoa = mesma mensagem
  const a = pickSaudadeNudge({ ...base, daysSinceKiss: 10 });
  assert.equal(pickSaudadeNudge({ ...base, daysSinceKiss: 10 }), a);
});

// ---------- registro de erros ----------
import { isAccessDenied, shouldIgnoreError } from "../js/errors.js";

test("erro de permissão do banco (casal apagado) é reconhecido", () => {
  assert.equal(isAccessDenied({ code: "42501", message: "x" }), true);
  assert.equal(isAccessDenied(new Error('new row violates row-level security policy for table "month_plans"')), true);
  assert.equal(isAccessDenied(new Error("permission denied for table couples")), true);
  assert.equal(isAccessDenied(new Error("Failed to fetch")), false);
  assert.equal(isAccessDenied(null), false);
});

test("ruído sem como consertar não vai pro registro de erros", () => {
  assert.equal(shouldIgnoreError("Script error."), true);
  assert.equal(shouldIgnoreError("ResizeObserver loop completed with undelivered notifications."), true);
  assert.equal(shouldIgnoreError(""), true);
  assert.equal(shouldIgnoreError("x is not defined"), false);
});
