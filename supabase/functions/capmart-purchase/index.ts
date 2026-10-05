// Edge Function: compra uma ajuda (desfazer/dica/tempo/embaralhar) dentro de uma partida de
// CapMart. Chamada pelo app via fetch com o token de sessão no header Authorization — mesmo
// padrão de mp-create-subscription. Idempotente por requestId: reenvio por falha de rede
// devolve a mesma resposta sem cobrar de novo. Preço nunca confia no cliente — vem de
// RULES.costs do próprio motor do jogo (_shared/capmart/engine/config.ts).
import { createClient } from "npm:@supabase/supabase-js@2";
import { RULES } from "../_shared/capmart/engine/config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "não autenticado" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "sessão inválida" }, 401);
    const userId = userData.user.id;

    const { requestId, runId, help, levelId, walletMode, coupleId, friendGroupId } = await req.json();
    if (!requestId || typeof requestId !== "string" || requestId.length > 100) return json({ error: "requestId inválido" }, 400);
    if (!runId || typeof runId !== "string") return json({ error: "runId inválido" }, 400);
    if (!Object.hasOwn(RULES.costs, help)) return json({ error: "ajuda inválida" }, 400);
    if (!Number.isInteger(levelId) || levelId < 1 || levelId > 60) return json({ error: "fase inválida" }, 400);
    if (walletMode !== "casal" && walletMode !== "turma") return json({ error: "contexto inválido" }, 400);

    // idempotência: mesma requestId já processada antes -> devolve o mesmo resultado
    const { data: existing } = await admin.from("capmart_purchases").select("*").eq("request_id", requestId).maybeSingle();
    if (existing) {
      if (existing.user_id !== userId || existing.run_id !== runId || existing.help !== help || existing.level_id !== levelId) {
        return json({ error: "recibo usado para outra compra" }, 409);
      }
      const balance = await getBalance(admin, walletMode, coupleId, friendGroupId, userId);
      return json({ approved: existing.approved, balance });
    }

    const cost = RULES.costs[help as keyof typeof RULES.costs];
    let role: string | null = null;
    if (walletMode === "casal") {
      if (!coupleId) return json({ error: "casal inválido" }, 400);
      const { data: profile } = await admin.from("profiles").select("role, couple_id").eq("id", userId).maybeSingle();
      if (!profile || profile.couple_id !== coupleId) return json({ error: "acesso não autorizado" }, 403);
      role = profile.role;
    } else {
      if (!friendGroupId) return json({ error: "turma inválida" }, 400);
      const { data: member } = await admin.from("friend_members").select("user_id").eq("friend_group_id", friendGroupId).eq("user_id", userId).maybeSingle();
      if (!member) return json({ error: "acesso não autorizado" }, 403);
    }

    const balanceBefore = await getBalance(admin, walletMode, coupleId, friendGroupId, userId, role);
    const approved = balanceBefore >= cost;
    if (approved) {
      if (walletMode === "casal") {
        await admin.from("coin_ledger").insert({ couple_id: coupleId, role, delta: -cost, reason: `CapMart: comprou ${help}` });
      } else {
        await admin.from("friend_coin_ledger").insert({ friend_group_id: friendGroupId, user_id: userId, delta: -cost, reason: `CapMart: comprou ${help}` });
      }
    }
    await admin.from("capmart_purchases").insert({ request_id: requestId, user_id: userId, run_id: runId, help, level_id: levelId, approved });

    const balance = await getBalance(admin, walletMode, coupleId, friendGroupId, userId, role);
    return json({ approved, balance });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

async function getBalance(admin: ReturnType<typeof createClient>, walletMode: string, coupleId: string | null, friendGroupId: string | null, userId: string, knownRole?: string | null) {
  if (walletMode === "casal") {
    let role = knownRole;
    if (!role) {
      const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      role = profile?.role ?? null;
    }
    const { data } = await admin.from("coin_balances").select("balance").eq("couple_id", coupleId).eq("role", role).maybeSingle();
    return data?.balance ?? 0;
  }
  const { data } = await admin.from("friend_coin_balances").select("balance").eq("friend_group_id", friendGroupId).maybeSingle();
  return data?.balance ?? 0;
}
