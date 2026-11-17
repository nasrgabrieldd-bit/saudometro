import { test } from "node:test";
import assert from "node:assert/strict";
import { CHALLENGES, FRIEND_CHALLENGES } from "../js/challenges.js";

for (const [nome, lista] of [["casal", CHALLENGES], ["turma", FRIEND_CHALLENGES]]) {
  test(`desafios do dia (${nome}): banco grande, sem repetição e bem formado`, () => {
    assert.ok(lista.length >= 120, `só ${lista.length} perguntas`);
    const norm = lista.map((q) => q.trim().toLowerCase());
    assert.equal(new Set(norm).size, norm.length, "tem pergunta repetida");
    for (const q of lista) assert.ok(q.length >= 12 && q.length <= 160, `tamanho estranho: ${q}`);
  });
}
