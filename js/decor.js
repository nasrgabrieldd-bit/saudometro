// Enfeite sazonal bem discreto: um fio de pisca-pisca de Natal no topo do app, de 1 a 26 de dezembro.
// Não bloqueia toque (pointer-events: none), respeita "reduzir movimento" (fica aceso, sem piscar)
// e some se o casal/turma desligou as promoções por data.
import { seasonalDecor } from "./promos.js";

const ID = "seasonal-decor";
const COLORS = ["#ff4d6d", "#ffd24d", "#4dd6a0", "#5aa9ff", "#c77dff"];

export function applySeasonalDecor(enabled = true, date = new Date()) {
  const old = document.getElementById(ID);
  if (old) old.remove();
  if (!enabled || seasonalDecor(date) !== "natal") return;
  const n = 16;
  const bulbs = Array.from({ length: n }, (_, i) => {
    const sag = Math.sin((i / (n - 1)) * Math.PI) * 7; // o fio faz uma curvinha
    return `<i style="left:${(i / (n - 1)) * 100}%; top:${sag}px; --c:${COLORS[i % COLORS.length]}; animation-delay:${(i % 5) * 0.35}s"></i>`;
  }).join("");
  const el = document.createElement("div");
  el.id = ID;
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<span class="xl-wire"></span>${bulbs}`;
  document.body.appendChild(el);
}
