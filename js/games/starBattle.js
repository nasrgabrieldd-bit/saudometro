// Motor puro do jogo "Capivarinhas" (estilo Star Battle / Queens): não sabe nada sobre casal,
// turma, Supabase ou moedas. Só sabe ciclar uma jogada e dizer se o tabuleiro está resolvido.
// Pensado assim de propósito: se um dia isso virar um app próprio, essa pasta inteira já serve
// de base, sem precisar reescrever a lógica do jogo.
//
// Regra: uma peça por linha, uma por coluna, uma por região; peças não podem se tocar,
// nem na diagonal.
//
// As 100 fases já vêm prontas e validadas (uma solução única cada) em starBattleLevels.js,
// geradas offline por scripts/generate-star-battle-levels.mjs — gerar um tabuleiro assim, do
// jeito que garante solução única, é caro (às vezes precisa de milhares de tentativas pra achar
// um que não tenha solução ambígua), então isso roda uma vez só, no computador, não no celular
// de quem está jogando.

export const CELL_EMPTY = 0, CELL_MARK = 1, CELL_PIECE = 2;

export function cycleCell(state) {
  return (state + 1) % 3;
}

export function emptyGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(CELL_EMPTY));
}

function touches(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
}

// confere se o tabuleiro atual (só olhando onde tem peça) satisfaz todas as regras
export function checkWin(size, regions, grid) {
  const pieces = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === CELL_PIECE) pieces.push([r, c]);
    }
  }
  if (pieces.length !== size) return false;
  const rows = new Set(), cols = new Set(), regionsUsed = new Set();
  for (const [r, c] of pieces) {
    if (rows.has(r) || cols.has(c) || regionsUsed.has(regions[r][c])) return false;
    rows.add(r); cols.add(c); regionsUsed.add(regions[r][c]);
  }
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (touches(pieces[i][0], pieces[i][1], pieces[j][0], pieces[j][1])) return false;
    }
  }
  return true;
}
