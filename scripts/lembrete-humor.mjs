// Lembrete das 20h: quem ainda não registrou o humor de hoje (casal e turma) recebe uma
// notificação push fofa, estilo Duolingo, pedindo pra atualizar. No máximo uma vez por pessoa
// por dia (tabela mood_reminder_sent). Chama as Edge Functions "notify" e "notify-friends"
// direto, com um payload sintético, igual o script de aniversário.
// Roda todo dia 23h UTC (= 20h de Brasília) pelo GitHub Actions (manutencao.yml).
// Variáveis: SUPABASE_URL e SUPABASE_SECRET_KEY. FORCAR=1 ignora a trava de horário (testes).
const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_BASE || !KEY) {
  console.error("Faltam SUPABASE_URL ou SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// data e hora em Brasília (sem horário de verão desde 2019)
const partes = Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((p) => [p.type, p.value])
);
const today = `${partes.year}-${partes.month}-${partes.day}`;
if (Number(partes.hour) < 20 && process.env.FORCAR !== "1") {
  console.log(`Ainda são ${partes.hour}h em Brasília — o lembrete só sai depois das 20h.`);
  process.exit(0);
}

async function rest(path) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// registra "já lembrei" de forma atômica: devolve false se já existia (já foi lembrado hoje)
async function marcarEnviado(scope, personKey) {
  const res = await fetch(`${URL_BASE}/rest/v1/mood_reminder_sent?on_conflict=scope,person_key,day`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ scope, person_key: personKey, day: today }),
  });
  if (!res.ok) throw new Error(`mood_reminder_sent: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).length > 0;
}

async function chamar(fn, table, record) {
  const res = await fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "INSERT", table, record }),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

let enviados = 0;
let falhou = false;

try {
  // ---- casal: cada (couple_id, role) com aparelho cadastrado e sem humor hoje ----
  const subsCasal = await rest("push_subscriptions?select=couple_id,role");
  const humoresCasal = await rest(`moods?select=couple_id,role&day=eq.${today}`);
  const jaRegistrou = new Set(humoresCasal.map((m) => `${m.couple_id}:${m.role}`));
  const alvosCasal = [...new Set(subsCasal.map((s) => `${s.couple_id}:${s.role}`))].filter((k) => !jaRegistrou.has(k));
  for (const key of alvosCasal) {
    const [couple_id, role] = key.split(":");
    try {
      if (!(await marcarEnviado("casal", key))) continue;
      await chamar("notify", "mood_reminder", { couple_id, role });
      enviados++;
    } catch (e) {
      console.error(`Lembrete do casal ${key} falhou:`, e.message || e);
      falhou = true;
    }
  }

  // ---- turma: cada pessoa com aparelho cadastrado que não registrou humor hoje em nenhuma turma ----
  const subsTurma = await rest("friend_push_subscriptions?select=user_id");
  const humoresTurma = await rest(`friend_moods?select=user_id&day=eq.${today}`);
  const registraramTurma = new Set(humoresTurma.map((m) => m.user_id));
  const membros = await rest("friend_members?select=user_id,friend_group_id");
  const grupoDe = new Map();
  for (const m of membros) if (!grupoDe.has(m.user_id)) grupoDe.set(m.user_id, m.friend_group_id);
  const alvosTurma = [...new Set(subsTurma.map((s) => s.user_id))].filter((u) => !registraramTurma.has(u) && grupoDe.has(u));
  for (const user_id of alvosTurma) {
    try {
      if (!(await marcarEnviado("turma", user_id))) continue;
      await chamar("notify-friends", "mood_reminder", { friend_group_id: grupoDe.get(user_id), user_id });
      enviados++;
    } catch (e) {
      console.error(`Lembrete da pessoa ${user_id} falhou:`, e.message || e);
      falhou = true;
    }
  }
} catch (e) {
  console.error("Não consegui montar a lista de lembretes:", e.message || e);
  process.exit(1);
}

console.log(`${enviados} lembrete(s) de humor enviado(s) (${today}).`);
if (falhou) process.exit(1);
