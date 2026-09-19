// Copia todas as tabelas do Supabase para um arquivo JSON.
// Roda no GitHub Actions (veja .github/workflows/manutencao.yml), que criptografa o arquivo antes de guardar.
// Variáveis: SUPABASE_URL e SUPABASE_SECRET_KEY (chave secreta, guardada só nos Secrets do GitHub).
//
// Ficam de fora de propósito: app_admin_secret (senha do modo dono), push_subscriptions (endereços de
// notificação, que se recriam sozinhos), code_attempts e keepalive (técnicas).
//
// Pra restaurar: cada casal volta com o código (as pessoas entram de novo e retomam as vagas), e os dados
// das tabelas abaixo são reinseridos, exceto "profiles", que se recria quando as pessoas reentram.
import { writeFileSync } from "node:fs";

const URL_BASE = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL_BASE || !KEY) {
  console.error("Faltam SUPABASE_URL ou SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const TABLES = [
  "couples", "couple_settings", "profiles", "month_plans", "encounters", "moods", "weekend_recharge",
  "coin_ledger", "weekly_answers", "shop_redemptions", "couple_stats", "sweet_notes", "time_capsules",
  "daily_challenge_answers", "secret_wishes", "wish_redemptions", "app_opens", "streak_freezes",
  "custom_perks", "cycle_settings",
];

const headers = { apikey: KEY, Accept: "application/json", "Range-Unit": "items" };
// chaves antigas (JWT) também vão no Authorization; as novas (sb_secret_...) só no apikey
if (KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${KEY}`;

async function fetchAll(table) {
  const size = 1000;
  const rows = [];
  for (let from = 0; ; from += size) {
    const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=*`, {
      headers: { ...headers, Range: `${from}-${from + size - 1}` },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < size) break;
  }
  return rows;
}

const out = { exportado_em: new Date().toISOString(), tabelas: {} };
const contagem = {};
let falhou = false;
for (const t of TABLES) {
  try {
    out.tabelas[t] = await fetchAll(t);
    contagem[t] = out.tabelas[t].length;
  } catch (e) {
    console.error("ERRO", e.message);
    falhou = true;
  }
}

console.log("Linhas por tabela:", JSON.stringify(contagem));
if (falhou) process.exit(1);
if (!contagem.couples) {
  console.error("Nenhum casal encontrado: a chave provavelmente não é a secreta. Backup cancelado.");
  process.exit(1);
}

writeFileSync(process.argv[2] || "backup.json", JSON.stringify(out));
console.log("Backup gerado.");
