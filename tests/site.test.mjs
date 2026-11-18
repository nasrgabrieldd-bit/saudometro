import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (f) => readFileSync(join(raiz, f), "utf8");
const PAGINAS = ["site/index.html", "site/instalar.html"];

test("o site existe com seus arquivos", () => {
  for (const f of [...PAGINAS, "site/site.css", "site/site.js", "site/img/og.png", "robots.txt", "sitemap.xml"]) {
    assert.ok(existsSync(join(raiz, f)), `falta ${f}`);
  }
});

test("links e imagens das páginas do site apontam pra arquivos que existem", () => {
  for (const pagina of PAGINAS) {
    const html = ler(pagina);
    for (const m of html.matchAll(/(?:href|src)="([^"#?:]+)(?:[#?][^"]*)?"/g)) {
      const alvo = m[1];
      if (alvo.startsWith("http") || alvo.startsWith("mailto")) continue;
      assert.ok(existsSync(join(raiz, dirname(pagina), alvo)), `${pagina} referencia ${alvo}, que não existe`);
    }
  }
});

test("as páginas têm título, descrição e endereço canônico", () => {
  for (const pagina of PAGINAS) {
    const html = ler(pagina);
    assert.match(html, /<title>[^<]{10,}<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{40,}"/);
    assert.match(html, /<link rel="canonical"/);
  }
});

test("o site não anuncia preço de plano (os planos ainda não têm benefício definido)", () => {
  for (const pagina of PAGINAS) assert.doesNotMatch(ler(pagina), /R\$\s?\d/);
});

test("a página principal manda visitante novo pro site e deixa quem usa o app no app", () => {
  const html = ler("index.html");
  assert.match(html, /location\.replace\("site\/"\)/);
  for (const chave of ["saudometro-play", "saudometro-web", "display-mode: standalone", "-auth-token"]) {
    assert.ok(html.includes(chave), `o redirecionamento precisa respeitar ${chave}`);
  }
  assert.ok(html.indexOf("location.replace") < html.indexOf('<link rel="stylesheet"'), "o redirecionamento deve rodar antes de carregar o app");
});
