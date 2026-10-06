// Motor puro do CapMart: não sabe nada sobre casal, turma, Supabase ou moedas. Mesma ideia
// das outras pastas de jogo (stopGame.js, cardGame.js, starBattle.js) — só regras e estado,
// pensado pra se um dia virar algo maior já servir de base.
//
// Portado do pacote React/TypeScript original (motor aprovado, 110 fases, 25 produtos) pra
// JS puro, sem framework — mesma mecânica (prateleiras de 3, estoque escondido atrás), mas
// com as fórmulas de tamanho de fase mais exigentes do que o pacote original (que ficava
// fácil demais rápido demais). O tabuleiro é sempre "linhas de 3" (cada prateleira só
// combina com ela mesma) e toda célula sempre tem um produto — nada de espaço vazio decorativo
// — então a dificuldade cresce em número de prateleiras E em camadas de estoque escondido
// atrás de cada uma, sem o tabuleiro inteiro precisar ficar gigante pra isso.
// A interface aqui é construída direto no app.js, igual os outros jogos. O prêmio por fase
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

// Quanto de prateleira (trio) cada conjunto de 10 fases começa com — a fase 1 já abre com
// uma prateleira de verdade pra organizar (bem mais que as 3 linhas originais), mas o
// tabuleiro inteiro ainda cabe na tela sem precisar rolar: quem cresce mais rápido é o
// estoque escondido atrás de cada prateleira (depth, logo abaixo), não a altura visível.
const PACK_TRIOS_BASE = [8, 12, 16, 19, 22, 24, 26, 28, 30, 32, 34];

export function makeLevel(id, seed = id * 7919) {
  const pack = Math.floor((id - 1) / 10), n = (id - 1) % 10;
  const rows = PACK_TRIOS_BASE[pack] + Math.floor(n / 3);
  const types = pack <= 5 ? Math.min(12, 4 + pack + Math.floor(n / 3)) : Math.min(PRODUCTS.length, 12 + (pack - 5) * 3 + Math.floor(n / 3));
  const palette = shuffled(Array.from({ length: pack <= 5 ? 12 : PRODUCTS.length }, (_, i) => i), seed).slice(0, types);
  // cada célula da frente sempre recebe um produto de verdade — sem espaço vazio decorativo,
  // que antes sobrava sem ícone nenhum no tabuleiro (bug reportado).
  let front = Array.from({ length: rows * 3 }, (_, i) => palette[Math.floor(i / 3) % types]);
  for (let attempt = 0; attempt < 256; attempt++) {
    front = shuffled(front, seed + 1 + attempt * 104729);
    const groups = Array.from({ length: rows }, (_, r) => front.slice(r * 3, r * 3 + 3));
    if (!groups.some((row) => row.every((p) => p === row[0]))) break;
  }
  // camadas de estoque escondido atrás de cada prateleira: cresce junto com o pack, até 3
  // camadas nas fases finais — cada camada é uma rodada extra de "combinar 3" na mesma
  // prateleira depois que a da frente esvazia, sem deixar o tabuleiro mais alto por isso.
  const depth = pack === 0 ? 0 : pack <= 3 ? 1 : pack <= 7 ? 2 : 3;
  const board = Array.from({ length: rows }, (_, r) => Array.from({ length: 3 }, (_, c) => ({
    item: front[r * 3 + c],
    behind: Array.from({ length: depth }, (_, d) => palette[(r + d + 1) % types]),
    unlockAt: 0,
  })));
  const all = board.flat().flatMap((s) => [s.item, ...s.behind]);
  const totalTrios = all.length / 3, orderStock = all.filter((p) => p === palette[1]).length;
  const objective = pack >= 4 && n % 3 === 0 ? { kind: "order", product: palette[1], count: Math.min(orderStock, 6 + Math.floor(n / 3) * 3) } : pack >= 4 && n % 3 === 1 ? { kind: "score", target: Math.max(900, totalTrios * 85) } : { kind: "clear" };
  const moves = pack >= 3 ? rows * 5 + 30 : null;
  // "seconds" é a meta de tempo (par), não um limite rígido: terminar mais rápido rende bônus
  // de pontuação, passar da meta desconta — mas nunca faz perder a fase por tempo.
  const seconds = 20 + rows * 6 + depth * 10;
  const bonus = seconds * 3 + (moves ?? 0) * 10;
  const base = objective.kind === "order" ? 400 : objective.kind === "score" ? objective.target : totalTrios * 100;
  return {
    id, pack, seed, name: PACKS[pack], board, types: new Set(all).size, seconds, moves, objective,
    stars: [base + 300 + Math.floor(bonus * 0.35), base + 300 + Math.floor(bonus * 0.8)],
    difficulty: DIFFICULTY[pack],
    mechanics: [
      "contra o tempo",
      ...(depth ? ["estoque escondido"] : []),
      ...(moves ? ["movimentos limitados"] : []),
      ...(objective.kind === "order" ? ["pedido especial"] : objective.kind === "score" ? ["meta de pontos"] : []),
    ],
  };
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
        cols.slice(0, 3).forEach((c) => { g.lastCleared.push({ row: r, col: c, item: row[c].item }); row[c].item = null; });
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
    // g.remaining pode estar negativo (passou da meta de tempo) — isso vira desconto em vez de
    // bônus, mas o resultado nunca fica negativo.
    g.resultScore = Math.max(0, g.score + RULES.completion + Math.floor(g.remaining) * RULES.second + Math.max(0, (g.level.moves ?? g.movesUsed) - g.movesUsed) * RULES.move);
  } else if (g.level.moves !== null && g.movesUsed >= g.level.moves) { g.status = "lost"; g.reason = "Os movimentos acabaram. Cada troca faz diferença!"; }
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
  const next = { ...g, elapsed: g.elapsed + seconds, remaining: g.remaining - seconds, lastCleared: [] };
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
  if (help === "time") return { ...g, remaining: g.remaining + RULES.extraSeconds, assisted: true };
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
