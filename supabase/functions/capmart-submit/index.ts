// Edge Function: valida o resultado de uma partida de CapMart (replay determinístico, igual
// o motor aprovado faz) e grava tudo numa transação atômica via RPC. Chamada pelo app via
// fetch com o token de sessão — mesmo padrão de mp-create-subscription/capmart-purchase.
//
// Este arquivo é AUTOSSUFICIENTE: o motor/fases do CapMart (normalmente em
// supabase/functions/_shared/capmart/) estão copiados aqui dentro, sem nenhuma linha
// alterada na lógica do jogo — só pra essa function poder ser colada inteira no editor do
// painel do Supabase, sem precisar do CLI nem de arquivos auxiliares. Se um dia mudar o
// motor/fases do jogo (capmart-src/src/engine ou src/levels), repita a cópia aqui.

import { createClient } from "npm:@supabase/supabase-js@2";

// ======================= motor do jogo (copiado de _shared/capmart/engine) =======================

type Product = number;
interface Slot { item: Product | null; behind: Product[]; unlockAt: number }
type Board = Slot[][];
interface Position { row: number; col: number }
interface Move { from: Position; to: Position }
type Objective = { kind: "clear" } | { kind: "order"; product: Product; count: number } | { kind: "score"; target: number };
interface Level { id: number; pack: number; name: string; seed: number; board: Board; types: number; seconds: number | null; moves: number | null; objective: Objective; stars: [number, number]; difficulty: string; mechanics: string[]; dailyDay?: string; configVersion?: number }
interface Snapshot { board: Board; score: number; movesUsed: number; matches: number; collected: Record<number, number>; combo: number; lastMatchAt: number | null }
type GameEvent = { elapsed: number; kind: "move"; move: Move } | { elapsed: number; kind: "help"; help: "undo" | "hint" | "time" | "shuffle" };
interface Game extends Snapshot { level: Level; remaining: number | null; elapsed: number; status: "playing" | "won" | "lost"; reason?: string; history: Snapshot[]; assisted: boolean; hints: Move | null; lastCleared: Position[]; resultScore?: number; events: GameEvent[] }
interface Result { runId: string; levelId: number; seed: number; score: number; stars: number; won: boolean; assisted: boolean; elapsed: number; moves: number; daily: boolean; dailyDay?: string; events: GameEvent[]; configVersion?: number }
type Help = "undo" | "hint" | "time" | "shuffle";

const RULES = { match: [100, 150, 200, 250], comboSeconds: 5, completion: 300, second: 5, move: 20, extraSeconds: 30, costs: { undo: 5, hint: 10, time: 15, shuffle: 20 }, rewards: { completion: 5, threeStars: 3, firstDailyWin: 5, dailyChallenge: 10 } } as const;
const PRODUCTS_LENGTH = 25; // só o tamanho importa aqui (índice dos produtos pro motor); ícone/nome/cor são só da UI

