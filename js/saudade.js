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
