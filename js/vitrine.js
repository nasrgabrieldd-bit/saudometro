// Vitrine: carrossel de mimos no topo do Hoje (casal e turma). Mostra o que dá pra trocar por moedas,
// com ilustração, preço e quanto falta pro saldo. Tocar leva pra Lojinha/Prêmios.
const ART = {
  chocolate: { bg: "linear-gradient(135deg,#5b2a1a,#a8552d)", svg: '<g transform="rotate(-14 100 100)"><rect x="42" y="30" width="116" height="150" rx="14" fill="#3a1a10"/><rect x="50" y="38" width="100" height="134" rx="10" fill="#6b3420"/><g fill="#8a4a2e"><rect x="56" y="46" width="42" height="36" rx="6"/><rect x="102" y="46" width="42" height="36" rx="6"/><rect x="56" y="88" width="42" height="36" rx="6"/><rect x="102" y="88" width="42" height="36" rx="6"/><rect x="56" y="130" width="42" height="36" rx="6"/><rect x="102" y="130" width="42" height="36" rx="6"/></g><rect x="38" y="22" width="124" height="34" rx="6" fill="#ffd9a0"/></g>' },
  cinema: { bg: "linear-gradient(135deg,#2b2a6b,#6d6bd8)", svg: '<g transform="rotate(10 100 100)"><path d="M30 60h140v28a12 12 0 0 0 0 24v28H30v-28a12 12 0 0 0 0-24z" fill="#ffd24d"/><path d="M118 60v80" stroke="#c99a00" stroke-width="3" stroke-dasharray="6 6"/><circle cx="76" cy="100" r="22" fill="#c99a00" opacity=".25"/><path d="M76 86l6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2z" fill="#fff"/><rect x="128" y="76" width="30" height="5" rx="2" fill="#c99a00"/><rect x="128" y="88" width="24" height="5" rx="2" fill="#c99a00"/><rect x="128" y="100" width="30" height="5" rx="2" fill="#c99a00"/></g>' },
  maratona: { bg: "linear-gradient(135deg,#7a1f48,#e0527f)", svg: '<rect x="20" y="110" width="160" height="48" rx="14" fill="#ffb3c7"/><rect x="30" y="80" width="140" height="44" rx="14" fill="#ffd6e2"/><rect x="14" y="98" width="30" height="60" rx="12" fill="#ff90ad"/><rect x="156" y="98" width="30" height="60" rx="12" fill="#ff90ad"/><rect x="62" y="30" width="80" height="48" rx="8" fill="#1d1a1c"/><rect x="68" y="36" width="68" height="36" rx="4" fill="#6d6bd8"/><path d="M96 46l16 8-16 8z" fill="#fff"/>' },
  cafe_na_cama: { bg: "linear-gradient(135deg,#1f5a55,#4cb5a2)", svg: '<rect x="30" y="120" width="140" height="14" rx="7" fill="#fff" opacity=".8"/><path d="M40 120a60 40 0 0 1 120 0z" fill="#ffe08a"/><circle cx="100" cy="78" r="8" fill="#ff7a9c"/><path d="M62 150h76l-8 28H70z" fill="#fff" opacity=".9"/><circle cx="150" cy="60" r="10" fill="#fff" opacity=".5"/>' },
};
const FALLBACK_BG = ["linear-gradient(135deg,#4a2c6b,#9b6bd8)", "linear-gradient(135deg,#1f4f7a,#4c9bd6)", "linear-gradient(135deg,#7a4b1f,#d69a4c)", "linear-gradient(135deg,#1f5a3a,#4cb57a)"];

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// escolhe até n itens: primeiro o que já dá pra comprar (mais caro primeiro, mais "especial"), depois os mais próximos do saldo
export function pickVitrine(perks, balance, n = 4) {
  const ok = perks.filter((p) => p.cost <= balance).sort((a, b) => b.cost - a.cost);
  const next = perks.filter((p) => p.cost > balance).sort((a, b) => a.cost - b.cost);
  return [...ok.slice(0, 2), ...next, ...ok.slice(2)].slice(0, n);
}

export function vitrineHTML(items, balance) {
  if (!items.length) return "";
  return `<section class="vit" aria-label="Mimos para trocar por moedas">
    <div class="vit-track" tabindex="0">${items.map((p, i) => {
      const art = ART[p.id];
      const left = p.cost - balance;
      const tag = left <= 0 ? "Disponível agora" : `Faltam ${left} ${left === 1 ? "moeda" : "moedas"}`;
      const sub = p.desc || p.sub || "";
      return `<button type="button" class="vit-slide" data-vit="${esc(p.id)}" style="background:${art ? art.bg : FALLBACK_BG[i % FALLBACK_BG.length]}">
        <span class="vit-kicker">${tag}</span>
        <svg class="vit-art" viewBox="0 0 200 200" aria-hidden="true">${art ? art.svg : `<text x="100" y="125" text-anchor="middle" font-size="110">${esc(p.emoji || "🎁")}</text>`}</svg>
        <span class="vit-title">${esc(p.title)}</span>
        <span class="vit-sub">${esc(sub)}</span>
        <span class="vit-foot"><span class="vit-go">${left <= 0 ? "Resgatar" : "Ver na loja"}</span><span class="vit-cost"><i class="vit-coin"></i>${p.cost}</span></span>
      </button>`;
    }).join("")}</div>
    <div class="vit-dots" aria-hidden="true">${items.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>
  </section>`;
}

// liga o carrossel: pontinhos, avanço automático (sem movimento se a pessoa pediu menos animação) e clique
export function wireVitrine(root, onOpen) {
  const track = root.querySelector(".vit-track");
  if (!track) return;
  const slides = [...track.children];
  const dots = [...root.querySelectorAll(".vit-dots i")];
  let cur = 0, timer = null;
  const center = (i) => track.scrollTo({ left: slides[i].offsetLeft - track.offsetLeft - (track.clientWidth - slides[i].clientWidth) / 2, behavior: "smooth" });
  track.addEventListener("scroll", () => {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0, dist = Infinity;
    slides.forEach((s, i) => { const d = Math.abs(s.offsetLeft - track.offsetLeft + s.clientWidth / 2 - mid); if (d < dist) { dist = d; best = i; } });
    cur = best;
    dots.forEach((d, i) => d.classList.toggle("on", i === best));
  }, { passive: true });
  slides.forEach((s) => s.addEventListener("click", () => onOpen(s.dataset.vit)));
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce || slides.length < 2) return;
  const stop = () => { clearInterval(timer); timer = null; };
  const start = () => {
    stop();
    timer = setInterval(() => { if (!root.isConnected) return stop(); center((cur + 1) % slides.length); }, 5000);
  };
  ["pointerdown", "focusin", "mouseenter"].forEach((ev) => track.addEventListener(ev, stop));
  ["pointerup", "focusout", "mouseleave"].forEach((ev) => track.addEventListener(ev, start));
  start();
}
