import { RULES, type Help } from './config';
import type { Board, Game, Level, Move, Position, Snapshot } from './types';
import { shuffled } from './random';
export const cloneBoard = (b: Board): Board => b.map(row => row.map(s => ({ ...s, behind: [...s.behind] })));
export function startGame(level: Level): Game { return { level, board: cloneBoard(level.board), score: 0, movesUsed: 0, matches: 0, collected: {}, combo: 0, lastMatchAt: null, remaining: level.seconds, elapsed: 0, status: 'playing', history: [], assisted: false, hints: null, lastCleared: [], events: [] }; }
const same = (a: Position, b: Position) => a.row === b.row && a.col === b.col;
export function validMove(g: Game, m: Move): boolean { const a = g.board[m.from.row]?.[m.from.col], b = g.board[m.to.row]?.[m.to.col]; return g.status === 'playing' && !same(m.from, m.to) && !!a && !!b && a.unlockAt <= g.matches && b.unlockAt <= g.matches && a.item !== null && a.item !== b.item; }
function snapshot(g: Game): Snapshot { return { board: cloneBoard(g.board), score: g.score, movesUsed: g.movesUsed, matches: g.matches, collected: { ...g.collected }, combo: g.combo, lastMatchAt: g.lastMatchAt }; }
function resolve(g: Game, award: boolean): void {
  let found = true;
  while (found) { found = false;
    g.board.forEach((row, r) => {
      const groups = new Map<number, number[]>(); row.forEach((s, c) => { if (s.item !== null && s.unlockAt <= g.matches) groups.set(s.item, [...(groups.get(s.item) ?? []), c]); });
      for (const [item, cols] of groups) if (cols.length >= 3) {
        found = true; g.matches++; g.collected[item] = (g.collected[item] ?? 0) + 3;
        if (award) { g.combo = g.lastMatchAt !== null && g.elapsed - g.lastMatchAt <= RULES.comboSeconds ? g.combo + 1 : 1; g.score += RULES.match[Math.min(g.combo - 1, 3)]; g.lastMatchAt = g.elapsed; }
        cols.slice(0, 3).forEach(c => { g.lastCleared.push({ row: r, col: c }); row[c].item = null; });
      }
      // The complete front of this shelf covers the next stock layer. Reveal
      // only after it is empty, including its optional buffer, preserving trios.
      if (row.every(s => s.item === null) && row.some(s => s.behind.length)) {
        row.forEach(s => { s.item = s.behind.shift() ?? null; }); found = true;
      }
    });
  }
}
export function objectiveMet(g: Game): boolean { const o = g.level.objective; return o.kind === 'clear' ? g.board.every(r => r.every(s => s.item === null && !s.behind.length)) : o.kind === 'order' ? (g.collected[o.product] ?? 0) >= o.count : g.score >= o.target; }
function finish(g: Game): Game { if (objectiveMet(g)) { g.status = 'won'; g.resultScore = g.score + RULES.completion + Math.floor(g.remaining ?? 0) * RULES.second + Math.max(0, (g.level.moves ?? g.movesUsed) - g.movesUsed) * RULES.move; } else if (g.remaining !== null && g.remaining <= 0) { g.status = 'lost'; g.reason = 'O tempo acabou. Vamos tentar de novo?'; } else if (g.level.moves !== null && g.movesUsed >= g.level.moves) { g.status = 'lost'; g.reason = 'Os movimentos acabaram. Cada troca faz diferença!'; } else if (!hasValidMoves(g)) { g.status = 'lost'; g.reason = 'Não há movimentos válidos no estoque.'; } return g; }
export function move(g: Game, m: Move): Game { if (!validMove(g, m)) return g; const next: Game = { ...g, board: cloneBoard(g.board), collected: { ...g.collected }, history: [...g.history, snapshot(g)], movesUsed: g.movesUsed + 1, hints: null, lastCleared: [], events: [...g.events, { kind: 'move', move: structuredClone(m), elapsed: g.elapsed }] }; const a = next.board[m.from.row][m.from.col], b = next.board[m.to.row][m.to.col]; [a.item, b.item] = [b.item, a.item]; resolve(next, true); return finish(next); }
export function tick(g: Game, seconds: number): Game { if (g.status !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return g; const next = { ...g, elapsed: g.elapsed + seconds, remaining: g.remaining === null ? null : Math.max(0, g.remaining - seconds), lastCleared: [] }; if (next.lastMatchAt !== null && next.elapsed - next.lastMatchAt > RULES.comboSeconds) next.combo = 0; return finish(next); }
export function hasValidMoves(g: Game): boolean { const p = g.board.flatMap((row, r) => row.map((s, c) => ({ s, pos: { row: r, col: c } }))).filter(x => x.s.unlockAt <= g.matches); return p.some(a => a.s.item !== null && p.some(b => !same(a.pos, b.pos) && a.s.item !== b.s.item)); }
// Constructive solver: front inventory has counts divisible by three. Hidden batches
// are homogeneous triples, so revealing one removes it without stealing front items.
export function hint(g: Game): Move | null {
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
export function applyHelp(g: Game, help: Help): Game {
  if (g.status !== 'playing') return g;
  const events: Game['events'] = [...g.events, { kind: 'help', help, elapsed: g.elapsed }];
  if (help === 'undo') { const previous = g.history.at(-1); return previous ? { ...g, ...previous, board: cloneBoard(previous.board), collected: { ...previous.collected }, history: g.history.slice(0, -1), combo: 0, lastMatchAt: null, hints: null, lastCleared: [], assisted: true, events } : g; }
  if (help === 'hint') { const m = hint(g); return m ? { ...g, assisted: true, hints: m, events } : g; }
  if (help === 'time') return g.remaining === null ? g : { ...g, remaining: g.remaining + RULES.extraSeconds, assisted: true, events };
  const board = cloneBoard(g.board), cells = board.flat().filter(s => s.unlockAt <= g.matches && s.item !== null);
  const originalItems = cells.map(s => s.item!);
  for (let attempt = 0; attempt < 64; attempt++) {
    const items = shuffled(originalItems, g.level.seed + g.movesUsed + Math.floor(g.elapsed * 1000) + attempt * 104729);
    cells.forEach((s, i) => { s.item = items[i]; });
    // Score challenges never lose scoring opportunities to automatic aid matches.
    if (g.level.objective.kind !== 'score' || !board.some(row => row.some(s => s.item !== null && row.filter(x => x.item === s.item).length >= 3))) break;
    if (attempt === 63) return { ...g, assisted: true, events, hints: null, history: [] };
  }
  const next = { ...g, board, collected: { ...g.collected }, combo: 0, lastMatchAt: null, history: [], assisted: true, hints: null, lastCleared: [], events }; resolve(next, false);
  return finish(next);
}
export function stars(score: number, targets: [number, number], won = true): number { return won ? score >= targets[1] ? 3 : score >= targets[0] ? 2 : 1 : 0; }
