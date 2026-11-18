// Vitrine: carrossel de mimos no topo do Hoje (casal e turma), com as capivaras da Capi.
// Mostra o que dá pra trocar por moedas, com preço e quanto falta pro saldo. Tocar leva pra Lojinha/Prêmios.
// Cada mimo tem uma capivara e uma cor (pastel no claro, versão profunda no escuro); mimo sem arte própria
// (por exemplo os criados pelo casal) usa a Capi apaixonada.
export const CAPI = ["thug", "brava", "apaixonada", "gamer", "laptop", "leitura", "pipoca", "fitness", "mochila", "cafe", "festa", "oi"];
const ART = {
  boa_noite_fofo: { img: "cafe", bg: "lilac" },
  cafe_na_cama: { img: "cafe", bg: "rose" },
  tarefa_livre: { img: "mochila", bg: "mint", short: "Livre de uma tarefa chata" },
  surpresa: { img: "festa", bg: "butter" },
  fala_sincera: { img: "brava", bg: "rose" },
  passeio_surpresa: { img: "mochila", bg: "peach", short: "Passeio surpresa" },
  sem_recusa: { img: "apaixonada", bg: "peach" },
  nao_dormir_brigados: { img: "apaixonada", bg: "blue" },
  tempo_de_respiro: { img: "cafe", bg: "mint" },
  chocolate: { img: "festa", bg: "peach", tag: "Mais resgatado" },
  cinema: { img: "pipoca", bg: "blue", tag: "Oferta do dia" },
  maratona: { img: "laptop", bg: "lilac" },
  curinga: { img: "thug", bg: "butter", tag: "Novo" },
  batata: { img: "pipoca", bg: "peach", tag: "Novo", short: "Batata frita" },
  leitura: { img: "leitura", bg: "blue", tag: "Novo" },
  academia: { img: "fitness", bg: "mint", tag: "Novo" },
  taco: { img: "festa", bg: "mint", tag: "Novo" },
  briga: { img: "brava", bg: "rose", tag: "Divertido" },
  pizza: { img: "pipoca", bg: "peach", tag: "Oferta do dia" },
  games: { img: "gamer", bg: "butter", tag: "Divertido" },
  rap10: { img: "thug", bg: "butter", tag: "Novo" },
  rap10t: { img: "thug", bg: "butter", tag: "Novo" },
  escolhe_jogo: { img: "gamer", bg: "butter" },
  escolhe_filme: { img: "pipoca", bg: "blue" },
  escolhe_local: { img: "mochila", bg: "mint", short: "Escolhe o rolê" },
  imunidade_zoeira: { img: "thug", bg: "peach", short: "Imunidade de zoeira" },
  veta_zoeira: { img: "brava", bg: "rose" },
  coroa_resenha: { img: "festa", bg: "butter", short: "Rei da resenha" },
  vale_carona: { img: "mochila", bg: "lilac" },
  paga_rodada: { img: "cafe", bg: "butter" },
  chega_atrasado: { img: "oi", bg: "mint", short: "Atraso sem climinha" },
  playlist: { img: "gamer", bg: "butter", tag: "Novo" },
};
const DEFAULT_ART = { img: "apaixonada", bg: "lilac", tag: "Criado por vocês" };
export const artOf = (perk) => ART[perk.id] || DEFAULT_ART;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// escolhe até n itens: primeiro o que já dá pra comprar (mais caro primeiro), depois os mais próximos do saldo
export function pickVitrine(perks, balance, n = 6) {
  const ok = perks.filter((p) => p.cost <= balance).sort((a, b) => b.cost - a.cost);
  const next = perks.filter((p) => p.cost > balance).sort((a, b) => a.cost - b.cost);
  return [...ok.slice(0, 3), ...next, ...ok.slice(3)].slice(0, n);
}

export function slideHTML(p, balance, { xl = false } = {}) {
  const art = artOf(p);
  const left = p.cost - balance;
  const tag = left > 0 ? `Faltam ${left} ${left === 1 ? "moeda" : "moedas"}` : (art.tag || "Disponível agora");
  const sub = p.desc || p.sub || "";
  return `<button type="button" class="vit-slide" data-vit="${esc(p.id)}" data-bg="${art.bg}" ${xl ? 'style="height:228px;flex-basis:90%"' : ""}>
    <span class="vit-kicker">${esc(tag)}</span>
    <img class="vit-cap" src="img/capi/${art.img}.webp" alt="" width="160" height="140" loading="lazy">
    <span class="vit-title">${esc(art.short || p.title)}</span>
    <span class="vit-sub">${esc(sub)}</span>
    <span class="vit-foot"><span class="vit-go">${left > 0 ? "Ver na loja" : "Resgatar"}</span><span class="vit-cost"><i class="vit-coin"></i>${p.cost}</span></span>
  </button>`;
}

export function vitrineHTML(items, balance) {
  if (!items.length) return "";
  return `<section class="vit" aria-label="Mimos para trocar por moedas">
    <div class="vit-track" tabindex="0">${items.map((p) => slideHTML(p, balance)).join("")}</div>
    <div class="vit-dots" aria-hidden="true">${items.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>
  </section>`;
}

// miniatura da capivara do mimo (lista da loja)
export function perkThumbHTML(p) {
  const art = artOf(p);
  return `<span class="vit-th" data-bg="${art.bg}"><img src="img/capi/${art.img}.webp" alt="" width="42" height="42" loading="lazy"></span>`;
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
