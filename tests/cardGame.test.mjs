// Testes do motor puro do jogo de Cartas (sem Supabase, sem sala). Rodam com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { COLORS, buildDeck, shuffle, dealHands, canPlay, nextSeatIndex, applyCard, checkWinner } from "../js/games/cardGame.js";

test("buildDeck: 108 cartas, distribuição certa de número/ação/curinga", () => {
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  const numbers = deck.filter((c) => c.kind === "number");
  assert.equal(numbers.length, 76); // (1 zero + 2×9) × 4 cores
  for (const kind of ["skip", "reverse", "draw2"]) {
    const count = deck.filter((c) => c.kind === kind).length;
    assert.equal(count, 8, kind); // 2 por cor × 4 cores
  }
  assert.equal(deck.filter((c) => c.kind === "wild").length, 4);
  assert.equal(deck.filter((c) => c.kind === "wild4").length, 4);
  for (const color of COLORS) {
    assert.equal(deck.filter((c) => c.color === color).length, 25); // 19 número + 6 ação
  }
});

test("shuffle: mesma seed de rng dá a mesma ordem; não perde nem duplica carta", () => {
  const deck = buildDeck();
  let seed = 1;
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const a = shuffle(deck, rng);
  seed = 1;
  const b = shuffle(deck, rng);
  assert.deepEqual(a, b);
  assert.equal(a.length, deck.length);
  assert.notDeepEqual(a, deck); // embaralhou de verdade
});

test("dealHands: distribui o tamanho certo pra cada jogador e nunca vira curinga/ação na largada", () => {
  for (let trial = 0; trial < 20; trial++) {
    const deck = shuffle(buildDeck(), () => Math.random());
    const { hands, drawPile, discardTop, activeColor } = dealHands(deck, 4, 7);
    assert.equal(hands.length, 4);
    for (const hand of hands) assert.equal(hand.length, 7);
    assert.equal(discardTop.kind, "number");
    assert.equal(activeColor, discardTop.color);
    assert.equal(drawPile.length + hands.flat().length + 1, 108);
  }
});

test("canPlay: cor, valor, símbolo de ação e curinga", () => {
  const top = { color: "vermelho", value: 7, kind: "number" };
  assert.equal(canPlay({ color: "vermelho", value: 2, kind: "number" }, top, "vermelho"), true); // cor bate
  assert.equal(canPlay({ color: "azul", value: 7, kind: "number" }, top, "vermelho"), true); // valor bate
  assert.equal(canPlay({ color: "azul", value: 2, kind: "number" }, top, "vermelho"), false); // nada bate
  assert.equal(canPlay({ kind: "wild" }, top, "vermelho"), true);
  assert.equal(canPlay({ kind: "wild4" }, top, "vermelho"), true);

  const topSkip = { color: "verde", kind: "skip" };
  assert.equal(canPlay({ color: "azul", kind: "skip" }, topSkip, "verde"), true); // mesmo símbolo, cor diferente
  assert.equal(canPlay({ color: "azul", kind: "reverse" }, topSkip, "verde"), false);
});

test("canPlay: curinga+4 só é jogável se a mão não tiver carta da cor ativa (regra oficial)", () => {
  const top = { color: "vermelho", value: 7, kind: "number" };
  const wild4 = { kind: "wild4" };
  const handComCorAtiva = [{ color: "vermelho", value: 3, kind: "number" }, { color: "azul", value: 1, kind: "number" }];
  const handSemCorAtiva = [{ color: "azul", value: 1, kind: "number" }, { color: "verde", kind: "skip" }];
  assert.equal(canPlay(wild4, top, "vermelho", handComCorAtiva), false);
  assert.equal(canPlay(wild4, top, "vermelho", handSemCorAtiva), true);
  assert.equal(canPlay(wild4, top, "vermelho", []), true); // sem mais nenhuma carta na mão, pode jogar
});

test("nextSeatIndex: avança e recua com wraparound nos dois sentidos", () => {
  assert.equal(nextSeatIndex(4, 0, 1, 1), 1);
  assert.equal(nextSeatIndex(4, 3, 1, 1), 0); // dá a volta pra frente
  assert.equal(nextSeatIndex(4, 0, -1, 1), 3); // dá a volta pra trás
  assert.equal(nextSeatIndex(4, 1, 1, 2), 3); // pula 2 (bloqueio)
});

test("applyCard: bloqueio pula um jogador", () => {
  const state = { direction: 1, currentIndex: 0, playerCount: 4 };
  const next = applyCard(state, { color: "vermelho", kind: "skip" });
  assert.equal(next.currentIndex, 2); // pulou o jogador 1
  assert.equal(next.direction, 1);
});

test("applyCard: inversão troca direção com 3+ jogadores, vira bloqueio com 2", () => {
  const with3 = applyCard({ direction: 1, currentIndex: 0, playerCount: 3 }, { color: "azul", kind: "reverse" });
  assert.equal(with3.direction, -1);
  assert.equal(with3.currentIndex, 2); // sentido invertido, volta pro último

  const with2 = applyCard({ direction: 1, currentIndex: 0, playerCount: 2 }, { color: "azul", kind: "reverse" });
  assert.equal(with2.direction, 1); // não inverte com só 2
  assert.equal(with2.currentIndex, 0); // a vez volta pro mesmo jogador (age como bloqueio)
});

test("applyCard: +2 marca o alvo certo pra comprar, sem empilhar", () => {
  const next = applyCard({ direction: 1, currentIndex: 0, playerCount: 4 }, { color: "verde", kind: "draw2" });
  assert.deepEqual(next.drawEffect, { seat: 1, amount: 2 });
  assert.equal(next.currentIndex, 2); // pula quem comprou
});

test("applyCard: curinga+4 usa a cor escolhida e manda comprar 4", () => {
  const next = applyCard({ direction: 1, currentIndex: 0, playerCount: 3 }, { kind: "wild4" }, "amarelo");
  assert.equal(next.activeColor, "amarelo");
  assert.deepEqual(next.drawEffect, { seat: 1, amount: 4 });
});

test("checkWinner: mão vazia é vitória, mão com carta não é", () => {
  assert.equal(checkWinner([]), true);
  assert.equal(checkWinner([{ kind: "number", value: 3, color: "azul" }]), false);
});
