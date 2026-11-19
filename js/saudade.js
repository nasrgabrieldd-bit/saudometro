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

// gráfico de barras por dia: uma ou duas barras (series) por coluna, altura = nível * 10%
// opts: { series: [{ id, label, cls }], showNumbers }
export function saudadeChartHTML(points, opts) {
  const { series, showNumbers = true } = opts;
  const cols = points.map((p, i) => {
    const bars = series.map((s) => {
      const v = p.values[s.id];
      const label = v == null ? `${s.label}: não marcou` : `${s.label}: ${v} de 10`;
      if (v == null) return `<span class="sh-bar sh-empty ${s.cls}" title="${shortDay(p.day)} · ${escapeAttr(label)}"></span>`;
      return `<span class="sh-bar ${s.cls}" style="height:${Math.max(v * 10, 4)}%" title="${shortDay(p.day)} · ${escapeAttr(label)}">${showNumbers ? `<b>${v}</b>` : ""}</span>`;
    }).join("");
    const showLabel = points.length <= 10 || i % 5 === 0 || i === points.length - 1;
    return `<div class="sh-col"><div class="sh-bars">${bars}</div><div class="sh-day">${showLabel ? shortDay(p.day) : ""}</div></div>`;
  }).join("");
  const legend = series.map((s) => `<span class="sh-key"><i class="sh-dot ${s.cls}"></i>${escapeAttr(s.label)}</span>`).join("");
  return `<div class="sh-chart" role="img" aria-label="Histórico do termômetro de saudade dos últimos ${points.length} dias">${cols}</div><div class="sh-legend">${legend}</div>`;
}

// frases de resumo de uma pessoa (ou da média da turma)
export function saudadeSummaryHTML(stats, who, total) {
  if (!stats.days) return `<div class="sh-sum"><b>${escapeAttr(who)}</b>: nenhuma marcação nesse período.</div>`;
  const avg = String(stats.avg).replace(".", ",");
  const parts = [
    `média <b>${avg}</b>`,
    `pico <b>${stats.peak}</b> em ${shortDay(stats.peakDay)}`,
    `marcou <b>${stats.days}</b> de ${total} dias`,
  ];
  if (stats.trend) parts.push(TREND_TEXT[stats.trend]);
  return `<div class="sh-sum"><b>${escapeAttr(who)}</b>: ${parts.join(" · ")}</div>`;
}

// lista dia a dia (mais recente primeiro), só dias com alguma marcação
export function saudadeListHTML(points, series) {
  const rows = points.filter((p) => series.some((s) => p.values[s.id] != null)).reverse().map((p) => {
    const cells = series.map((s) => {
      const v = p.values[s.id];
      return `<span class="sh-li-val"><i class="sh-dot ${s.cls}"></i>${escapeAttr(s.label)} <b>${v == null ? "—" : v}</b>${v == null ? "" : ` <em>${escapeAttr(saudadeLabel(Math.round(v)))}</em>`}</span>`;
    }).join("");
    return `<li><span class="sh-li-day">${shortDay(p.day)}</span>${cells}</li>`;
  });
  return rows.length ? `<ul class="sh-list">${rows.join("")}</ul>` : `<p class="hint-text" style="margin:8px 0 0;">Ainda não há marcações.</p>`;
}
