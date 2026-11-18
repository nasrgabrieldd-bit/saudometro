import { test } from "node:test";
import assert from "node:assert/strict";
import { easter, nthWeekday, activeCampaign, nextCampaign, applyAutoPromos, dailyDealIndex, dailyDealId, CAMPAIGNS } from "../js/promos.js";

const d = (s) => { const [y, m, dd] = s.split("-").map(Number); return new Date(y, m - 1, dd); };

test("Páscoa e dia da semana do mês", () => {
  assert.equal(easter(2026).toISOString().slice(0, 10), "2026-04-05");
  assert.equal(easter(2027).toISOString().slice(0, 10), "2027-03-28");
  assert.equal(nthWeekday(2026, 10, 5, 4).toISOString().slice(0, 10), "2026-11-27"); // Black Friday 2026
});

test("campanhas nas datas certas", () => {
  assert.equal(activeCampaign(d("2026-11-27")).id, "black_friday");
  assert.equal(activeCampaign(d("2026-11-23")).id, "black_friday");
  assert.equal(activeCampaign(d("2026-11-30")).id, "black_friday");
  assert.equal(activeCampaign(d("2026-12-01")), null);
  assert.equal(activeCampaign(d("2026-12-20")).id, "natal");
  assert.equal(activeCampaign(d("2026-12-31")).id, "ano_novo");
  assert.equal(activeCampaign(d("2027-01-02")).id, "ano_novo"); // vira o ano
  assert.equal(activeCampaign(d("2026-10-31")).id, "halloween");
  assert.equal(activeCampaign(d("2026-06-10")).id, "namorados");
  assert.equal(activeCampaign(d("2026-06-10"), { scope: "turma" }), null); // namorados é só do casal
  assert.equal(activeCampaign(d("2026-07-19"), { scope: "turma" }).id, "dia_amigo");
});

test("nenhum desconto passa de 45%, e desligar apaga tudo", () => {
  for (const c of CAMPAIGNS) assert.ok(c.pct <= 45 && c.pct >= 1, c.id);
  assert.equal(activeCampaign(d("2026-11-27"), { enabled: false }), null);
  const perks = [{ id: "a", cost: 20 }, { id: "b", cost: 10 }];
  assert.deepEqual(applyAutoPromos(perks, d("2026-11-27"), { enabled: false }), perks);
});

test("semana do casal no aniversário de namoro", () => {
  const c = activeCampaign(d("2026-03-12"), { anniversary: "2024-03-10" });
  assert.equal(c.id, "aniversario");
  assert.equal(activeCampaign(d("2026-03-20"), { anniversary: "2024-03-10" }), null);
  assert.equal(activeCampaign(d("2026-03-12"), { anniversary: "2024-03-10", scope: "turma" }), null);
});

test("aplica o desconto, respeita promoção do casal e a oferta do dia", () => {
  const perks = [{ id: "a", cost: 20 }, { id: "b", cost: 10 }, { id: "c", cost: 30, promoUntil: "2026-12-30", promoPct: 10, originalCost: 33 }];
  const out = applyAutoPromos(perks, d("2026-11-27"));
  assert.equal(out[0].cost, 11); // 20 - 45%
  assert.equal(out[0].originalCost, 20);
  assert.equal(out[0].promoPct, 45);
  assert.equal(out[2].cost, 30); // promoção manual do casal fica
  const semCampanha = applyAutoPromos([{ id: "a", cost: 20 }, { id: "b", cost: 20 }, { id: "x", cost: 20 }], d("2026-09-10"));
  assert.equal(semCampanha.filter((p) => p.promoPct === 25).length, 1); // só a oferta do dia
  assert.ok(dailyDealIndex(d("2026-09-10"), 3) >= 0);
  // a oferta do dia é a mesma em qualquer lista, desde que o pool seja o mesmo
  const pool = ["a", "b", "x"];
  const alvo = dailyDealId(d("2026-09-10"), pool);
  const so2 = applyAutoPromos([{ id: alvo, cost: 20 }], d("2026-09-10"), { dealPool: pool });
  assert.equal(so2[0].promoPct, 25);
});

test("próxima campanha", () => {
  const n = nextCampaign(d("2026-11-17"));
  assert.equal(n.id, "black_friday");
  assert.equal(n.inDays, 6);
});

