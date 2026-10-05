// Edge Function: valida o resultado de uma partida de CapMart (replay determinístico, igual
// o motor aprovado faz) e grava tudo numa transação atômica via RPC. Chamada pelo app via
// fetch com o token de sessão — mesmo padrão de mp-create-subscription/capmart-purchase.
// Reaproveita o motor/fases/regras ORIGINAIS do pacote (_shared/capmart), sem reescrever
// nada da lógica do jogo — só decide o que fazer com o resultado já validado.
import { createClient } from "npm:@supabase/supabase-js@2";
import { RULES } from "../_shared/capmart/engine/config.ts";
import { validateReplay } from "../_shared/capmart/engine/replay.ts";
import { levelForVersion, dailyLevel } from "../_shared/capmart/levels/index.ts";
import { localDay } from "../_shared/capmart/progress.ts";
import type { Result } from "../_shared/capmart/engine/types.ts";

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

    const body = await req.json();
    const result = body.result as Result;
    const walletMode = body.walletMode as string;
    const coupleId = body.coupleId as string | null;
    const friendGroupId = body.friendGroupId as string | null;
    if (walletMode !== "casal" && walletMode !== "turma") return json({ error: "contexto inválido" }, 400);

    // mesmas checagens de forma que o adaptador local (services/local.ts) já fazia —
    // reproduzidas aqui porque o host (nós) é quem precisa ser a autoridade, não o cliente
    if (!result || !Number.isInteger(result.levelId) || result.levelId < 1 || result.levelId > 60
      || !Number.isFinite(result.score) || result.score < 0
      || !Number.isInteger(result.stars) || result.stars < 0 || result.stars > 3
      || (result.won && result.stars === 0)
      || !result.runId || typeof result.runId !== "string" || !Array.isArray(result.events)) {
      return json({ error: "resultado inválido" }, 400);
    }

    // idempotência: se já existe, devolve o recibo sem reprocessar (a RPC também protege
    // isso, mas aqui evita rodar o replay inteiro à toa)
    const { data: existing } = await admin.from("capmart_results").select("*").eq("run_id", result.runId).maybeSingle();
    if (existing) {
      const { data: progress } = await admin.from("capmart_progress").select("*").eq("user_id", userId).maybeSingle();
      const balance = await getBalance(admin, walletMode, coupleId, friendGroupId, userId);
      return json({
        balance, awarded: existing.awarded, previousRecord: 0,
        progress: progressJson(progress),
      });
    }

    const configVersion = result.configVersion ?? 1;
    const today = localDay();
    const yesterday = new Date(Date.parse(today + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
    const challengeDay = result.dailyDay ?? today;

    if (!result.daily && result.seed !== result.levelId * 7919) return json({ error: "configuração de campanha inválida" }, 400);
    if (result.daily && challengeDay !== today && challengeDay !== yesterday) return json({ error: "desafio diário expirado" }, 400);
    if (result.daily && (result.levelId !== 45 || result.seed !== dailyLevel(challengeDay).seed)) return json({ error: "desafio diário inválido" }, 400);

    // checa desbloqueio ANTES do replay (replay é caro e não precisa rodar se a fase nem
    // está liberada pra esse usuário — a RPC confere de novo por segurança)
    if (!result.daily) {
      const { data: progress } = await admin.from("capmart_progress").select("unlocked").eq("user_id", userId).maybeSingle();
      const unlocked = progress?.unlocked ?? 1;
      if (result.levelId > unlocked) return json({ error: "fase ainda não desbloqueada" }, 403);
    }

    let game;
    try {
      const level = levelForVersion(result.levelId, result.seed, configVersion);
      game = validateReplay(level, result);
    } catch (e) {
      return json({ error: (e as Error).message || "replay inválido" }, 400);
    }

    // ajuda paga: cada evento de ajuda (fora a dica grátis da fase 1) precisa de uma compra
    // aprovada correspondente, mesma regra do adaptador local
    const { data: purchases } = await admin.from("capmart_purchases").select("*").eq("user_id", userId).eq("run_id", result.runId).eq("approved", true);
    const used: Record<string, number> = {};
    for (const event of result.events) {
      if (event.kind !== "help") continue;
      if (result.levelId === 1 && event.help === "hint") continue; // dica grátis do tutorial
      used[event.help] = (used[event.help] ?? 0) + 1;
      const paidCount = (purchases || []).filter((p) => p.help === event.help && p.level_id === result.levelId).length;
      if (used[event.help] > paidCount) return json({ error: "ajuda sem compra confirmada" }, 400);
    }

    // recompensas candidatas (a RPC decide quais são realmente NOVAS, de forma atômica)
    const candidateRewards: { id: string; amount: number }[] = [];
    if (result.won) {
      if (!result.daily) {
        candidateRewards.push({ id: `level:${result.levelId}`, amount: RULES.rewards.completion });
        if (result.stars === 3) candidateRewards.push({ id: `stars:${result.levelId}`, amount: RULES.rewards.threeStars });
      }
      candidateRewards.push({ id: `win:${today}`, amount: RULES.rewards.firstDailyWin });
      if (result.daily) candidateRewards.push({ id: `daily:${challengeDay}`, amount: RULES.rewards.dailyChallenge });
    }

    const { data: commit, error: commitErr } = await admin.rpc("capmart_commit_result", {
      p_user_id: userId, p_run_id: result.runId, p_level_id: result.levelId, p_seed: result.seed, p_config_version: configVersion,
      p_score: game.resultScore ?? game.score, p_stars: result.stars, p_won: result.won, p_assisted: result.assisted,
      p_elapsed: result.elapsed, p_moves: result.moves, p_daily: result.daily, p_daily_day: result.daily ? challengeDay : null,
      p_wallet_mode: walletMode, p_couple_id: coupleId, p_friend_group_id: friendGroupId,
      p_candidate_rewards: candidateRewards,
    });
    if (commitErr) throw commitErr;

    return json(commit);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});

async function getBalance(admin: ReturnType<typeof createClient>, walletMode: string, coupleId: string | null, friendGroupId: string | null, userId: string) {
  if (walletMode === "casal") {
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    const { data } = await admin.from("coin_balances").select("balance").eq("couple_id", coupleId).eq("role", profile?.role).maybeSingle();
    return data?.balance ?? 0;
  }
  const { data } = await admin.from("friend_coin_balances").select("balance").eq("friend_group_id", friendGroupId).maybeSingle();
  return data?.balance ?? 0;
}

function progressJson(p: any) {
  return {
    version: 1 as const,
    unlocked: p?.unlocked ?? 1,
    records: p?.records ?? {},
    tutorialDone: p?.tutorial_done ?? false,
    preferences: p?.preferences ?? { sound: true, reducedMotion: false },
  };
}
