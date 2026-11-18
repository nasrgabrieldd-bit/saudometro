// Enfeites do tema sazonal ativo (hoje: Natal). Só elementos decorativos: nada aqui bloqueia toque,
// e quem pediu "reduzir movimento" no aparelho vê tudo parado. Desliga sozinho quando o tema acaba.
const IDS = ["season-top", "season-snow", "season-lights"];
const COLORS = ["#d4313f", "#e0a526", "#2f8f5b", "#4f7fe0", "#c77dff"];

function limpar() { IDS.forEach((id) => document.getElementById(id)?.remove()); }

function natal() {
  const add = (id, html) => { const el = document.createElement("div"); el.id = id; el.setAttribute("aria-hidden", "true"); el.innerHTML = html; document.body.appendChild(el); };
  // pisca-pisca: fio com 16 lâmpadas no topo
  const n = 16;
  const lights = Array.from({ length: n }, (_, i) => {
    const sag = Math.sin((i / (n - 1)) * Math.PI) * 7;
    return `<i style="left:${(i / (n - 1)) * 100}%; top:${sag}px; --c:${COLORS[i % COLORS.length]}; animation-delay:${(i % 5) * 0.35}s"></i>`;
  }).join("");
  add("season-lights", `<span class="xl-wire"></span>${lights}`);
  // galhos de pinheiro nos cantos de cima, duas bolinhas e estrelinhas douradas
  add("season-top", `<b class="br l"></b><b class="br r"></b><i class="ob o1"></i><i class="ob o2"></i><s class="st s1"></s><s class="st s2"></s><s class="st s3"></s>`);
  // neve: poucos flocos pequenos, bem leves
  const flakes = Array.from({ length: 22 }, () => {
    const s = 3 + Math.random() * 4;
    return `<i style="left:${Math.random() * 100}%; width:${s}px; height:${s}px; opacity:${0.5 + Math.random() * 0.4}; --dx:${(Math.random() * 60 - 30).toFixed(0)}px; animation-duration:${(9 + Math.random() * 9).toFixed(1)}s; animation-delay:${(-Math.random() * 16).toFixed(1)}s"></i>`;
  }).join("");
  add("season-snow", flakes);
}

export function applySeasonDecor() {
  limpar();
  const s = document.documentElement.dataset.season;
  if (s === "natal") natal();
}

export function initSeasonDecor() {
  applySeasonDecor();
  window.addEventListener("seasonchange", applySeasonDecor);
}
