// Cartões de retrospectiva da Estante (estilo "Wrapped"): desenhados num <canvas> 1080×1920 no próprio aparelho,
// prontos pra postar nos stories. Nada sai do celular; as capas são baixadas só pra desenhar (se o site da capa
// não permitir, desenha uma capa colorida com o título no lugar).
import { periodStats, funComparison, BOOK_MOOD_BY_ID, MONTHS_PT } from "./books.js";

const W = 1080, H = 1920;
const C = { pink: "#f6a7cb", lime: "#d4f46a", purple: "#5a3a7a", blue: "#6d6bd8", yellow: "#ffe08a", peach: "#f0a07a", white: "#ffffff", ink: "#2b1840", rose: "#c9305a" };
const HEAD = '"Baloo 2", "Nunito", system-ui, sans-serif';
const BODY = '"Nunito", system-ui, sans-serif';
const FALLBACKS = ["#f6a7cb", "#6d6bd8", "#f0a07a", "#5a3a7a", "#d4f46a", "#ffe08a"];

async function loadFonts() {
  try {
    await Promise.all(["800 60px 'Baloo 2'", "700 30px 'Nunito'", "900 30px 'Nunito'"].map((f) => document.fonts.load(f)));
  } catch (e) { /* segue com a fonte padrão */ }
}

async function loadCover(url) {
  if (!url) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { mode: "cors", signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch (e) { return null; }
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}

function text(ctx, s, x, y, { size = 40, weight = 800, color = C.ink, align = "left", font = BODY } = {}) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(s, x, y);
}

function drawCover(ctx, img, book, x, y, w, h) {
  ctx.save();
  rr(ctx, x, y, w, h, Math.max(8, w * 0.06));
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    const idx = [...(book.title || "?")].reduce((s, c) => s + c.charCodeAt(0), 0) % FALLBACKS.length;
    ctx.fillStyle = FALLBACKS[idx];
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = idx === 1 || idx === 3 ? C.white : C.ink;
    ctx.font = `800 ${Math.round(w * 0.16)}px ${HEAD}`;
    ctx.textAlign = "center";
    const lines = wrap(ctx, book.title || "", w * 0.82, 5);
    const lh = w * 0.19;
    lines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + h / 2 - ((lines.length - 1) * lh) / 2 + i * lh));
  }
  ctx.restore();
  ctx.save();
  rr(ctx, x, y, w, h, Math.max(8, w * 0.06));
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.12)"; ctx.stroke();
  ctx.restore();
}

