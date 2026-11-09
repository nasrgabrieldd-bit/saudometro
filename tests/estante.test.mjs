import { test } from "node:test";
import assert from "node:assert/strict";
import { pagesRead, periodStats, monthsStreak, parseTitleList, cleanTag, funComparison } from "../js/books.js";

const li = (title, fin, extra = {}) => ({ id: title, title, status: "li", finished_at: fin, pages: 200, source: "kindle", tags: [], ...extra });

test("páginas lidas: terminado = todas, lendo = % das páginas, resto = 0", () => {
  assert.equal(pagesRead({ status: "li", pages: 300 }), 300);
  assert.equal(pagesRead({ status: "lendo", pages: 300, progress: 50 }), 150);
  assert.equal(pagesRead({ status: "quero", pages: 300, progress: 0 }), 0);
  assert.equal(pagesRead({ status: "li", pages: null }), 0);
});

test("estatísticas do ano e do mês", () => {
  const books = [
    li("A", "2026-01-10", { rating: 5, author: "Ana", tags: ["romance"], mood: "chorei" }),
    li("B", "2026-01-20", { rating: 3, author: "Ana", source: "pdf", tags: ["romance", "drama"] }),
    li("C", "2026-03-02", { rating: 4, author: "Bia" }),
    li("D", "2025-12-30"),
    { id: "E", title: "E", status: "lendo", progress: 40, pages: 100 },
  ];
  const y = periodStats(books, 2026);
  assert.equal(y.count, 3);
  assert.equal(y.pages, 600);
  assert.equal(y.outsideKindle, 1);
  assert.equal(y.top[0].title, "A");
  assert.deepEqual(y.topAuthor, ["Ana", 2]);
  assert.deepEqual(y.tags[0], ["romance", 2]);
  assert.equal(y.perMonth[0], 2);
  assert.equal(periodStats(books, 2026, 1).count, 2);
  assert.equal(periodStats(books, 2026, 2).count, 0);
});

test("sequência de meses seguidos", () => {
  const books = [li("a", "2026-09-01"), li("b", "2026-10-05"), li("c", "2026-11-05"), li("x", "2026-07-05")];
  assert.equal(monthsStreak(books, 2026, 11), 3);
  assert.equal(monthsStreak(books, 2026, 12), 3); // mês corrente vazio não zera
  assert.equal(monthsStreak([], 2026, 11), 0);
  assert.equal(monthsStreak([li("y", "2025-12-05"), li("z", "2026-01-05")], 2026, 1), 2); // vira o ano
});

test("colar lista de títulos", () => {
  const r = parseTitleList("1. A Culpa é das Estrelas - John Green\n\n- Torto Arado\n Dom Casmurro ; Machado de Assis ");
  assert.deepEqual(r, [
    { title: "A Culpa é das Estrelas", author: "John Green" },
    { title: "Torto Arado", author: null },
    { title: "Dom Casmurro", author: "Machado de Assis" },
  ]);
  assert.deepEqual(parseTitleList(""), []);
});

test("tags e comparação", () => {
  assert.equal(cleanTag("  #Plot Twist "), "plot twist");
  assert.equal(funComparison(0), "");
  assert.ok(funComparison(3000).length > 0);
});
