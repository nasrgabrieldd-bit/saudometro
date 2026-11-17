// Promoções por data (Black Friday, Natal, Ano Novo...) e oferta do dia. Lógica pura, sem tela nem banco.
// O desconto entra por cima do valor que o casal definiu e some sozinho quando a data passa.
// O casal pode desligar tudo (settings.features.holiday_promos === false); promoção manual do casal tem prioridade.

const DAY = 86400000;
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);

// Páscoa (algoritmo de Meeus/Jones/Butcher)
export function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month - 1, day);
}

// n-ésimo dia da semana do mês (weekday: 0 = domingo)
export function nthWeekday(year, month, weekday, n) {
  const first = utc(year, month, 1);
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + shift + (n - 1) * 7);
}

// campanhas: scope "casal" | "turma" | "ambos"; range(year) devolve [início, fim] (fim inclusive)
export const CAMPAIGNS = [
  { id: "halloween", name: "Halloween", pct: 25, scope: "ambos", theme: "halloween", tagline: "Doces ou travessuras: mimos mais baratos", range: (y) => [utc(y, 9, 25), utc(y, 9, 31)] },
  { id: "black_friday", name: "Black Friday", pct: 45, scope: "ambos", theme: "black", tagline: "A semana mais barata do ano", range: (y) => { const f = nthWeekday(y, 10, 5, 4); return [addDays(f, -4), addDays(f, 3)]; } },
  { id: "natal", name: "Natal", pct: 30, scope: "ambos", theme: "natal", tagline: "Presentes de Natal pra vocês", range: (y) => [utc(y, 11, 15), utc(y, 11, 25)] },
  { id: "ano_novo", name: "Ano Novo", pct: 25, scope: "ambos", theme: "anonovo", tagline: "Começar o ano com mimo", range: (y) => [utc(y, 11, 26), utc(y + 1, 0, 2)] },
  { id: "dia_mulher", name: "Dia da Mulher", pct: 20, scope: "casal", theme: "namorados", tagline: "Um mimo pra celebrar", range: (y) => [utc(y, 2, 6), utc(y, 2, 8)] },
  { id: "carnaval", name: "Carnaval", pct: 30, scope: "ambos", theme: "carnaval", tagline: "Folia com preço de pierrô", range: (y) => { const e = easter(y); return [addDays(e, -51), addDays(e, -46)]; } },
  { id: "pascoa", name: "Páscoa", pct: 20, scope: "ambos", theme: "pascoa", tagline: "Chocolate pra todo mundo", range: (y) => { const e = easter(y); return [addDays(e, -4), e]; } },
  { id: "namorados", name: "Dia dos Namorados", pct: 35, scope: "casal", theme: "namorados", tagline: "O mês do amor merece mimo", range: (y) => [utc(y, 5, 5), utc(y, 5, 12)] },
  { id: "dia_amigo", name: "Dia do Amigo", pct: 30, scope: "turma", theme: "amigo", tagline: "Pra comemorar a turma", range: (y) => [utc(y, 6, 17), utc(y, 6, 20)] },
];

// "Semana do casal": 3 dias antes e depois de cada aniversário de namoro (data guardada pelo casal, AAAA-MM-DD)
function anniversaryCampaign(anniversary, y) {
  if (!anniversary || !/^\d{4}-\d{2}-\d{2}$/.test(anniversary)) return null;
  const [ay, am, ad] = anniversary.split("-").map(Number);
  if (y <= ay) return null;
  const date = utc(y, am - 1, ad);
  return { id: "aniversario", name: "Semana do casal", pct: 40, scope: "casal", theme: "namorados", tagline: `${y - ay} ${y - ay === 1 ? "ano" : "anos"} de vocês`, start: addDays(date, -3), end: addDays(date, 3) };
}

// campanha ativa na data (a de maior desconto, se houver mais de uma); null se nenhuma ou desligada
export function activeCampaign(date, { scope = "casal", anniversary = null, enabled = true } = {}) {
  if (!enabled) return null;
  const t = utc(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const found = [];
  for (const y of [date.getFullYear() - 1, date.getFullYear()]) {
    for (const c of CAMPAIGNS) {
      if (c.scope !== "ambos" && c.scope !== scope) continue;
      const [s, e] = c.range(y);
      if (t >= s.getTime() && t <= e.getTime()) found.push({ ...c, start: s, end: e });
    }
    const a = scope === "casal" ? anniversaryCampaign(anniversary, y) : null;
    if (a && t >= a.start.getTime() && t <= a.end.getTime()) found.push(a);
  }
  if (!found.length) return null;
  found.sort((a, b) => b.pct - a.pct);
  const c = found[0];
  return { id: c.id, name: c.name, pct: c.pct, theme: c.theme, tagline: c.tagline, until: iso(c.end), daysLeft: Math.round((c.end.getTime() - t) / DAY) };
}

// próxima campanha (pra dar um gostinho: "Black Friday começa em 5 dias")
export function nextCampaign(date, { scope = "casal", enabled = true } = {}) {
  if (!enabled) return null;
  const t = utc(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  let best = null;
  for (const y of [date.getFullYear(), date.getFullYear() + 1]) {
    for (const c of CAMPAIGNS) {
      if (c.scope !== "ambos" && c.scope !== scope) continue;
      const [s] = c.range(y);
      if (s.getTime() > t && (!best || s.getTime() < best.start)) best = { id: c.id, name: c.name, pct: c.pct, theme: c.theme, start: s.getTime(), inDays: Math.round((s.getTime() - t) / DAY) };
    }
  }
  return best;
}

export const DAILY_DEAL_PCT = 25;

// índice do mimo em oferta hoje (gira todo dia, igual pra todo mundo)
export function dailyDealIndex(date, count) {
  if (!count) return -1;
  const day = Math.floor(utc(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / DAY);
  return day % count;
}
export function dailyDealId(date, pool) {
  const ids = [...pool].sort();
  return ids[dailyDealIndex(date, ids.length)] ?? null;
}

// aplica as promoções automáticas numa lista de mimos [{id, cost, ...}].
// Mimo que já tem promoção do casal (promoUntil) fica como está.
// dealPool: ids dos mimos que podem ser a "oferta do dia" (mesma lista em toda tela, pra oferta ser a mesma)
export function applyAutoPromos(perks, date, { scope = "casal", anniversary = null, enabled = true, dealPool = null } = {}) {
  if (!enabled || !perks.length) return perks;
  const camp = activeCampaign(date, { scope, anniversary });
  const dealId = dailyDealId(date, dealPool || perks.map((x) => x.id));
  const today = iso(utc(date.getFullYear(), date.getMonth(), date.getDate()));
  return perks.map((p) => {
    if (p.promoUntil) return p;
    let pct = 0, name = "", until = today;
    if (camp) { pct = camp.pct; name = camp.name; until = camp.until; }
    if (p.id === dealId && DAILY_DEAL_PCT > pct) { pct = DAILY_DEAL_PCT; name = "Oferta do dia"; until = today; }
    if (!pct) return p;
    const cost = Math.max(1, Math.round(p.cost * (1 - pct / 100)));
    if (cost >= p.cost) return p;
    return { ...p, cost, originalCost: p.cost, promoPct: pct, promoUntil: until, promoName: name };
  });
}
