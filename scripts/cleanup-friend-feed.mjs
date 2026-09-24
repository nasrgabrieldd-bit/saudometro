// Apaga de vez as fotos temporárias do feed de amigos que já passaram do prazo: o arquivo
// no armazenamento E o registro no banco (não só um dos dois). Post permanente (expires_at
// nulo) nunca é tocado aqui. Roda todo dia pelo GitHub Actions
// (veja .github/workflows/manutencao.yml). Variáveis: SUPABASE_URL e SUPABASE_SECRET_KEY.
const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_BASE || !KEY) {
  console.error("Faltam SUPABASE_URL ou SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const headers = { apikey: KEY, "Content-Type": "application/json" };
if (KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${KEY}`;

const nowISO = new Date().toISOString();

const listRes = await fetch(
  `${URL_BASE}/rest/v1/friend_feed_posts?select=id,photo_path&expires_at=lt.${encodeURIComponent(nowISO)}`,
  { headers }
);
if (!listRes.ok) {
  console.error("Não consegui listar os posts vencidos:", listRes.status, (await listRes.text()).slice(0, 200));
  process.exit(1);
}
const rows = await listRes.json();
console.log(`${rows.length} post(s) temporário(s) do feed venceram.`);
if (!rows.length) process.exit(0);

let falhou = false;
for (const row of rows) {
  const delFile = await fetch(`${URL_BASE}/storage/v1/object/friend-feed/${row.photo_path}`, { method: "DELETE", headers });
  if (!delFile.ok && delFile.status !== 404) {
    console.error(`Não consegui apagar o arquivo de ${row.id}:`, delFile.status);
    falhou = true;
    continue; // não apaga o registro se o arquivo ainda não saiu, tenta de novo amanhã
  }
  const delRow = await fetch(`${URL_BASE}/rest/v1/friend_feed_posts?id=eq.${row.id}`, { method: "DELETE", headers });
  if (!delRow.ok) {
    console.error(`Não consegui apagar o registro de ${row.id}:`, delRow.status);
    falhou = true;
  }
}

console.log(falhou ? "Terminou com alguns erros (veja acima)." : "Todos os posts vencidos foram apagados.");
if (falhou) process.exit(1);
