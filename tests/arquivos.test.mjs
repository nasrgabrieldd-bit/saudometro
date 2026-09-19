// Confere que os arquivos do app estão inteiros: sintaxe, referências e o que o celular precisa achar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8");

function jsDoApp() {
  return readdirSync(join(raiz, "js"), { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => join("js", f));
}

test("todo arquivo JavaScript do app tem sintaxe válida", () => {
  const tmp = mkdtempSync(join(tmpdir(), "saudometro-"));
  try {
    for (const f of [...jsDoApp(), "sw.js"]) {
      const copia = join(tmp, f.replace(/[\\/]/g, "_") + ".mjs");
      copyFileSync(join(raiz, f), copia);
      const r = spawnSync(process.execPath, ["--check", copia], { encoding: "utf8" });
      assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("todo import relativo aponta para um arquivo que existe", () => {
  for (const f of jsDoApp()) {
    const src = ler(f);
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const alvo = resolve(raiz, dirname(f), m[1]);
      assert.ok(existsSync(alvo), `${f} importa ${m[1]}, que não existe`);
    }
  }
});

test("index.html só referencia arquivos que existem", () => {
  const html = ler("index.html");
  for (const m of html.matchAll(/(?:href|src)="([^"#?]+)"/g)) {
    if (/^(https?:|data:|mailto:)/.test(m[1])) continue;
    assert.ok(existsSync(join(raiz, m[1])), `index.html referencia ${m[1]}, que não existe`);
  }
});

test("manifest do app: campos e ícones", () => {
  const man = JSON.parse(ler("manifest.json"));
  assert.ok(man.name && man.start_url && man.display === "standalone");
  for (const i of man.icons) assert.ok(existsSync(join(raiz, i.src)), `ícone ${i.src}`);
});

test("página de privacidade existe e o app aponta para ela", () => {
  assert.ok(existsSync(join(raiz, "privacidade.html")));
  assert.match(ler("js/app.js"), /privacidade\.html/);
});

test("nenhuma chave secreta foi parar no código", () => {
  const padroes = [/sb_secret_[A-Za-z0-9_-]{10,}/, /service_role/i, /BEGIN (RSA |EC )?PRIVATE KEY/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/];
  const arquivos = [...jsDoApp(), "index.html", "sw.js", "privacidade.html", "demo.html", ".github/workflows/manutencao.yml", "scripts/backup.mjs"];
  for (const f of arquivos) {
    if (!existsSync(join(raiz, f))) continue;
    const src = ler(f);
    for (const p of padroes) assert.ok(!p.test(src), `${f} parece conter um segredo (${p})`);
  }
});

test("service worker: lista de arquivos guardados está completa e sem arquivo faltando", () => {
  const sw = ler("sw.js");
  const bloco = /const SHELL = \[([\s\S]*?)\];/.exec(sw)?.[1] || "";
  const lista = [...bloco.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(lista.length > 10, "não achei a lista SHELL no sw.js");
  for (const f of lista) if (f !== "./") assert.ok(existsSync(join(raiz, f)), `sw.js guarda ${f}, que não existe`);
  const obrigatorios = [...jsDoApp().map((f) => f.split("\\").join("/")), "index.html", "css/styles.css", "css/fonts.css", "manifest.json"];
  for (const f of obrigatorios) assert.ok(lista.includes(f), `sw.js não guarda ${f}: o app não abriria offline`);
  for (const f of readdirSync(join(raiz, "fonts"))) assert.ok(lista.includes(`fonts/${f}`), `sw.js não guarda fonts/${f}`);
});

test("app não depende de CDN nem de fontes de terceiros (só Supabase e o CAPTCHA)", () => {
  const arquivos = [...jsDoApp().filter((f) => !f.includes("vendor")), "index.html", "css/styles.css", "css/fonts.css", "privacidade.html", "sw.js"];
  for (const f of arquivos) {
    const src = ler(f);
    assert.ok(!/googleapis|gstatic|jsdelivr|unpkg|cdnjs|esm\.sh/.test(src), `${f} usa serviço externo de fontes/bibliotecas`);
  }
});

test("todo arquivo de fonte citado no css existe", () => {
  for (const m of ler("css/fonts.css").matchAll(/url\("([^"]+)"\)/g)) {
    assert.ok(existsSync(resolve(raiz, "css", m[1])), `fonts.css cita ${m[1]}, que não existe`);
  }
});
