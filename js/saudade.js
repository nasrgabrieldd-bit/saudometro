// Termômetro de saudade: lógica pura (frases por nível) + HTML do cartão, usado no casal e na turma.
export const SAUDADE_LABELS = [
  "Tô de boa", "Tranquilo(a)", "Pensei em você", "Um cheirinho de saudade", "Saudade dando oi",
  "Saudade pela metade", "Já tô contando as horas", "Bateu forte", "Vem aqui, por favor", "Quase pegando um ônibus", "Saudade máxima",
];

export const saudadeLabel = (n) => SAUDADE_LABELS[Math.max(0, Math.min(10, Number(n) || 0))];

// média arredondada (1 casa) dos níveis de um dia; null se ninguém marcou
export function saudadeAverage(levels) {
  if (!levels.length) return null;
  return Math.round((levels.reduce((s, n) => s + n, 0) / levels.length) * 10) / 10;
}

// cor da barra: do rosa claro ao rosa forte conforme o nível
export const saudadeColor = (n) => `hsl(342 ${40 + n * 5}% ${82 - n * 4}%)`;

export function thermoBarHTML(level, name, { you = false } = {}) {
  const pct = level == null ? 0 : level * 10;
  return `<div class="th-row">
    <div class="th-name">${name}</div>
    <div class="th-track" role="img" aria-label="${level == null ? "ainda não marcou" : `${level} de 10: ${saudadeLabel(level)}`}"><i style="width:${pct}%; background:${level == null ? "transparent" : saudadeColor(level)}"></i></div>
    <div class="th-val">${level == null ? "—" : `${level}`}</div>
  </div>
  <div class="th-sub">${level == null ? (you ? "Você ainda não marcou hoje." : "Ainda não marcou hoje.") : escapeAttr(saudadeLabel(level))}</div>`;
}
const escapeAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- Histórico do termômetro ----------
// Tudo aqui é lógica pura (sem tela nem banco), pra dar pra testar.

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// últimos `n` dias terminando em `end` (inclusive), do mais antigo pro mais novo, como "AAAA-MM-DD"
export function lastDays(end, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    out.push(isoOf(d));
  }
  return out;
}

// junta as linhas do banco numa série por dia.
// rows: [{ day, level, ...chave }], keyOf(row) devolve a chave da pessoa ("gabriel", user_id...).
// series: [{ id, pick(rowsDoDia) -> nível | null }], uma por barra do gráfico.
export function saudadeSeries(rows, days, series) {
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }
  return days.map((day) => {
    const dayRows = byDay.get(day) || [];
    const values = {};
    for (const s of series) values[s.id] = s.pick(dayRows);
    return { day, values };
  });
}

// resumo de uma série: média, pico, dias marcados, última marcação e tendência (2ª metade vs 1ª)
export function saudadeStats(points, id) {
  const marked = points.filter((p) => p.values[id] != null);
  if (!marked.length) return { days: 0, avg: null, peak: null, peakDay: null, last: null, trend: null };
  const levels = marked.map((p) => p.values[id]);
  const peak = Math.max(...levels);
  const peakDay = marked.find((p) => p.values[id] === peak).day;
  let trend = null;
  if (marked.length >= 4) {
    const half = Math.floor(marked.length / 2);
    const a = saudadeAverage(levels.slice(0, half));
    const b = saudadeAverage(levels.slice(marked.length - half));
    const diff = Math.round((b - a) * 10) / 10;
    trend = diff >= 1 ? "up" : diff <= -1 ? "down" : "flat";
  }
  return { days: marked.length, avg: saudadeAverage(levels), peak, peakDay, last: levels[levels.length - 1], trend };
}

export const TREND_TEXT = { up: "📈 subindo", down: "📉 descendo", flat: "➖ estável" };

// "2026-11-19" -> "19/11"
export const shortDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function weekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

// gráfico de uma pessoa (ou da média da turma): uma barra por dia, altura = nível * 10%.
// opts: { id, label, cls, showNumbers }  (showNumbers: números em cima das barras e dia da semana embaixo)
export function saudadeChartHTML(points, { id, label, cls, showNumbers = true }) {
  const cols = points.map((p, i) => {
    const v = p.values[id];
    const tip = `${shortDay(p.day)} · ${v == null ? "não marcou" : `${v} de 10`}`;
    const bar = v == null
      ? `<span class="sh-bar sh-empty" title="${escapeAttr(tip)}"></span>`
      : `<span class="sh-bar ${cls}" style="height:${Math.max(v * 10, 4)}%" title="${escapeAttr(tip)}">${showNumbers ? `<b>${v}</b>` : ""}</span>`;
    const last = i === points.length - 1;
    const lab = showNumbers
      ? `<span class="sh-wd">${last ? "hoje" : weekdayOf(p.day)}</span><span class="sh-dn">${p.day.slice(8, 10)}</span>`
      : (i % 5 === 0 || last ? `<span class="sh-dn">${shortDay(p.day)}</span>` : "");
    return `<div class="sh-col${last ? " sh-now" : ""}"><div class="sh-bars">${bar}</div><div class="sh-day">${lab}</div></div>`;
  }).join("");
  return `<div class="sh-chart" role="img" aria-label="Saudade de ${escapeAttr(label)} nos últimos ${points.length} dias">${cols}</div>`;
}

// três caixinhas diretas (média, maior nível, dias marcados) + tendência
export function saudadeStatsHTML(stats, total) {
  if (!stats.days) return `<p class="sh-empty-msg">Nenhuma marcação nesse período.</p>`;
  const avg = String(stats.avg).replace(".", ",");
  const trend = stats.trend ? `<div class="sh-trend sh-trend-${stats.trend}">${TREND_TEXT[stats.trend]} no período</div>` : "";
  return `<div class="sh-stats">
    <div class="sh-stat"><span class="sh-stat-n">${avg}</span><span class="sh-stat-l">média</span></div>
    <div class="sh-stat"><span class="sh-stat-n">${stats.peak}</span><span class="sh-stat-l">maior, em ${shortDay(stats.peakDay)}</span></div>
    <div class="sh-stat"><span class="sh-stat-n">${stats.days}<small>/${total}</small></span><span class="sh-stat-l">dias marcados</span></div>
  </div>${trend}`;
}
