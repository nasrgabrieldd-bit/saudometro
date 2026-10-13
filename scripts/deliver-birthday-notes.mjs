// Entrega os recadinhos de aniversário cujo dia chegou: marca delivered_at e chama a própria
// Edge Function "notify" direto (sem precisar de um Database Webhook novo configurado no
// painel do Supabase) pra disparar a notificação push de quem escreveu pra quem recebe.
// Roda todo dia pelo GitHub Actions (veja .github/workflows/manutencao.yml).
// Variáveis: SUPABASE_URL e SUPABASE_SECRET_KEY.
const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_BASE || !KEY) {
  console.error("Faltam SUPABASE_URL ou SUPABASE_SECRET_KEY.");
  process.exit(1);
}

// a Edge Function (diferente do REST /rest/v1/ usado pelos outros scripts de manutenção)
// exige um Bearer de verdade na gateway, então manda sempre, não só quando a chave é JWT
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const today = new Date().toISOString().slice(0, 10);

const listRes = await fetch(
  `${URL_BASE}/rest/v1/birthday_notes?select=*&deliver_on=eq.${today}&delivered_at=is.null`,
  { headers }
);
if (!listRes.ok) {
  console.error("Não consegui listar os recadinhos de hoje:", listRes.status, (await listRes.text()).slice(0, 200));
  process.exit(1);
}
const rows = await listRes.json();
console.log(`${rows.length} recadinho(s) de aniversário pra entregar hoje.`);
if (!rows.length) process.exit(0);

let falhou = false;
for (const row of rows) {
  const deliveredAt = new Date().toISOString();
  try {
    const res = await fetch(`${URL_BASE}/functions/v1/notify`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "UPDATE",
        table: "birthday_notes",
        record: { ...row, delivered_at: deliveredAt },
        old_record: row,
      }),
    });
    if (!res.ok) console.error(`Notificação do recadinho ${row.id} falhou:`, res.status, (await res.text()).slice(0, 200));
  } catch (e) {
    console.error(`Erro chamando a notificação do recadinho ${row.id}:`, e);
  }
  // marca entregue mesmo se a notificação falhar: quem recebe já enxerga o recadinho no app
  // de qualquer jeito (a visibilidade é por deliver_on, não por delivered_at) — isso só evita
  // tentar notificar de novo amanhã
  const patchRes = await fetch(`${URL_BASE}/rest/v1/birthday_notes?id=eq.${row.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ delivered_at: deliveredAt }),
  });
  if (!patchRes.ok) {
    console.error(`Não consegui marcar o recadinho ${row.id} como entregue:`, patchRes.status);
    falhou = true;
  }
}

console.log(falhou ? "Terminou com alguns erros (veja acima)." : "Todos os recadinhos de hoje foram entregues.");
if (falhou) process.exit(1);
