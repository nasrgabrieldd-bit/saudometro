// Apaga de vez as fotos de "Lembrei de você" com mais de 30 dias: o arquivo no armazenamento
// E o registro no banco (não só um dos dois). Roda todo dia pelo GitHub Actions
// (veja .github/workflows/manutencao.yml). Variáveis: SUPABASE_URL e SUPABASE_SECRET_KEY.
const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_BASE || !KEY) {
  console.error("Faltam SUPABASE_URL ou SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const headers = { apikey: KEY, "Content-Type": "application/json" };
if (KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${KEY}`;

const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

const listRes = await fetch(
  `${URL_BASE}/rest/v1/memory_photos?select=id,photo_path&created_at=lt.${encodeURIComponent(cutoff)}`,
  { headers }
);
if (!listRes.ok) {
  console.error("Não consegui listar as lembranças vencidas:", listRes.status, (await listRes.text()).slice(0, 200));
  process.exit(1);
}
const rows = await listRes.json();
console.log(`${rows.length} lembrança(s) passaram de 30 dias.`);
if (!rows.length) process.exit(0);

let falhou = false;
for (const row of rows) {
  const delFile = await fetch(`${URL_BASE}/storage/v1/object/memories/${row.photo_path}`, { method: "DELETE", headers });
  if (!delFile.ok && delFile.status !== 404) {
    console.error(`Não consegui apagar o arquivo de ${row.id}:`, delFile.status);
    falhou = true;
    continue; // não apaga o registro se o arquivo ainda não saiu, tenta de novo amanhã
  }
  const delRow = await fetch(`${URL_BASE}/rest/v1/memory_photos?id=eq.${row.id}`, { method: "DELETE", headers });
  if (!delRow.ok) {
    console.error(`Não consegui apagar o registro de ${row.id}:`, delRow.status);
    falhou = true;
  }
}

console.log(falhou ? "Terminou com alguns erros (veja acima)." : "Todas as lembranças vencidas foram apagadas.");
if (falhou) process.exit(1);
