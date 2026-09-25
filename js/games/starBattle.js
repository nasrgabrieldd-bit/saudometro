// Motor puro do jogo "Capivarinhas": não sabe nada sobre casal, turma, Supabase ou moedas.
// Pensado assim de propósito: se um dia isso virar um app próprio, essa pasta inteira já
// serve de base, sem precisar reescrever a lógica do jogo.
//
// Como funciona de verdade (igual ao jogo de referência): a capivara de cada fase já está
// escondida num lugar fixo desde que a fase foi criada. A pessoa não "coloca" capivara livre —
// ela precisa DESCOBRIR onde estão, tocando pra revelar. Regra de fundo: uma capivara por
// linha, uma por coluna, uma por região de cor; capivaras nunca se tocam (nem na diagonal).
//
// Toque 1 numa casa vazia: só marca ✕ (nota da pessoa, sem risco nenhum — "aqui não tem").
// Toque 2 na mesma casa (já marcada): revela de verdade. Se tinha capivara escondida, confirma
// (conta pro placar, vira permanente). Se não tinha, perde um coração e a casa fica marcada ✕
// mesmo assim (agora é certeza, não só palpite).
//
// As 100 fases já vêm prontas com a posição escondida de cada capivara, geradas offline por
// scripts/generate-star-battle-levels.mjs com solução única confirmada — gerar assim é caro
// (às vezes precisa de milhares de tentativas pra achar uma fase sem ambiguidade), então isso
// roda uma vez só no computador, não no celular de quem está jogando.

export const CELL_EMPTY = 0, CELL_MARK = 1, CELL_CAT = 2;

export function emptyGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(CELL_EMPTY));
}

// toque numa casa vazia: só marca, nunca arrisca nada
export function markCell(grid, r, c) {
  if (grid[r][c] === CELL_EMPTY) grid[r][c] = CELL_MARK;
}

// toque numa casa já marcada: revela de verdade contra a posição escondida da fase
export function revealCell(solution, grid, r, c) {
  if (grid[r][c] !== CELL_MARK) return null;
  const hasCapybara = solution.some(([sr, sc]) => sr === r && sc === c);
  grid[r][c] = hasCapybara ? CELL_CAT : CELL_MARK;
  return hasCapybara;
}

export function countFound(grid) {
  return grid.flat().filter((s) => s === CELL_CAT).length;
}
