// Estante: lógica pura (estatísticas, importação de lista, busca de capa). Sem DOM, pra dar pra testar no Node.

export const STATUS = {
  quero: { label: "Quero ler", emoji: "📌" },
  lendo: { label: "Lendo", emoji: "📖" },
  li: { label: "Li", emoji: "✅" },
  larguei: { label: "Larguei", emoji: "🚪" },
};
export const SOURCES = {
  kindle: "Kindle", fisico: "Físico", pdf: "PDF", wattpad: "Wattpad", outro: "Outro",
};
export const BOOK_MOODS = [
  { id: "chorei", emoji: "😭", label: "Chorei" },
  { id: "ri", emoji: "😂", label: "Ri muito" },
  { id: "obcecada", emoji: "🔥", label: "Obcecada" },
  { id: "quentinho", emoji: "🥰", label: "Coração quentinho" },
  { id: "chocada", emoji: "😱", label: "Chocada" },
];
export const BOOK_MOOD_BY_ID = Object.fromEntries(BOOK_MOODS.map((m) => [m.id, m]));

export const MONTHS_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const yearOf = (iso) => (iso ? Number(String(iso).slice(0, 4)) : null);
const monthOf = (iso) => (iso ? Number(String(iso).slice(5, 7)) : null); // 1..12

// páginas lidas de um livro: terminado = todas; em andamento = % × páginas
export function pagesRead(b) {
  if (!b.pages) return 0;
  if (b.status === "li") return b.pages;
  if (b.status === "lendo") return Math.round((b.pages * (b.progress || 0)) / 100);
  return 0;
}

// livros terminados em um período (ano, e opcionalmente mês 1..12)
export function finishedIn(books, year, month = null) {
  return books.filter((b) => b.status === "li" && b.finished_at && yearOf(b.finished_at) === year && (month == null || monthOf(b.finished_at) === month));
}

const topCount = (arr) => {
  const m = new Map();
  for (const x of arr) if (x) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

// meses seguidos (terminando no mês de referência) com pelo menos 1 livro terminado
export function monthsStreak(books, refYear, refMonth) {
  const has = new Set(books.filter((b) => b.status === "li" && b.finished_at).map((b) => yearOf(b.finished_at) * 12 + monthOf(b.finished_at) - 1));
  let k = refYear * 12 + refMonth - 1;
  if (!has.has(k)) k -= 1; // mês corrente ainda sem livro não zera a sequência
  let n = 0;
  while (has.has(k)) { n++; k--; }
  return n;
}

export function periodStats(books, year, month = null) {
  const done = finishedIn(books, year, month);
  const rated = done.filter((b) => b.rating);
  const ranking = [...done].sort((a, b) => (b.rating || 0) - (a.rating || 0) || String(b.finished_at).localeCompare(String(a.finished_at)));
  const authors = topCount(done.map((b) => b.author?.trim()));
  const perMonth = Array.from({ length: 12 }, (_, i) => finishedIn(books, year, i + 1).length);
  return {
    count: done.length,
    pages: done.reduce((s, b) => s + (b.pages || 0), 0),
    outsideKindle: done.filter((b) => b.source !== "kindle").length,
    avgRating: rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : null,
    top: ranking.slice(0, 5),
    topAuthor: authors.find(([, n]) => n >= 2) || null,
    tags: topCount(done.flatMap((b) => b.tags || [])).slice(0, 12),
    moods: topCount(done.map((b) => b.mood)),
    perMonth,
    done,
  };
}

// "Título - Autor" / "Título, Autor" por linha (autor opcional)
export function parseTitleList(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).slice(0, 200).map((line) => {
    const m = line.split(/\s+[-–—]\s+|\s*;\s*/);
    return { title: m[0].trim().slice(0, 200), author: (m[1] || "").trim().slice(0, 150) || null };
  }).filter((x) => x.title);
}

export function cleanTag(t) {
  return String(t || "").trim().toLowerCase().replace(/^#+/, "").slice(0, 24);
}

// comparação divertida pro cartão de totais
export function funComparison(pages) {
  if (pages >= 12000) return "dava pra subir a Torre Eiffel de pilhas de papel 📚";
  if (pages >= 5000) return "mais páginas que uma enciclopédia inteira 🧠";
  if (pages >= 2000) return "o equivalente a ler a saga Harry Potter inteira 🪄";
  if (pages >= 800) return "tipo ler O Senhor dos Anéis do começo ao fim 💍";
  if (pages > 0) return "cada página conta — e foram várias ✨";
  return "";
}

// ---------- busca de capa/páginas (Google Books, depois Open Library) ----------

const https = (u) => (u ? String(u).replace(/^http:\/\//, "https://") : null);

async function fetchJSON(url, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function searchGoogle(q) {
  const j = await fetchJSON(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8&printType=books&fields=items(volumeInfo(title,authors,pageCount,imageLinks))`);
  return (j.items || []).map((it) => it.volumeInfo).filter((v) => v?.title).map((v) => ({
    title: v.title,
    author: (v.authors || []).join(", ") || null,
    cover_url: https(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail)?.replace("&edge=curl", "").replace("zoom=1", "zoom=2") || null,
    pages: v.pageCount || null,
  }));
}

async function searchOpenLibrary(q) {
  const j = await fetchJSON(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=8&fields=title,author_name,cover_i,number_of_pages_median`);
  return (j.docs || []).filter((d) => d.title).map((d) => ({
    title: d.title,
    author: (d.author_name || []).slice(0, 2).join(", ") || null,
    cover_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    pages: d.number_of_pages_median || null,
  }));
}

// devolve {results, offlineOrFailed}; tenta Google, cai pro Open Library se falhar ou vier vazio
export async function searchBooks(query) {
  const q = String(query || "").trim();
  if (q.length < 2) return { results: [], failed: false };
  let failed = 0;
  for (const fn of [searchGoogle, searchOpenLibrary]) {
    try {
      const r = await fn(q);
      if (r.length) return { results: r, failed: false };
    } catch (e) { failed++; }
  }
  return { results: [], failed: failed === 2 };
}

// capa pra um título importado em massa (melhor esforço; nunca lança)
export async function lookupBook(title, author) {
  try {
    const { results } = await searchBooks(author ? `${title} ${author}` : title);
    return results[0] || null;
  } catch (e) { return null; }
}