function rng(seed: number) { let state = seed >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; }
function shuffled<T>(values: T[], seed: number): T[] { const a = [...values], random = rng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const cloneBoard = (b: Board): Board => b.map(row => row.map(s => ({ ...s, behind: [...s.behind] })));
function startGame(level: Level): Game { return { level, board: cloneBoard(level.board), score: 0, movesUsed: 0, matches: 0, collected: {}, combo: 0, lastMatchAt: null, remaining: level.seconds, elapsed: 0, status: "playing", history: [], assisted: false, hints: null, lastCleared: [], events: [] }; }
const same = (a: Position, b: Position) => a.row === b.row && a.col === b.col;
function validMove(g: Game, m: Move): boolean { const a = g.board[m.from.row]?.[m.from.col], b = g.board[m.to.row]?.[m.to.col]; return g.status === "playing" && !same(m.from, m.to) && !!a && !!b && a.unlockAt <= g.matches && b.unlockAt <= g.matches && a.item !== null && a.item !== b.item; }
function snapshot(g: Game): Snapshot { return { board: cloneBoard(g.board), score: g.score, movesUsed: g.movesUsed, matches: g.matches, collected: { ...g.collected }, combo: g.combo, lastMatchAt: g.lastMatchAt }; }
function resolve(g: Game, award: boolean): void {
  let found = true;
  while (found) {
    found = false;
    g.board.forEach((row, r) => {
      const groups = new Map<number, number[]>(); row.forEach((s, c) => { if (s.item !== null && s.unlockAt <= g.matches) groups.set(s.item, [...(groups.get(s.item) ?? []), c]); });
      for (const [item, cols] of groups) if (cols.length >= 3) {
        found = true; g.matches++; g.collected[item] = (g.collected[item] ?? 0) + 3;
        if (award) { g.combo = g.lastMatchAt !== null && g.elapsed - g.lastMatchAt <= RULES.comboSeconds ? g.combo + 1 : 1; g.score += RULES.match[Math.min(g.combo - 1, 3)]; g.lastMatchAt = g.elapsed; }
        cols.slice(0, 3).forEach(c => { g.lastCleared.push({ row: r, col: c }); row[c].item = null; });
      }
      if (row.every(s => s.item === null) && row.some(s => s.behind.length)) { row.forEach(s => { s.item = s.behind.shift() ?? null; }); found = true; }
    });
  }
}
function objectiveMet(g: Game): boolean { const o = g.level.objective; return o.kind === "clear" ? g.board.every(r => r.every(s => s.item === null && !s.behind.length)) : o.kind === "order" ? (g.collected[o.product] ?? 0) >= o.count : g.score >= o.target; }
function finish(g: Game): Game { if (objectiveMet(g)) { g.status = "won"; g.resultScore = g.score + RULES.completion + Math.floor(g.remaining ?? 0) * RULES.second + Math.max(0, (g.level.moves ?? g.movesUsed) - g.movesUsed) * RULES.move; } else if (g.remaining !== null && g.remaining <= 0) { g.status = "lost"; g.reason = "O tempo acabou. Vamos tentar de novo?"; } else if (g.level.moves !== null && g.movesUsed >= g.level.moves) { g.status = "lost"; g.reason = "Os movimentos acabaram. Cada troca faz diferença!"; } else if (!hasValidMoves(g)) { g.status = "lost"; g.reason = "Não há movimentos válidos no estoque."; } return g; }
function move(g: Game, m: Move): Game { if (!validMove(g, m)) return g; const next: Game = { ...g, board: cloneBoard(g.board), collected: { ...g.collected }, history: [...g.history, snapshot(g)], movesUsed: g.movesUsed + 1, hints: null, lastCleared: [], events: [...g.events, { kind: "move", move: structuredClone(m), elapsed: g.elapsed }] }; const a = next.board[m.from.row][m.from.col], b = next.board[m.to.row][m.to.col]; [a.item, b.item] = [b.item, a.item]; resolve(next, true); return finish(next); }
function tick(g: Game, seconds: number): Game { if (g.status !== "playing" || !Number.isFinite(seconds) || seconds <= 0) return g; const next = { ...g, elapsed: g.elapsed + seconds, remaining: g.remaining === null ? null : Math.max(0, g.remaining - seconds), lastCleared: [] }; if (next.lastMatchAt !== null && next.elapsed - next.lastMatchAt > RULES.comboSeconds) next.combo = 0; return finish(next); }
function hasValidMoves(g: Game): boolean { const p = g.board.flatMap((row, r) => row.map((s, c) => ({ s, pos: { row: r, col: c } }))).filter(x => x.s.unlockAt <= g.matches); return p.some(a => a.s.item !== null && p.some(b => !same(a.pos, b.pos) && a.s.item !== b.s.item)); }
function hint(g: Game): Move | null {
  for (let r = 0; r < g.board.length; r++) {
    const row = g.board[r], accessible = row.map((s, c) => ({ s, c })).filter(x => x.s.unlockAt <= g.matches);
    const candidates = [...new Set(accessible.map(x => x.s.item).filter(x => x !== null))] as number[];
    candidates.sort((a, b) => accessible.filter(x => x.s.item === b).length - accessible.filter(x => x.s.item === a).length);
    for (const item of candidates) {
      const matching = accessible.filter(x => x.s.item === item);
      const source = g.board.flatMap((rr, ri) => rr.map((s, c) => ({ s, pos: { row: ri, col: c } }))).find(x => x.pos.row !== r && x.s.item === item && x.s.unlockAt <= g.matches);
      if (source && matching.length < 3) {
        const dest = accessible.filter(x => x.s.item !== item).sort((a, b) => Number(a.s.item !== null) - Number(b.s.item !== null))[0];
        if (dest) return { from: source.pos, to: { row: r, col: dest.c } };
      }
    }
  }
  return null;
}
function applyHelp(g: Game, help: Help): Game {
  if (g.status !== "playing") return g;
  const events: Game["events"] = [...g.events, { kind: "help", help, elapsed: g.elapsed }];
  if (help === "undo") { const previous = g.history.at(-1); return previous ? { ...g, ...previous, board: cloneBoard(previous.board), collected: { ...previous.collected }, history: g.history.slice(0, -1), combo: 0, lastMatchAt: null, hints: null, lastCleared: [], assisted: true, events } : g; }
  if (help === "hint") { const m = hint(g); return m ? { ...g, assisted: true, hints: m, events } : g; }
  if (help === "time") return g.remaining === null ? g : { ...g, remaining: g.remaining + RULES.extraSeconds, assisted: true, events };
  const board = cloneBoard(g.board), cells = board.flat().filter(s => s.unlockAt <= g.matches && s.item !== null);
  const originalItems = cells.map(s => s.item!);
  for (let attempt = 0; attempt < 64; attempt++) {
    const items = shuffled(originalItems, g.level.seed + g.movesUsed + Math.floor(g.elapsed * 1000) + attempt * 104729);
    cells.forEach((s, i) => { s.item = items[i]; });
    if (g.level.objective.kind !== "score" || !board.some(row => row.some(s => s.item !== null && row.filter(x => x.item === s.item).length >= 3))) break;
    if (attempt === 63) return { ...g, assisted: true, events, hints: null, history: [] };
  }
  const next = { ...g, board, collected: { ...g.collected }, combo: 0, lastMatchAt: null, history: [], assisted: true, hints: null, lastCleared: [], events }; resolve(next, false);
  return finish(next);
}
function stars(score: number, targets: [number, number], won = true): number { return won ? score >= targets[1] ? 3 : score >= targets[0] ? 2 : 1 : 0; }

function validateReplay(level: Level, result: Result): Game {
  if ((level.configVersion ?? 1) !== (result.configVersion ?? 1) || level.id !== result.levelId || level.seed !== result.seed || !Number.isFinite(result.elapsed) || result.elapsed < 0 || result.events.length > 10000) throw new Error("Partida inválida.");
  let game = startGame(level);
  for (const event of result.events) {
    if (!Number.isFinite(event.elapsed) || event.elapsed < game.elapsed || event.elapsed > result.elapsed || game.status !== "playing") throw new Error("Cronologia inválida.");
    game = tick(game, event.elapsed - game.elapsed);
    if (event.kind === "move") { if (!validMove(game, event.move)) throw new Error("Movimento inválido."); game = move(game, event.move); }
    else { if (event.kind !== "help" || !["undo", "hint", "time", "shuffle"].includes(event.help)) throw new Error("Evento inválido."); const next = applyHelp(game, event.help); if (next === game) throw new Error("Ajuda inválida."); game = next; }
  }
  game = tick(game, result.elapsed - game.elapsed);
  const score = game.resultScore ?? game.score;
  if (game.status === "playing" || score !== result.score || (game.status === "won") !== result.won || game.assisted !== result.assisted || game.movesUsed !== result.moves || stars(score, level.stars, result.won) !== result.stars) throw new Error("Resultado divergente do replay.");
  return game;
}

// ======================= fases (copiado de _shared/capmart/levels) =======================

const LEGACY_PACKS = ["Portas abertas", "Feira fresquinha", "Segredos do estoque", "Cada movimento conta", "Lista de compras", "Mercado mestre", "Novas prateleiras", "Estoque gigante", "Mercado completo", "Desafio final", "Lenda do mercadinho"];
function legacyMakeLevel(id: number, seed = id * 7919): Level {
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
  const board: Board = Array.from({ length: rows }, (_, r) => Array.from({ length: 3 }, (_, c) => ({ item: items[r * 3 + c], behind: Array.from({ length: depth }, (_, d) => palette[(r + d + 1) % types]), unlockAt: 0 })));
  if (pack >= 2) board.forEach((row, r) => row.push({ item: null, behind: [], unlockAt: r % 2 === 0 ? 1 + (r % 3) : 0 }));
  const totalTrios = rows * (depth + 1);
  const actualTypes = new Set(board.flatMap(row => row.flatMap(s => [s.item, ...s.behind].filter(v => v !== null)))).size;
  const orderStock = board.flat().reduce((sum, s) => sum + Number(s.item === palette[1]) + s.behind.filter(p => p === palette[1]).length, 0);
  const objective: Level["objective"] = pack >= 4 && n % 3 === 0 ? { kind: "order", product: palette[1], count: Math.min(orderStock, 3 * (depth + 1)) } : pack >= 4 && n % 3 === 1 ? { kind: "score", target: Math.max(300, totalTrios * 75) } : { kind: "clear" };
  const seconds = pack >= 3 && n % 2 === 0 ? null : 100 + rows * 12 + depth * 15 - n * 3;
  const moves = pack >= 3 ? rows * 4 + 6 - Math.floor(n / 3) : null;
  const bonus = (seconds ?? 0) * 3 + (moves ?? 0) * 10;
  const base = objective.kind === "order" ? 250 : objective.kind === "score" ? objective.target : totalTrios * 100;
  return { id, pack, seed, name: LEGACY_PACKS[pack], board, types: actualTypes, seconds, moves, objective, stars: [base + 300 + Math.floor(bonus * .35), base + 300 + Math.floor(bonus * .8)], difficulty: ["Suave", "Leve", "Moderada", "Desafiadora", "Difícil", "Especialista", "Avançada", "Intensa", "Extrema", "Mestre", "Lendária"][pack], mechanics: [seconds !== null ? "tempo" : "clássica", ...(depth ? ["estoque escondido", "espaços bloqueados"] : []), ...(moves ? ["movimentos limitados"] : []), ...(objective.kind === "order" ? ["pedido especial"] : objective.kind === "score" ? ["meta de pontos"] : [])] };
}
function legacyDailyLevel(day: string): Level { let seed = 0; for (const ch of day) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0; return { ...legacyMakeLevel(45, seed), name: "Desafio diário", dailyDay: day }; }

const CONFIG_VERSION = 2;
const TRIOS_BASE = [0, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33];
function makeLevel(id: number, seed = id * 7919): Level {
  const original = legacyMakeLevel(id, seed), pack = original.pack, n = (id - 1) % 10;
  if (pack === 0) return { ...original, configVersion: CONFIG_VERSION };
  const trios = TRIOS_BASE[pack] + Math.floor(n / 3);
  const rows = trios + 2;
  const types = pack <= 5 ? Math.min(12, 4 + pack + Math.floor(n / 3)) : Math.min(PRODUCTS_LENGTH, 12 + (pack - 5) * 3 + Math.floor(n / 3));
  const palette = shuffled(Array.from({ length: pack <= 5 ? 12 : PRODUCTS_LENGTH }, (_, i) => i), seed).slice(0, types);
  const inventory: (number | null)[] = Array.from({ length: trios * 3 }, (_, i) => palette[Math.floor(i / 3) % types]);
  inventory.push(...Array<number | null>(6).fill(null));
  let front = shuffled(inventory, seed + 1);
  for (let attempt = 0; attempt < 256; attempt++) {
    front = shuffled(inventory, seed + 1 + attempt * 104729);
    for (let c = rows * 3 - 3; c < rows * 3; c++) if (front[c] !== null) {
      const gap = front.findIndex((p, i) => p === null && i < rows * 3 - 3);
      [front[c], front[gap]] = [front[gap], front[c]];
    }
    const groups = Array.from({ length: rows }, (_, r) => front.slice(r * 3, r * 3 + 3));
    if (!groups.some(row => row[0] !== null && row.every(p => p === row[0])) && !groups.slice(0, trios).some(row => row.every(p => p === null))) break;
  }
  const depth = pack >= 2 ? (pack >= 4 ? 2 : 1) : 0;
  const board: Board = Array.from({ length: rows }, (_, r) => Array.from({ length: 3 }, (_, c) => ({
    item: front[r * 3 + c],
    behind: r < trios && front.slice(r * 3, r * 3 + 3).some(p => p !== null) ? Array.from({ length: depth }, (_, d) => palette[(r + d + 1) % types]) : [],
    unlockAt: 0,
  })));
  if (pack >= 2) {
    const empty = board.flat().filter(s => s.item === null && !s.behind.length);
    empty.slice(0, Math.min(3, empty.length)).forEach((s, i) => { s.unlockAt = 1 + i; });
  }
  const all = board.flat().flatMap(s => [...(s.item === null ? [] : [s.item]), ...s.behind]);
  const totalTrios = all.length / 3, orderStock = all.filter(p => p === palette[1]).length;
  const objective: Level["objective"] = pack >= 4 && n % 3 === 0 ? { kind: "order", product: palette[1], count: Math.min(orderStock, 6 + Math.floor(n / 3) * 3) } : pack >= 4 && n % 3 === 1 ? { kind: "score", target: Math.max(900, totalTrios * 85) } : { kind: "clear" };
  const seconds = original.seconds === null ? null : 100 + trios * 8 + depth * 12 - n * 2;
  const moves = pack >= 3 ? trios * 4 + 12 - Math.floor(n / 3) : null;
  const bonus = (seconds ?? 0) * 3 + (moves ?? 0) * 10;
  const base = objective.kind === "order" ? 400 : objective.kind === "score" ? objective.target : totalTrios * 100;
  return { ...original, configVersion: CONFIG_VERSION, board, types: new Set(all).size, seconds, moves, objective, stars: [base + 300 + Math.floor(bonus * .35), base + 300 + Math.floor(bonus * .8)], mechanics: [...original.mechanics, "espaços estratégicos"] };
}
function dailyLevel(day: string): Level { const old = legacyDailyLevel(day); return { ...makeLevel(45, old.seed), name: old.name, dailyDay: day }; }
function levelForVersion(id: number, seed: number, version = 1): Level {
  if (version === 1) return legacyMakeLevel(id, seed);
  if (version === CONFIG_VERSION) return makeLevel(id, seed);
  throw new Error("Versão de fase desconhecida.");
}
function localDay(date = new Date()): string { return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }

// ======================= Edge Function em si =======================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "não autenticado" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "sessão inválida" }, 401);
    const userId = userData.user.id;

    const body = await req.json();
    const result = body.result as Result;
    const walletMode = body.walletMode as string;
    const coupleId = body.coupleId as string | null;
    const friendGroupId = body.friendGroupId as string | null;
    if (walletMode !== "casal" && walletMode !== "turma") return json({ error: "contexto inválido" }, 400);

    if (!result || !Number.isInteger(result.levelId) || result.levelId < 1 || result.levelId > 110
      || !Number.isFinite(result.score) || result.score < 0
      || !Number.isInteger(result.stars) || result.stars < 0 || result.stars > 3
      || (result.won && result.stars === 0)
      || !result.runId || typeof result.runId !== "string" || !Array.isArray(result.events)) {
      return json({ error: "resultado inválido" }, 400);
    }

    const { data: existing } = await admin.from("capmart_results").select("*").eq("run_id", result.runId).maybeSingle();
    if (existing) {
      const { data: progress } = await admin.from("capmart_progress").select("*").eq("user_id", userId).maybeSingle();
      const balance = await getBalance(admin, walletMode, coupleId, friendGroupId, userId);
      return json({ balance, awarded: existing.awarded, previousRecord: 0, progress: progressJson(progress) });
    }

    const configVersion = result.configVersion ?? 1;
    const today = localDay();
    const yesterday = new Date(Date.parse(today + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
    const challengeDay = result.dailyDay ?? today;

    if (!result.daily && result.seed !== result.levelId * 7919) return json({ error: "configuração de campanha inválida" }, 400);
    if (result.daily && challengeDay !== today && challengeDay !== yesterday) return json({ error: "desafio diário expirado" }, 400);
    if (result.daily && (result.levelId !== 45 || result.seed !== dailyLevel(challengeDay).seed)) return json({ error: "desafio diário inválido" }, 400);

    if (!result.daily) {
      const { data: progress } = await admin.from("capmart_progress").select("unlocked").eq("user_id", userId).maybeSingle();
      const unlocked = progress?.unlocked ?? 1;
      if (result.levelId > unlocked) return json({ error: "fase ainda não desbloqueada" }, 403);
    }

    let game: Game;
    try {
      const level = levelForVersion(result.levelId, result.seed, configVersion);
      game = validateReplay(level, result);
    } catch (e) {
      return json({ error: (e as Error).message || "replay inválido" }, 400);
    }

    const { data: purchases } = await admin.from("capmart_purchases").select("*").eq("user_id", userId).eq("run_id", result.runId).eq("approved", true);
    const used: Record<string, number> = {};
    for (const event of result.events) {
      if (event.kind !== "help") continue;
      if (result.levelId === 1 && event.help === "hint") continue;
      used[event.help] = (used[event.help] ?? 0) + 1;
      const paidCount = (purchases || []).filter((p) => p.help === event.help && p.level_id === result.levelId).length;
      if (used[event.help] > paidCount) return json({ error: "ajuda sem compra confirmada" }, 400);
    }

    const candidateRewards: { id: string; amount: number }[] = [];
    if (result.won) {
      if (!result.daily) {
        candidateRewards.push({ id: `level:${result.levelId}`, amount: RULES.rewards.completion });
        if (result.stars === 3) candidateRewards.push({ id: `stars:${result.levelId}`, amount: RULES.rewards.threeStars });
      }
      candidateRewards.push({ id: `win:${today}`, amount: RULES.rewards.firstDailyWin });
      if (result.daily) candidateRewards.push({ id: `daily:${challengeDay}`, amount: RULES.rewards.dailyChallenge });
    }

    const { data: commit, error: commitErr } = await admin.rpc("capmart_commit_result", {
      p_user_id: userId, p_run_id: result.runId, p_level_id: result.levelId, p_seed: result.seed, p_config_version: configVersion,
      p_score: game.resultScore ?? game.score, p_stars: result.stars, p_won: result.won, p_assisted: result.assisted,
      p_elapsed: result.elapsed, p_moves: result.moves, p_daily: result.daily, p_daily_day: result.daily ? challengeDay : null,
      p_wallet_mode: walletMode, p_couple_id: coupleId, p_friend_group_id: friendGroupId,
      p_candidate_rewards: candidateRewards,
    });
    if (commitErr) throw commitErr;

    return json(commit);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

async function getBalance(admin: ReturnType<typeof createClient>, walletMode: string, coupleId: string | null, friendGroupId: string | null, userId: string) {
  if (walletMode === "casal") {
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    const { data } = await admin.from("coin_balances").select("balance").eq("couple_id", coupleId).eq("role", profile?.role).maybeSingle();
    return data?.balance ?? 0;
  }
  const { data } = await admin.from("friend_coin_balances").select("balance").eq("friend_group_id", friendGroupId).maybeSingle();
  return data?.balance ?? 0;
}

function progressJson(p: any) {
  return {
    version: 1 as const,
    unlocked: p?.unlocked ?? 1,
    records: p?.records ?? {},
    tutorialDone: p?.tutorial_done ?? false,
    preferences: p?.preferences ?? { sound: true, reducedMotion: false },
  };
}
