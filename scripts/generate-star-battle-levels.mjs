// Gera as 100 fases do Capivarinhas (estilo Star Battle / Queens) e escreve o resultado em
// js/games/starBattleLevels.js. Roda uma vez só, aqui no computador — não faz parte do app que
// vai pro celular. Pra gerar de novo (ex.: mudar a curva de dificuldade), roda:
//   node scripts/generate-star-battle-levels.mjs
import { writeFileSync } from "fs";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function touches(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
}

function placeSolution(n, rng) {
  const solution = [];
  function backtrack(row, usedCols) {
    if (row === n) return true;
    const order = Array.from({ length: n }, (_, i) => i).filter((c) => !usedCols.has(c));
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const c of order) {
      const prev = solution[row - 1];
      if (prev && touches(row - 1, prev[1], row, c)) continue;
      solution[row] = [row, c];
      usedCols.add(c);
      if (backtrack(row + 1, usedCols)) return true;
      usedCols.delete(c);
      solution.length = row;
    }
    return false;
  }
  return backtrack(0, new Set()) ? solution : null;
}

function growRegions(n, solution, rng) {
  const regions = Array.from({ length: n }, () => Array(n).fill(-1));
  const frontier = [];
  solution.forEach(([r, c], id) => { regions[r][c] = id; frontier.push({ r, c, id }); });
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  while (frontier.length) {
    const idx = Math.floor(rng() * frontier.length);
    const { r, c, id } = frontier[idx];
    const options = dirs
      .map(([dr, dc]) => [r + dr, c + dc])
      .filter(([nr, nc]) => nr >= 0 && nr < n && nc >= 0 && nc < n && regions[nr][nc] === -1);
    if (!options.length) { frontier.splice(idx, 1); continue; }
    const [nr, nc] = options[Math.floor(rng() * options.length)];
    regions[nr][nc] = id;
    frontier.push({ r: nr, c: nc, id });
  }
  return regions;
}

function countSolutions(n, regions, limit) {
  let count = 0;
  const usedCols = new Set(); const usedRegions = new Set(); const placed = [];
  function backtrack(row) {
    if (count >= limit) return;
    if (row === n) { count++; return; }
    for (let c = 0; c < n; c++) {
      if (usedCols.has(c)) continue;
      const region = regions[row][c];
      if (usedRegions.has(region)) continue;
      const prev = placed[row - 1];
      if (prev && touches(row - 1, prev[1], row, c)) continue;
      usedCols.add(c); usedRegions.add(region); placed[row] = [row, c];
      backtrack(row + 1);
      usedCols.delete(c); usedRegions.delete(region); placed.length = row;
      if (count >= limit) return;
    }
  }
  backtrack(0);
  return count;
}

function sizeForLevel(level) {
  if (level <= 10) return 5;
  if (level <= 25) return 6;
  if (level <= 45) return 7;
  if (level <= 70) return 8;
  if (level <= 90) return 9;
  return 10;
}

function generateLevel(level, maxAttempts) {
  const n = sizeForLevel(level);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = mulberry32(Date.now() ^ (level * 2654435761) ^ (attempt * 2246822519));
    const solution = placeSolution(n, rng);
    if (!solution) continue;
    const regions = growRegions(n, solution, rng);
    if (countSolutions(n, regions, 2) === 1) {
      return { level, size: n, regions };
    }
  }
  throw new Error(`não deu pra gerar a fase ${level} (tamanho ${n}) em ${maxAttempts} tentativas`);
}

const MAX_LEVEL = 100;
const levels = [];
const start = Date.now();
for (let level = 1; level <= MAX_LEVEL; level++) {
  const attemptsBudget = sizeForLevel(level) >= 9 ? 200000 : 20000;
  const result = generateLevel(level, attemptsBudget);
  levels.push(result);
  process.stdout.write(`fase ${level} (${result.size}x${result.size}) ok\n`);
}
console.log(`\n${MAX_LEVEL} fases geradas em ${((Date.now() - start) / 1000).toFixed(1)}s`);

const out = `// Gerado por scripts/generate-star-battle-levels.mjs — não editar na mão.
// Cada fase já vem com solução única confirmada (ver o script pra saber como).
export const STAR_BATTLE_LEVELS = ${JSON.stringify(levels)};
`;
writeFileSync(new URL("../js/games/starBattleLevels.js", import.meta.url), out);
console.log("escrito em js/games/starBattleLevels.js");
