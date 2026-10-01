// Testes do motor puro do Stop/Adedonha (sem Supabase, sem sala). Rodam com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_CATEGORIES, CATEGORIES_SPICY, CATEGORY_LABEL, pickMatchCategories, categoriesForRound,
  STOP_LETTERS, normalize, isValidAnswer, scoreCategory, scoreRound,
} from "../js/games/stopGame.js";

test("ALL_CATEGORIES: pool de 11, todas com key e label únicos", () => {
  assert.equal(ALL_CATEGORIES.length, 11);
  const keys = new Set();
  for (const c of ALL_CATEGORIES) {
    assert.ok(c.key);
    assert.ok(c.label);
    assert.equal(keys.has(c.key), false);
    keys.add(c.key);
  }
});

test("CATEGORIES_SPICY: pool fixo de 6, chaves não colidem com o clássico", () => {
  assert.equal(CATEGORIES_SPICY.length, 6);
  const classicKeys = new Set(ALL_CATEGORIES.map((c) => c.key));
  for (const c of CATEGORIES_SPICY) {
    assert.ok(c.key);
    assert.ok(c.label);
    assert.equal(classicKeys.has(c.key), false);
  }
});

test("CATEGORY_LABEL: resolve rótulo de qualquer chave clássica ou picante", () => {
  assert.equal(CATEGORY_LABEL.animal, "Animal");
  assert.equal(CATEGORY_LABEL.fantasia_leve, "Fantasia leve");
});

test("pickMatchCategories: sorteia a quantidade pedida, sem repetir", () => {
  const picked = pickMatchCategories(ALL_CATEGORIES, 6);
  assert.equal(picked.length, 6);
  assert.equal(new Set(picked.map((c) => c.key)).size, 6);
});

test("categoriesForRound: picante só na última rodada, modo casal, com a sala ligada", () => {
  const match = { round_number: 3, total_rounds: 3, categories: ["nome", "animal"] };
  const coupleRoomSpicyOn = { couple_id: "c1", settings: { spicy: true } };
  assert.equal(categoriesForRound(match, coupleRoomSpicyOn), CATEGORIES_SPICY);

  const notLastRound = { ...match, round_number: 1 };
  assert.notEqual(categoriesForRound(notLastRound, coupleRoomSpicyOn), CATEGORIES_SPICY);

  const friendsRoom = { friend_group_id: "f1", settings: { spicy: true } };
  const result = categoriesForRound(match, friendsRoom);
  assert.equal(result.some((c) => c.key === "lugar_beijo"), false); // turma nunca vê picante

  const spicyOff = { couple_id: "c1", settings: { spicy: false } };
  const resultOff = categoriesForRound(match, spicyOff);
  assert.deepEqual(resultOff.map((c) => c.key), ["nome", "animal"]);
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

test("scoreCategory: resposta contestada e invalidada pela turma vale 0, mesmo sendo única", () => {
  const answers = [
    { user_id: "a", answer: "Morcego" }, // única, válida, mas foi contestada
    { user_id: "b", answer: "Macaco" }, // única normal
  ];
  const withoutContest = scoreCategory(answers, "M");
  assert.equal(withoutContest.get("a"), 10);

  const withContest = scoreCategory([{ ...answers[0], invalidated: true }, answers[1]], "M");
  assert.equal(withContest.get("a"), 0);
  assert.equal(withContest.get("b"), 10); // a invalidação de "a" não vira repetida pra "b"
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
