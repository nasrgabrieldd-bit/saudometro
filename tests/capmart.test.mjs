// Testes do motor puro do CapMart (sem DOM, sem Supabase). Rodam com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RULES, PRODUCTS, PACKS, LEVELS, makeLevel, dailyLevel,
  startGame, move, tick, applyHelp, hint, validMove, stars, objectiveMet, hasValidMoves,
} from "../js/games/capmart.js";

function solve(game) {
  let g = game, n = 0;
  while (g.status === "playing" && n++ < 20000) {
    const m = hint(g);
    if (!m) throw new Error(`Fase ${g.level.id} sem solução após ${n} trocas`);
    g = move(g, m);
    g = tick(g, 0.5);
  }
  return g;
}

test("LEVELS: 110 fases, todas com board de 3 colunas e tabuleiros distintos", () => {
  assert.equal(LEVELS.length, 110);
  for (const l of LEVELS) assert.ok(l.board.every((row) => row.length === 3), `fase ${l.id} com linha de tamanho errado`);
  const unique = new Set(LEVELS.map((l) => JSON.stringify(l.board)));
  assert.equal(unique.size, 110);
});

test("PRODUCTS: pelo menos 25 produtos, os 12 originais continuam nos mesmos índices", () => {
  assert.ok(PRODUCTS.length >= 25);
  assert.equal(PRODUCTS[0].name, "Maçã");
  assert.equal(PRODUCTS[11].name, "Coco");
});

test("PACKS/dificuldade: 11 conjuntos (os 6 originais + 5 novos)", () => {
  assert.equal(PACKS.length, 11);
});

test("cada uma das 110 fases tem solução sem ajuda, dentro do limite de movimentos (tempo é meta, não limite)", () => {
  for (const level of LEVELS) {
    const g = solve(startGame(level));
    assert.equal(g.status, "won", `fase ${level.id} não venceu`);
    assert.equal(g.assisted, false, `fase ${level.id} usou ajuda sem precisar`);
    if (level.moves !== null) assert.ok(g.movesUsed <= level.moves, `fase ${level.id} estourou movimentos`);
  }
});

test("nenhuma fase tem célula vazia: toda posição do tabuleiro sempre tem um produto", () => {
  for (const level of LEVELS) for (const row of level.board) for (const slot of row) assert.notEqual(slot.item, null, `fase ${level.id} com célula vazia`);
});

test("desafio diário: mesma data sempre dá a mesma fase; datas diferentes dão sementes diferentes", () => {
  assert.deepEqual(dailyLevel("2026-10-06"), dailyLevel("2026-10-06"));
  assert.notEqual(dailyLevel("2026-10-06").seed, dailyLevel("2026-10-07").seed);
});

test("validMove: só deixa trocar posições acessíveis, diferentes, com produto na origem", () => {
  const level = makeLevel(1);
  const g = startGame(level);
  assert.equal(validMove(g, { from: { row: 0, col: 0 }, to: { row: 0, col: 0 } }), false); // mesma posição
  assert.equal(validMove(g, { from: { row: 99, col: 0 }, to: { row: 0, col: 0 } }), false); // fora do tabuleiro
});

test("move: troca inválida não muda nada (devolve o mesmo estado)", () => {
  const g = startGame(makeLevel(1));
  const next = move(g, { from: { row: 0, col: 0 }, to: { row: 0, col: 0 } });
  assert.equal(next, g);
});

test("applyHelp 'time': toda fase tem meta de tempo, então sempre soma segundos extras", () => {
  const g = startGame(LEVELS[0]);
  const helped = applyHelp(g, "time");
  assert.equal(helped.remaining, g.remaining + RULES.extraSeconds);
  assert.equal(helped.assisted, true);
});

test("tempo: passar da meta vira desconto na pontuação final, não faz perder a fase", () => {
  const level = makeLevel(1);
  let g = startGame(level);
  g = tick(g, level.seconds + 500); // bem além da meta
  assert.equal(g.status, "playing"); // tempo nunca derruba a fase sozinho
  assert.ok(g.remaining < 0);
});

test("applyHelp 'undo': volta pro estado anterior e marca como assistido", () => {
  let g = startGame(makeLevel(11)); // fase com mais de uma troca possível
  const m = hint(g);
  g = move(g, m);
  const before = g;
  const undone = applyHelp(g, "undo");
  assert.equal(undone.assisted, true);
  assert.equal(undone.movesUsed, before.movesUsed - 1);
});

test("stars: 0 se perdeu, 1/2/3 conforme a pontuação cruza os limites da fase", () => {
  const targets = [500, 800];
  assert.equal(stars(100, targets, false), 0);
  assert.equal(stars(100, targets, true), 1);
  assert.equal(stars(500, targets, true), 2);
  assert.equal(stars(800, targets, true), 3);
});

test("RULES.costs: preço de cada ajuda bate com o que a UI deve cobrar", () => {
  assert.deepEqual(RULES.costs, { undo: 5, hint: 10, time: 15, shuffle: 20 });
});
