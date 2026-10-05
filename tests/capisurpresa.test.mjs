// Testes do motor puro da Capisurpresa (sem Supabase, sem DOM). Rodam com: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TEMPLATES, STICKERS, DURATIONS, DURATION_LABEL,
  newElement, createComposition, price, validateComposition,
} from "../js/games/capisurpresa.js";

test("TEMPLATES: 5 modelos, todos com id e nome únicos", () => {
  assert.equal(TEMPLATES.length, 5);
  const ids = new Set();
  for (const t of TEMPLATES) {
    assert.ok(t.id); assert.ok(t.name); assert.ok(t.color);
    assert.equal(ids.has(t.id), false);
    ids.add(t.id);
  }
});

test("STICKERS: 4 adesivos, ids únicos", () => {
  assert.equal(STICKERS.length, 4);
  assert.equal(new Set(STICKERS.map((s) => s.id)).size, 4);
});

test("DURATIONS: inclui 15/30/60/180 minutos e 0 (até abrir)", () => {
  assert.deepEqual(DURATIONS, [15, 30, 60, 180, 0]);
  for (const d of DURATIONS) assert.ok(DURATION_LABEL[d]);
});

test("newElement: posição padrão de adesivo é diferente da de texto", () => {
  const sticker = newElement("sticker", "banana");
  const text = newElement("text", "oi");
  assert.notEqual(sticker.y, text.y);
  assert.notEqual(sticker.w, text.w);
  assert.ok(sticker.id);
});

test("createComposition: cada modelo começa com um texto de exemplo válido", () => {
  for (const t of TEMPLATES) {
    const c = createComposition(t.id);
    assert.equal(c.version, 1);
    assert.equal(c.template, t.id);
    assert.equal(c.background, t.color);
    assert.ok(c.elements.length >= 1);
    assert.equal(c.elements[0].kind, "text");
  }
});

test("createComposition: modelo 'capi' já vem com um adesivo", () => {
  const c = createComposition("capi");
  assert.ok(c.elements.some((e) => e.kind === "sticker"));
});

test("createComposition: modelo inválido lança erro", () => {
  assert.throws(() => createComposition("nao-existe"));
});

test("price: texto simples custa 5", () => {
  const c = createComposition("quote");
  assert.equal(price(c), 5);
});

test("price: post-it com adesivo custa 8", () => {
  const c = createComposition("note");
  c.elements.push(newElement("sticker", "banana"));
  assert.equal(price(c), 8);
});

test("price: post-it SEM adesivo continua 5 (só o template não basta)", () => {
  const c = createComposition("note");
  assert.equal(price(c), 5);
});

test("price: ter um traço de desenho custa 10, mesmo com outros elementos", () => {
  const c = createComposition("smile");
  c.elements.push({ ...newElement("stroke", ""), points: [[0, 0], [10, 10]] });
  assert.equal(price(c), 10);
});

test("price: ter uma foto custa 12, o mais caro de todos (sobrepõe desenho/adesivo)", () => {
  const c = createComposition("note");
  c.elements.push(newElement("sticker", "banana"));
  c.elements.push({ ...newElement("photo", "data:image/png;base64,abc") });
  assert.equal(price(c), 12);
});

test("validateComposition: composição de um modelo válido passa", () => {
  assert.doesNotThrow(() => validateComposition(createComposition("note")));
});

test("validateComposition: rejeita modelo desconhecido", () => {
  assert.throws(() => validateComposition({ version: 1, template: "x", elements: [] }));
});

test("validateComposition: rejeita elemento fora dos limites de posição", () => {
  const c = createComposition("note");
  c.elements[0].x = 999;
  assert.throws(() => validateComposition(c));
});

test("validateComposition: rejeita adesivo que não existe no catálogo", () => {
  const c = createComposition("capi");
  c.elements.push(newElement("sticker", "nao-existe"));
  assert.throws(() => validateComposition(c));
});

test("validateComposition: rejeita foto que não é data URL de imagem", () => {
  const c = createComposition("note");
  c.elements.push({ ...newElement("photo", "https://exemplo.com/foto.png") });
  assert.throws(() => validateComposition(c));
});

test("validateComposition: rejeita texto maior que 300 caracteres", () => {
  const c = createComposition("quote");
  c.elements[0].content = "a".repeat(301);
  assert.throws(() => validateComposition(c));
});
