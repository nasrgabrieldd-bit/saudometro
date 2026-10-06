// Motor puro do CapMart: não sabe nada sobre casal, turma, Supabase ou moedas. Mesma ideia
// das outras pastas de jogo (stopGame.js, cardGame.js, starBattle.js) — só regras e estado,
// pensado pra se um dia virar algo maior já servir de base.
//
// Portado do pacote React/TypeScript original (motor aprovado, 110 fases, 25 produtos) pra
// JS puro, sem framework — mesma lógica, mesmas fórmulas de fase, só sem o editor em React
// (a interface aqui é construída direto no app.js, igual os outros jogos). O prêmio por fase
// segue o MESMO modelo de confiança do Capibatman: o cliente reporta "venci a fase X com Y
// estrelas" e o app credita a moeda na hora — sem servidor validando replay. Isso é uma
// simplificação deliberada em relação ao pacote original (que validava cada troca no
// servidor); pro contexto de casal/turma (poucas pessoas, já confiam uma na outra, igual
// todo o resto da economia deste app) não compensa a complexidade de manter uma Edge
// Function só pra isso.

export const RULES = { match: [100, 150, 200, 250], comboSeconds: 5, completion: 300, second: 5, move: 20, extraSeconds: 30, costs: { undo: 5, hint: 10, time: 15, shuffle: 20 }, rewards: { completion: 5, threeStars: 3, firstDailyWin: 5, dailyChallenge: 10 } };

export const PRODUCTS = [
  { name: "Maçã", icon: "🍎" }, { name: "Leite", icon: "🥛" },
  { name: "Pão", icon: "🍞" }, { name: "Abacate", icon: "🥑" },
  { name: "Morango", icon: "🍓" }, { name: "Mel", icon: "🍯" },
  { name: "Queijo", icon: "🧀" }, { name: "Uva", icon: "🍇" },
  { name: "Cenoura", icon: "🥕" }, { name: "Milho", icon: "🌽" },
  { name: "Biscoito", icon: "🍪" }, { name: "Coco", icon: "🥥" },
  { name: "Banana", icon: "🍌" }, { name: "Laranja", icon: "🍊" },
  { name: "Tomate", icon: "🍅" }, { name: "Brócolis", icon: "🥦" },
  { name: "Pimentão", icon: "🫑" }, { name: "Ovo", icon: "🥚" },
  { name: "Peixe", icon: "🐟" }, { name: "Pera", icon: "🍐" },
  { name: "Melancia", icon: "🍉" }, { name: "Abacaxi", icon: "🍍" },
  { name: "Cereja", icon: "🍒" }, { name: "Pimenta", icon: "🌶️" },
  { name: "Castanha", icon: "🌰" },
];

export const PACKS = ["Portas abertas", "Feira fresquinha", "Segredos do estoque", "Cada movimento conta", "Lista de compras", "Mercado mestre", "Novas prateleiras", "Estoque gigante", "Mercado completo", "Desafio final", "Lenda do mercadinho"];
const DIFFICULTY = ["Suave", "Leve", "Moderada", "Desafiadora", "Difícil", "Especialista", "Avançada", "Intensa", "Extrema", "Mestre", "Lendária"];

// ---------- geração determinística das fases (mesma semente = mesmo tabuleiro sempre) ----------

