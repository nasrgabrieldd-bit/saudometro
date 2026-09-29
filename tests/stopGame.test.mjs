// Testes do motor puro do Stop/Adedonha (sem Supabase, sem sala). Rodam com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { CATEGORIES, STOP_LETTERS, normalize, isValidAnswer, scoreCategory, scoreRound } from "../js/games/stopGame.js";

test("CATEGORIES: 6 categorias fixas, todas com key e label", () => {
  assert.equal(CATEGORIES.length, 6);
  for (const c of CATEGORIES) {
    assert.ok(c.key);
    assert.ok(c.label);
  }
});

test("STOP_LETTERS: 23 letras, sem K/W/Y", () => {
  assert.equal(STOP_LETTERS.length, 23);
  assert.equal(STOP_LETTERS.includes("K"), false);
  assert.equal(STOP_LETTERS.includes("W"), false);
  assert.equal(STOP_LETTERS.includes("Y"), false);
});

test("normalize: remove acento, baixa caixa, tira espaço nas pontas", () => {
  assert.equal(normalize("  Água  "), "agua");
  assert.equal(normalize("MAÇÃ"), "maca");
  assert.equal(normalize(""), "");
  assert.equal(normalize(null), "");
});

test("isValidAnswer: precisa começar com a letra (sem diferenciar acento) e não ser vazia", () => {
  assert.equal(isValidAnswer("Macaco", "M"), true);
  assert.equal(isValidAnswer("Água", "A"), true); // acento não atrapalha
  assert.equal(isValidAnswer("Banana", "M"), false);
  assert.equal(isValidAnswer("", "M"), false);
  assert.equal(isValidAnswer("   ", "M"), false);
});

test("scoreCategory: única válida = 10, repetida válida = 5 cada, inválida/vazia = 0", () => {
  const answers = [
    { user_id: "a", answer: "Macaco" },
    { user_id: "b", answer: "macaco" }, // mesma palavra, caixa diferente -> repetida
    { user_id: "c", answer: "Morcego" }, // única
    { user_id: "d", answer: "Banana" }, // não começa com M -> inválida
    { user_id: "e", answer: "" }, // vazia -> inválida
  ];
  const points = scoreCategory(answers, "M");
  assert.equal(points.get("a"), 5);
  assert.equal(points.get("b"), 5);
  assert.equal(points.get("c"), 10);
  assert.equal(points.get("d"), 0);
  assert.equal(points.get("e"), 0);
});

test("scoreRound: soma os pontos de todas as categorias por jogador", () => {
  const answersByCategory = {
    animal: [{ user_id: "a", answer: "Macaco" }, { user_id: "b", answer: "Morcego" }],
    comida: [{ user_id: "a", answer: "Macarrão" }, { user_id: "b", answer: "Banana" }],
  };
  const total = scoreRound(answersByCategory, "M");
  assert.equal(total.get("a"), 20); // 10 (animal única) + 10 (comida única)
  assert.equal(total.get("b"), 10); // 10 (animal única) + 0 (comida inválida, não começa com M)
});
