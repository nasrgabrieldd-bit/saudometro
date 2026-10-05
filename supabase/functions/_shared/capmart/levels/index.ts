import type { Board, Level } from '../engine/types';
import { shuffled } from '../engine/random';
import { makeLevel as legacyLevel, dailyLevel as legacyDaily } from './legacy';
export { PACKS } from './legacy';
export const CONFIG_VERSION = 2;
export function makeLevel(id: number, seed = id * 7919): Level {
  const original = legacyLevel(id, seed), pack = original.pack, n = (id - 1) % 10;
  if (pack === 0) return { ...original, configVersion: CONFIG_VERSION };
  const trios = [0, 6, 9, 12, 15, 18][pack] + Math.floor(n / 3);
  const rows = trios + 2, types = Math.min(12, 4 + pack + Math.floor(n / 3));
  const palette = shuffled(Array.from({ length: 12 }, (_, i) => i), seed).slice(0, types);
  const inventory: (number | null)[] = Array.from({ length: trios * 3 }, (_, i) => palette[Math.floor(i / 3) % types]);
  inventory.push(...Array<number | null>(6).fill(null));
  let front = shuffled(inventory, seed + 1);
  for (let attempt = 0; attempt < 256; attempt++) {
    front = shuffled(inventory, seed + 1 + attempt * 104729);
    // A genuine reserve compartment plus three scattered strategic gaps.
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
  const objective: Level['objective'] = pack >= 4 && n % 3 === 0 ? { kind: 'order', product: palette[1], count: Math.min(orderStock, 6 + Math.floor(n / 3) * 3) } : pack >= 4 && n % 3 === 1 ? { kind: 'score', target: Math.max(900, totalTrios * 85) } : { kind: 'clear' };
  const seconds = original.seconds === null ? null : 100 + trios * 8 + depth * 12 - n * 2;
  const moves = pack >= 3 ? trios * 4 + 12 - Math.floor(n / 3) : null;
  const bonus = (seconds ?? 0) * 3 + (moves ?? 0) * 10;
  const base = objective.kind === 'order' ? 400 : objective.kind === 'score' ? objective.target : totalTrios * 100;
  return { ...original, configVersion: CONFIG_VERSION, board, types: new Set(all).size, seconds, moves, objective, stars: [base + 300 + Math.floor(bonus * .35), base + 300 + Math.floor(bonus * .8)], mechanics: [...original.mechanics, 'espaços estratégicos'] };
}
export const LEVELS = Array.from({ length: 60 }, (_, i) => makeLevel(i + 1));
export function dailyLevel(day: string): Level { const old = legacyDaily(day); return { ...makeLevel(45, old.seed), name: old.name, dailyDay: day }; }
export function levelForVersion(id: number, seed: number, version = 1): Level {
  if (version === 1) return legacyLevel(id, seed);
  if (version === CONFIG_VERSION) return makeLevel(id, seed);
  throw new Error('Versão de fase desconhecida.');
}