function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
export function shuffled(values, seed) {
  const a = [...values], random = rng(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function legacyLevel(id, seed = id * 7919) {
  const pack = Math.floor((id - 1) / 10), n = (id - 1) % 10;
  const rows = Math.min(8, 3 + Math.floor((id - 1) / 10) + (n >= 5 ? 1 : 0));
  const types = Math.min(12, 3 + pack + Math.floor(n / 3));
  const palette = shuffled(Array.from({ length: 12 }, (_, i) => i), seed).slice(0, types);
  const items = shuffled(Array.from({ length: rows * 3 }, (_, i) => palette[Math.floor(i / 3) % types]), seed + 1);
  for (let r = 0; r < rows; r++) if (items[r * 3] === items[r * 3 + 1] && items[r * 3] === items[r * 3 + 2]) {
    const other = items.findIndex((v, i) => Math.floor(i / 3) !== r && v !== items[r * 3]);
    [items[r * 3 + 2], items[other]] = [items[other], items[r * 3 + 2]];
  }
  const depth = pack >= 2 ? 1 + (pack >= 4 && n >= 4 ? 1 : 0) : 0;
  const board = Array.from({ length: rows }, (_, r) => Array.from({ length: 3 }, (_, c) => ({ item: items[r * 3 + c], behind: Array.from({ length: depth }, (_, d) => palette[(r + d + 1) % types]), unlockAt: 0 })));
  if (pack >= 2) board.forEach((row, r) => row.push({ item: null, behind: [], unlockAt: r % 2 === 0 ? 1 + (r % 3) : 0 }));
  const totalTrios = rows * (depth + 1);
  const actualTypes = new Set(board.flatMap((row) => row.flatMap((s) => [s.item, ...s.behind].filter((v) => v !== null)))).size;
  const orderStock = board.flat().reduce((sum, s) => sum + Number(s.item === palette[1]) + s.behind.filter((p) => p === palette[1]).length, 0);
  const objective = pack >= 4 && n % 3 === 0 ? { kind: "order", product: palette[1], count: Math.min(orderStock, 3 * (depth + 1)) } : pack >= 4 && n % 3 === 1 ? { kind: "score", target: Math.max(300, totalTrios * 75) } : { kind: "clear" };
  const seconds = pack >= 3 && n % 2 === 0 ? null : 100 + rows * 12 + depth * 15 - n * 3;
  const moves = pack >= 3 ? rows * 4 + 6 - Math.floor(n / 3) : null;
  const bonus = (seconds ?? 0) * 3 + (moves ?? 0) * 10;
  const base = objective.kind === "order" ? 250 : objective.kind === "score" ? objective.target : totalTrios * 100;
  return { id, pack, seed, name: PACKS[pack], board, types: actualTypes, seconds, moves, objective, stars: [base + 300 + Math.floor(bonus * 0.35), base + 300 + Math.floor(bonus * 0.8)], difficulty: DIFFICULTY[pack], mechanics: [seconds !== null ? "tempo" : "clássica", ...(depth ? ["estoque escondido", "espaços bloqueados"] : []), ...(moves ? ["movimentos limitados"] : []), ...(objective.kind === "order" ? ["pedido especial"] : objective.kind === "score" ? ["meta de pontos"] : [])] };
}

const TRIOS_BASE = [0, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33];

export function makeLevel(id, seed = id * 7919) {
  const original = legacyLevel(id, seed), pack = original.pack, n = (id - 1) % 10;
  if (pack === 0) return original;
  const trios = TRIOS_BASE[pack] + Math.floor(n / 3);
  const rows = trios + 2;
  const types = pack <= 5 ? Math.min(12, 4 + pack + Math.floor(n / 3)) : Math.min(PRODUCTS.length, 12 + (pack - 5) * 3 + Math.floor(n / 3));
  const palette = shuffled(Array.from({ length: pack <= 5 ? 12 : PRODUCTS.length }, (_, i) => i), seed).slice(0, types);
  const inventory = Array.from({ length: trios * 3 }, (_, i) => palette[Math.floor(i / 3) % types]);
  inventory.push(...Array(6).fill(null));
  let front = shuffled(inventory, seed + 1);
  for (let attempt = 0; attempt < 256; attempt++) {
    front = shuffled(inventory, seed + 1 + attempt * 104729);
    for (let c = rows * 3 - 3; c < rows * 3; c++) if (front[c] !== null) {
      const gap = front.findIndex((p, i) => p === null && i < rows * 3 - 3);
      [front[c], front[gap]] = [front[gap], front[c]];
    }
    const groups = Array.from({ length: rows }, (_, r) => front.slice(r * 3, r * 3 + 3));
    if (!groups.some((row) => row[0] !== null && row.every((p) => p === row[0])) && !groups.slice(0, trios).some((row) => row.every((p) => p === null))) break;
  }
  const depth = pack >= 2 ? (pack >= 4 ? 2 : 1) : 0;
  const board = Array.from({ length: rows }, (_, r) => Array.from({ length: 3 }, (_, c) => ({
    item: front[r * 3 + c],
    behind: r < trios && front.slice(r * 3, r * 3 + 3).some((p) => p !== null) ? Array.from({ length: depth }, (_, d) => palette[(r + d + 1) % types]) : [],
    unlockAt: 0,
  })));
  if (pack >= 2) {
    const empty = board.flat().filter((s) => s.item === null && !s.behind.length);
    empty.slice(0, Math.min(3, empty.length)).forEach((s, i) => { s.unlockAt = 1 + i; });
  }
  const all = board.flat().flatMap((s) => [...(s.item === null ? [] : [s.item]), ...s.behind]);
  const totalTrios = all.length / 3, orderStock = all.filter((p) => p === palette[1]).length;
  const objective = pack >= 4 && n % 3 === 0 ? { kind: "order", product: palette[1], count: Math.min(orderStock, 6 + Math.floor(n / 3) * 3) } : pack >= 4 && n % 3 === 1 ? { kind: "score", target: Math.max(900, totalTrios * 85) } : { kind: "clear" };
  const seconds = original.seconds === null ? null : 100 + trios * 8 + depth * 12 - n * 2;
  const moves = pack >= 3 ? trios * 4 + 12 - Math.floor(n / 3) : null;
  const bonus = (seconds ?? 0) * 3 + (moves ?? 0) * 10;
  const base = objective.kind === "order" ? 400 : objective.kind === "score" ? objective.target : totalTrios * 100;
  return { ...original, board, types: new Set(all).size, seconds, moves, objective, stars: [base + 300 + Math.floor(bonus * 0.35), base + 300 + Math.floor(bonus * 0.8)], mechanics: [...original.mechanics, "espaços estratégicos"] };
}

export const LEVELS = Array.from({ length: 110 }, (_, i) => makeLevel(i + 1));

export function dailyLevel(day) {
  let seed = 0;
  for (const ch of day) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
  return { ...makeLevel(45, seed), name: "Desafio diário", dailyDay: day };
}

// ---------- estado da partida (jogado no próprio aparelho) ----------

const cloneBoard = (b) => b.map((row) => row.map((s) => ({ ...s, behind: [...s.behind] })));

export function startGame(level) {
  return { level, board: cloneBoard(level.board), score: 0, movesUsed: 0, matches: 0, collected: {}, combo: 0, lastMatchAt: null, remaining: level.seconds, elapsed: 0, status: "playing", history: [], assisted: false, hints: null, lastCleared: [] };
}

const same = (a, b) => a.row === b.row && a.col === b.col;

export function validMove(g, m) {
  const a = g.board[m.from.row]?.[m.from.col], b = g.board[m.to.row]?.[m.to.col];
  return g.status === "playing" && !same(m.from, m.to) && !!a && !!b && a.unlockAt <= g.matches && b.unlockAt <= g.matches && a.item !== null && a.item !== b.item;
}

function snapshot(g) {
  return { board: cloneBoard(g.board), score: g.score, movesUsed: g.movesUsed, matches: g.matches, collected: { ...g.collected }, combo: g.combo, lastMatchAt: g.lastMatchAt };
}

function resolve(g, award) {
  let found = true;
  while (found) {
    found = false;
    g.board.forEach((row, r) => {
      const groups = new Map();
      row.forEach((s, c) => { if (s.item !== null && s.unlockAt <= g.matches) groups.set(s.item, [...(groups.get(s.item) || []), c]); });
      for (const [item, cols] of groups) if (cols.length >= 3) {
        found = true; g.matches++; g.collected[item] = (g.collected[item] || 0) + 3;
        if (award) { g.combo = g.lastMatchAt !== null && g.elapsed - g.lastMatchAt <= RULES.comboSeconds ? g.combo + 1 : 1; g.score += RULES.match[Math.min(g.combo - 1, 3)]; g.lastMatchAt = g.elapsed; }
        cols.slice(0, 3).forEach((c) => { g.lastCleared.push({ row: r, col: c }); row[c].item = null; });
      }
      if (row.every((s) => s.item === null) && row.some((s) => s.behind.length)) { row.forEach((s) => { s.item = s.behind.shift() ?? null; }); found = true; }
    });
  }
}

export function objectiveMet(g) {
  const o = g.level.objective;
  return o.kind === "clear" ? g.board.every((r) => r.every((s) => s.item === null && !s.behind.length)) : o.kind === "order" ? (g.collected[o.product] || 0) >= o.count : g.score >= o.target;
}

export function hasValidMoves(g) {
  const p = g.board.flatMap((row, r) => row.map((s, c) => ({ s, pos: { row: r, col: c } }))).filter((x) => x.s.unlockAt <= g.matches);
  return p.some((a) => a.s.item !== null && p.some((b) => !same(a.pos, b.pos) && a.s.item !== b.s.item));
}

function finish(g) {
  if (objectiveMet(g)) {
    g.status = "won";
    g.resultScore = g.score + RULES.completion + Math.floor(g.remaining ?? 0) * RULES.second + Math.max(0, (g.level.moves ?? g.movesUsed) - g.movesUsed) * RULES.move;
  } else if (g.remaining !== null && g.remaining <= 0) { g.status = "lost"; g.reason = "O tempo acabou. Vamos tentar de novo?"; }
  else if (g.level.moves !== null && g.movesUsed >= g.level.moves) { g.status = "lost"; g.reason = "Os movimentos acabaram. Cada troca faz diferença!"; }
  else if (!hasValidMoves(g)) { g.status = "lost"; g.reason = "Não há movimentos válidos no estoque."; }
  return g;
}

export function move(g, m) {
  if (!validMove(g, m)) return g;
  const next = { ...g, board: cloneBoard(g.board), collected: { ...g.collected }, history: [...g.history, snapshot(g)], movesUsed: g.movesUsed + 1, hints: null, lastCleared: [] };
  const a = next.board[m.from.row][m.from.col], b = next.board[m.to.row][m.to.col];
  [a.item, b.item] = [b.item, a.item];
  resolve(next, true);
  return finish(next);
}

export function tick(g, seconds) {
  if (g.status !== "playing" || !Number.isFinite(seconds) || seconds <= 0) return g;
  const next = { ...g, elapsed: g.elapsed + seconds, remaining: g.remaining === null ? null : Math.max(0, g.remaining - seconds), lastCleared: [] };
  if (next.lastMatchAt !== null && next.elapsed - next.lastMatchAt > RULES.comboSeconds) next.combo = 0;
  return finish(next);
}

export function hint(g) {
  for (let r = 0; r < g.board.length; r++) {
    const row = g.board[r], accessible = row.map((s, c) => ({ s, c })).filter((x) => x.s.unlockAt <= g.matches);
    const candidates = [...new Set(accessible.map((x) => x.s.item).filter((x) => x !== null))];
    candidates.sort((a, b) => accessible.filter((x) => x.s.item === b).length - accessible.filter((x) => x.s.item === a).length);
    for (const item of candidates) {
      const matching = accessible.filter((x) => x.s.item === item);
      const source = g.board.flatMap((rr, ri) => rr.map((s, c) => ({ s, pos: { row: ri, col: c } }))).find((x) => x.pos.row !== r && x.s.item === item && x.s.unlockAt <= g.matches);
      if (source && matching.length < 3) {
        const dest = accessible.filter((x) => x.s.item !== item).sort((a, b) => Number(a.s.item !== null) - Number(b.s.item !== null))[0];
        if (dest) return { from: source.pos, to: { row: r, col: dest.c } };
      }
    }
  }
  return null;
}

export function applyHelp(g, help) {
  if (g.status !== "playing") return g;
  if (help === "undo") { const previous = g.history.at(-1); return previous ? { ...g, ...previous, board: cloneBoard(previous.board), collected: { ...previous.collected }, history: g.history.slice(0, -1), combo: 0, lastMatchAt: null, hints: null, lastCleared: [], assisted: true } : g; }
  if (help === "hint") { const m = hint(g); return m ? { ...g, assisted: true, hints: m } : g; }
  if (help === "time") return g.remaining === null ? g : { ...g, remaining: g.remaining + RULES.extraSeconds, assisted: true };
  const board = cloneBoard(g.board), cells = board.flat().filter((s) => s.unlockAt <= g.matches && s.item !== null);
  const originalItems = cells.map((s) => s.item);
  for (let attempt = 0; attempt < 64; attempt++) {
    const items = shuffled(originalItems, g.level.seed + g.movesUsed + Math.floor(g.elapsed * 1000) + attempt * 104729);
    cells.forEach((s, i) => { s.item = items[i]; });
    if (g.level.objective.kind !== "score" || !board.some((row) => row.some((s) => s.item !== null && row.filter((x) => x.item === s.item).length >= 3))) break;
    if (attempt === 63) return { ...g, assisted: true, hints: null, history: [] };
  }
  const next = { ...g, board, collected: { ...g.collected }, combo: 0, lastMatchAt: null, history: [], assisted: true, hints: null, lastCleared: [] };
  resolve(next, false);
  return finish(next);
}

export function stars(score, targets, won = true) {
  return won ? (score >= targets[1] ? 3 : score >= targets[0] ? 2 : 1) : 0;
}
