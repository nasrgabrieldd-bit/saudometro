import { test } from "node:test";
import assert from "node:assert/strict";
import { activeSeason, dataBrasilia, SEASONS } from "../js/seasons.js";

const z = (s) => new Date(s);

test("Natal vai de 17/11 a 26/12 pelo horário de Brasília", () => {
  assert.equal(activeSeason(z("2026-11-16T12:00:00-03:00")), null);
  assert.equal(activeSeason(z("2026-11-17T00:00:00-03:00")), "natal");
  assert.equal(activeSeason(z("2026-12-01T12:00:00-03:00")), "natal");
  assert.equal(activeSeason(z("2026-12-26T23:59:00-03:00")), "natal");
  assert.equal(activeSeason(z("2026-12-27T00:00:00-03:00")), null);
});

test("a virada do dia segue Brasília, não o fuso de quem abre o app", () => {
  assert.equal(dataBrasilia(z("2026-11-17T02:30:00Z")), "2026-11-16"); // ainda 23h30 do dia 16 em Brasília
  assert.equal(activeSeason(z("2026-11-17T02:30:00Z")), null);
  assert.equal(activeSeason(z("2026-11-17T03:00:00Z")), "natal");
  assert.equal(activeSeason(z("2026-12-27T02:59:00Z")), "natal");
  assert.equal(activeSeason(z("2026-12-27T03:00:00Z")), null);
});

test("temas ainda sem arte ficam preparados, mas não ligam sozinhos", () => {
  assert.equal(activeSeason(z("2026-10-28T12:00:00-03:00")), null);
  assert.equal(activeSeason(z("2026-10-28T12:00:00-03:00"), { all: true }), "halloween");
  assert.equal(activeSeason(z("2027-01-01T12:00:00-03:00"), { all: true }), "ano_novo");
  assert.equal(activeSeason(z("2026-06-08T12:00:00-03:00"), { all: true }), "namorados");
  assert.ok(SEASONS.every((s) => s.id && s.name && typeof s.range === "function"));
});

test("o Natal do ano seguinte também funciona", () => {
  assert.equal(activeSeason(z("2027-11-20T12:00:00-03:00")), "natal");
});