function base(bg, label) {
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // bolhas decorativas
  ctx.globalAlpha = 0.22; ctx.fillStyle = C.white;
  ctx.beginPath(); ctx.arc(960, 140, 260, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(80, 1760, 300, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
  return { cv, ctx };
}

function footer(ctx, color) {
  text(ctx, "Saudômetro · Estante", W / 2, 1850, { size: 34, weight: 800, color, align: "center" });
}

const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

export async function buildCards({ books, year, month = null, name = "" }) {
  await loadFonts();
  const st = periodStats(books, year, month);
  const label = month ? `${MONTHS_PT[month - 1]} de ${year}` : String(year);
  const covers = new Map();
  const need = [...st.top, ...st.done.slice(0, 24)];
  await Promise.all(need.map(async (b) => { if (!covers.has(b.id)) covers.set(b.id, await loadCover(b.cover_url)); }));
  const cards = [];

  { // 1 · abertura
    const { cv, ctx } = base(C.pink);
    text(ctx, month ? MONTHS_PT[month - 1].toUpperCase() : "SEU ANO", W / 2, 520, { size: 56, color: C.purple, align: "center", font: HEAD });
    text(ctx, String(year), W / 2, 880, { size: 300, weight: 800, color: C.white, align: "center", font: HEAD });
    text(ctx, "em livros", W / 2, 1040, { size: 150, weight: 800, color: C.purple, align: "center", font: HEAD });
    if (name) text(ctx, `por ${name}`, W / 2, 1180, { size: 48, color: C.purple, align: "center" });
    text(ctx, st.count ? `${st.count} ${st.count === 1 ? "livro" : "livros"} 📚` : "vamos ler mais? 📚", W / 2, 1400, { size: 64, weight: 900, color: C.ink, align: "center", font: HEAD });
    footer(ctx, C.purple);
    cards.push(cv);
  }

  { // 2 · top 5
    const { cv, ctx } = base(C.purple);
    text(ctx, "Seus livros mais amados", W / 2, 200, { size: 70, color: C.white, align: "center", font: HEAD });
    text(ctx, label, W / 2, 270, { size: 40, color: C.lime, align: "center" });
    if (!st.top.length) text(ctx, "Termine um livro pra ele aparecer aqui ✨", W / 2, 700, { size: 44, color: C.white, align: "center" });
    st.top.forEach((b, i) => {
      const y = 340 + i * 280;
      ctx.fillStyle = "rgba(255,255,255,.12)"; rr(ctx, 60, y, 960, 250, 36); ctx.fill();
      text(ctx, String(i + 1), 120, y + 160, { size: 110, color: i === 0 ? C.lime : C.pink, align: "center", font: HEAD });
      drawCover(ctx, covers.get(b.id), b, 200, y + 20, 140, 210);
      ctx.font = `800 44px ${HEAD}`;
      wrap(ctx, b.title, 620, 2).forEach((l, k) => text(ctx, l, 375, y + 90 + k * 50, { size: 44, color: C.white, font: HEAD }));
      if (b.author) text(ctx, b.author.slice(0, 34), 375, y + 185, { size: 30, weight: 700, color: C.pink });
      if (b.rating) text(ctx, stars(b.rating), 375, y + 228, { size: 36, color: C.lime });
    });
    footer(ctx, C.pink);
    cards.push(cv);
  }

  { // 3 · totais
    const { cv, ctx } = base(C.lime);
    text(ctx, "No total você leu", W / 2, 330, { size: 62, color: C.purple, align: "center", font: HEAD });
    text(ctx, String(st.count), W / 2, 740, { size: 420, color: C.ink, align: "center", font: HEAD });
    text(ctx, st.count === 1 ? "livro" : "livros", W / 2, 840, { size: 90, color: C.purple, align: "center", font: HEAD });
    const kp = [[st.pages.toLocaleString("pt-BR"), "páginas"], [String(st.outsideKindle), "fora do Kindle"]];
    kp.forEach(([n, l], i) => {
      const x = 80 + i * 470;
      ctx.fillStyle = i ? C.pink : C.white; rr(ctx, x, 960, 450, 260, 40); ctx.fill();
      text(ctx, n, x + 225, 1100, { size: 110, color: C.ink, align: "center", font: HEAD });
      text(ctx, l, x + 225, 1170, { size: 40, color: C.purple, align: "center" });
    });
    const fc = funComparison(st.pages);
    if (fc) {
      ctx.font = `800 44px ${BODY}`;
      wrap(ctx, fc, 880, 3).forEach((l, i) => text(ctx, l, W / 2, 1380 + i * 60, { size: 44, color: C.ink, align: "center" }));
    }
    footer(ctx, C.purple);
    cards.push(cv);
  }

  { // 4 · autora do ano (ou livro que mais marcou)
    const { cv, ctx } = base(C.blue);
    if (st.topAuthor) {
      const [a, n] = st.topAuthor;
      text(ctx, "Sua autora do ano", W / 2, 280, { size: 66, color: C.white, align: "center", font: HEAD });
      ctx.font = `800 110px ${HEAD}`;
      wrap(ctx, a, 900, 2).forEach((l, i) => text(ctx, l, W / 2, 520 + i * 120, { size: 110, color: C.lime, align: "center", font: HEAD }));
      text(ctx, `${n} livros dela por aqui 💜`, W / 2, 820, { size: 48, color: C.white, align: "center" });
      const mine = st.done.filter((b) => b.author?.trim() === a).slice(0, 3);
      const cw = 260, gap = 40, total = mine.length * cw + (mine.length - 1) * gap;
      mine.forEach((b, i) => drawCover(ctx, covers.get(b.id), b, (W - total) / 2 + i * (cw + gap), 940, cw, 390));
    } else {
      const b = st.top[0];
      text(ctx, "O livro que mais te marcou", W / 2, 280, { size: 62, color: C.white, align: "center", font: HEAD });
      if (b) {
        drawCover(ctx, covers.get(b.id), b, 330, 400, 420, 630);
        ctx.font = `800 64px ${HEAD}`;
        wrap(ctx, b.title, 900, 2).forEach((l, i) => text(ctx, l, W / 2, 1160 + i * 72, { size: 64, color: C.lime, align: "center", font: HEAD }));
        if (b.author) text(ctx, b.author, W / 2, 1340, { size: 42, color: C.white, align: "center" });
        if (b.rating) text(ctx, stars(b.rating), W / 2, 1420, { size: 60, color: C.yellow, align: "center" });
      }
    }
    footer(ctx, C.white);
    cards.push(cv);
  }

  { // 5 · humor + palavras-chave
    const { cv, ctx } = base(C.yellow);
    text(ctx, "Como os livros te deixaram", W / 2, 230, { size: 62, color: C.purple, align: "center", font: HEAD });
    const moods = st.moods.slice(0, 5);
    const max = Math.max(1, ...moods.map(([, n]) => n));
    moods.forEach(([id, n], i) => {
      const m = BOOK_MOOD_BY_ID[id]; if (!m) return;
      const y = 330 + i * 130;
      text(ctx, m.emoji, 100, y + 70, { size: 70 });
      text(ctx, m.label, 190, y + 45, { size: 36, color: C.ink });
      ctx.fillStyle = "rgba(90,58,122,.15)"; rr(ctx, 190, y + 62, 700, 28, 14); ctx.fill();
      ctx.fillStyle = [C.rose, C.blue, C.purple, C.peach, C.pink][i % 5]; rr(ctx, 190, y + 62, Math.max(40, 700 * n / max), 28, 14); ctx.fill();
      text(ctx, String(n), 960, y + 88, { size: 46, color: C.ink, align: "right", font: HEAD });
    });
    if (!moods.length) text(ctx, "Conte como cada livro te fez sentir ✨", W / 2, 600, { size: 42, color: C.purple, align: "center" });
    text(ctx, "Suas palavras-chave", W / 2, 1090, { size: 60, color: C.purple, align: "center", font: HEAD });
    let x = 80, y = 1180;
    const tmax = Math.max(1, ...st.tags.map(([, n]) => n));
    st.tags.forEach(([t, n], i) => {
      const size = 34 + Math.round(26 * n / tmax);
      ctx.font = `800 ${size}px ${BODY}`;
      const w = ctx.measureText("#" + t).width + 56;
      if (x + w > W - 80) { x = 80; y += 100; }
      if (y > 1700) return;
      ctx.fillStyle = [C.pink, C.white, C.lime, C.blue, C.peach][i % 5]; rr(ctx, x, y, w, size + 40, (size + 40) / 2); ctx.fill();
      text(ctx, "#" + t, x + 28, y + size + 8, { size, color: i % 5 === 3 ? C.white : C.ink });
      x += w + 20;
    });
    footer(ctx, C.purple);
    cards.push(cv);
  }

  { // 6 · estante + fechamento
    const { cv, ctx } = base(C.peach);
    text(ctx, "Sua estante", W / 2, 220, { size: 90, color: C.white, align: "center", font: HEAD });
    text(ctx, `${label} · ${st.count} ${st.count === 1 ? "livro" : "livros"}`, W / 2, 290, { size: 44, color: C.purple, align: "center" });
    const list = st.done.slice(0, 20);
    const cols = list.length > 12 ? 5 : 4;
    const gap = 24, cw = (W - 120 - gap * (cols - 1)) / cols, ch = cw * 1.5;
    list.forEach((b, i) => drawCover(ctx, covers.get(b.id), b, 60 + (i % cols) * (cw + gap), 360 + Math.floor(i / cols) * (ch + gap), cw, ch));
    text(ctx, "E ano que vem tem mais 💕", W / 2, 1780, { size: 54, color: C.purple, align: "center", font: HEAD });
    footer(ctx, C.white);
    cards.push(cv);
  }
  return cards;
}

export const canvasToBlob = (cv) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("sem imagem"))), "image/png"));

export async function shareOrDownload(blobs, baseName) {
  const files = blobs.map((b, i) => new File([b], `${baseName}-${i + 1}.png`, { type: "image/png" }));
  if (navigator.canShare?.({ files })) {
    try { await navigator.share({ files, title: "Minha Estante" }); return "shared"; }
    catch (e) { if (e?.name === "AbortError") return "cancelled"; }
  }
  files.forEach((f, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f); a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, i * 400));
  return "downloaded";
}
