import type { Board, Level } from '../engine/types';
import { shuffled } from '../engine/random';
// os 6 primeiros são os originais aprovados, intocados (packs 0-5, fases 1-60 continuam
// exatamente iguais). Os 5 de baixo são novos, pras fases 61-110.
export const PACKS = ['Portas abertas', 'Feira fresquinha', 'Segredos do estoque', 'Cada movimento conta', 'Lista de compras', 'Mercado mestre', 'Novas prateleiras', 'Estoque gigante', 'Mercado completo', 'Desafio final', 'Lenda do mercadinho'];
export function makeLevel(id: number, seed = id * 7919): Level {
  const pack = Math.floor((id - 1) / 10), n = (id - 1) % 10;
  const rows = Math.min(8, 3 + Math.floor((id - 1) / 10) + (n >= 5 ? 1 : 0));
  const types = Math.min(12, 3 + pack + Math.floor(n / 3));
  const palette = shuffled(Array.from({ length: 12 }, (_, i) => i), seed).slice(0, types);
  const items = shuffled(Array.from({ length: rows * 3 }, (_, i) => palette[Math.floor(i / 3) % types]), seed + 1);
  // Avoid matches on entry; swap one cell from any accidental triple with a different row.
  for (let r = 0; r < rows; r++) if (items[r * 3] === items[r * 3 + 1] && items[r * 3] === items[r * 3 + 2]) {
    const other = items.findIndex((v, i) => Math.floor(i / 3) !== r && v !== items[r * 3]);
    [items[r * 3 + 2], items[other]] = [items[other], items[r * 3 + 2]];
  }
  const depth = pack >= 2 ? 1 + (pack >= 4 && n >= 4 ? 1 : 0) : 0;
  const board: Board = Array.from({ length: rows }, (_, r) => Array.from({ length: 3 }, (_, c) => ({ item: items[r * 3 + c], behind: Array.from({ length: depth }, (_, d) => palette[(r + d + 1) % types]), unlockAt: 0 })));
  // A fourth empty space is an optional locked buffer. No essential product is locked.
  if (pack >= 2) board.forEach((row, r) => row.push({ item: null, behind: [], unlockAt: r % 2 === 0 ? 1 + (r % 3) : 0 }));
  const totalTrios = rows * (depth + 1);
  const actualTypes = new Set(board.flatMap(row => row.flatMap(s => [s.item, ...s.behind].filter(v => v !== null)))).size;
  const orderStock = board.flat().reduce((sum, s) => sum + Number(s.item === palette[1]) + s.behind.filter(p => p === palette[1]).length, 0);
  const objective: Level['objective'] = pack >= 4 && n % 3 === 0 ? { kind: 'order', product: palette[1], count: Math.min(orderStock, 3 * (depth + 1)) } : pack >= 4 && n % 3 === 1 ? { kind: 'score', target: Math.max(300, totalTrios * 75) } : { kind: 'clear' };
  const seconds = pack >= 3 && n % 2 === 0 ? null : 100 + rows * 12 + depth * 15 - n * 3;
  const moves = pack >= 3 ? rows * 4 + 6 - Math.floor(n / 3) : null;
  const bonus = (seconds ?? 0) * 3 + (moves ?? 0) * 10;
  const base = objective.kind === 'order' ? 250 : objective.kind === 'score' ? objective.target : totalTrios * 100;
  return { id, pack, seed, name: PACKS[pack], board, types: actualTypes, seconds, moves, objective, stars: [base + 300 + Math.floor(bonus * .35), base + 300 + Math.floor(bonus * .8)], difficulty: ['Suave', 'Leve', 'Moderada', 'Desafiadora', 'Difícil', 'Especialista', 'Avançada', 'Intensa', 'Extrema', 'Mestre', 'Lendária'][pack], mechanics: [seconds !== null ? 'tempo' : 'clássica', ...(depth ? ['estoque escondido', 'espaços bloqueados'] : []), ...(moves ? ['movimentos limitados'] : []), ...(objective.kind === 'order' ? ['pedido especial'] : objective.kind === 'score' ? ['meta de pontos'] : [])] };
}
export const LEVELS = Array.from({ length: 60 }, (_, i) => makeLevel(i + 1));
export function dailyLevel(day: string): Level { let seed = 0; for (const ch of day) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0; return { ...makeLevel(45, seed), name: 'Desafio diário', dailyDay: day }; }
