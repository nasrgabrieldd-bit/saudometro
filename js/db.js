import { supabase, SUPABASE_URL } from "./supabaseClient.js";
import { monthKey, prevMonthKey, nextMonthKey, toISODate } from "./util.js";
import { getCaptchaToken } from "./captcha.js";

// ---------- auth / casal / perfil ----------

// falha de rede/servidor (não de sessão inválida): nesse caso NÃO pode criar conta nova, senão a pessoa perde o perfil
export function isNetworkError(e) {
  return !navigator.onLine || e?.name === "AuthRetryableFetchError" || e?.status === 0 || e?.status >= 500
    || e?.message === "Failed to fetch";
}

// confere se já tem uma sessão salva e válida (renovando se preciso), sem criar nenhuma conta nova.
// Devolve null se não tiver sessão ou se ela não valer mais (nesse caso precisa entrar de novo).
// Sem internet: confia na sessão salva localmente (sem checar com o servidor) pra deixar abrir o
// app offline — só quando a internet volta é que uma sessão realmente vencida/revogada é detectada.
async function validatedSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  if (!navigator.onLine) return data.session;
  // getSession só lê o que tá guardado localmente, sem checar se ainda vale;
  // getUser confirma de verdade com o servidor
  const check = await supabase.auth.getUser();
  if (!check.error) return data.session;
  if (isNetworkError(check.error)) return data.session;
  try {
    const refreshed = await supabase.auth.refreshSession();
    if (!refreshed.error && refreshed.data.session) return refreshed.data.session;
    if (refreshed.error && isNetworkError(refreshed.error)) return data.session;
  } catch (e) {
    if (isNetworkError(e)) return data.session;
    // refresh token também inválido/vencido: sessão salva não vale mais
  }
  return null;
}

// sessão de quem já estava logado antes (casal do jeito antigo, anônimo ou por Google).
// Nunca cria conta nova — pra isso agora é sempre por Google (ver signInWithGoogle).
export async function getExistingSession() {
  return validatedSession();
}

// só usado hoje pelo fluxo antigo, mantido pra não perder cobertura de quem ainda está
// numa sessão anônima de antes do Google virar obrigatório.
export async function ensureAnonSession() {
  const existing = await validatedSession();
  if (existing) return existing;
  // conta nova: confirma que é uma pessoa (a verificação só vale quando ligada no Supabase)
  const captchaToken = await getCaptchaToken();
  const { data: signed, error } = await supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
  if (error) throw error;
  return signed.session;
}

// login com Google: além do código do casal, não no lugar dele. Serve pra recuperar o acesso
// se a pessoa trocar de celular ou perder o código. A página navega pro Google e volta sozinha.
export function signInWithGoogle() {
  const redirectTo = window.location.origin + window.location.pathname;
  return supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
}

// liga uma conta Google à sessão atual, SEM criar um usuário novo nem perder o casal/perfil já existente
export function linkGoogleIdentity() {
  const redirectTo = window.location.origin + window.location.pathname;
  return supabase.auth.linkIdentity({ provider: "google", options: { redirectTo } });
}

export async function getGoogleLinkStatus() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return false;
  return !!data.user?.identities?.some((i) => i.provider === "google");
}

// sessão do jeito antigo (anônima, sem Google ligado ainda)
export async function isAnonymousUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return false;
  return !!data.user?.is_anonymous;
}

export async function findCoupleByCode(code) {
  const { data, error } = await supabase.rpc("find_couple_by_code", { p_code: code.trim().toUpperCase() });
  if (error) throw error;
  return data?.[0] || null;
}

export async function getCoupleMeta(coupleId) {
  const { data, error } = await supabase
    .from("couples")
    .select("code, created_at")
    .eq("id", coupleId)
    .single();
  if (error) throw error;
  return data;
}

// ---------- planos / cobrança (Fase 1: só consulta, nada trava recurso ainda) ----------

export async function getMyCouplePlan(coupleId) {
  const { data, error } = await supabase.from("couples").select("plan, plan_expires_at, plan_source").eq("id", coupleId).single();
  if (error) throw error;
  return data;
}

export async function getMyUserPlan(userId) {
  const { data, error } = await supabase.from("user_plans").select("plan, plan_expires_at, plan_source").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data || { plan: null, plan_expires_at: null, plan_source: null };
}

// cria uma assinatura no Mercado Pago (Edge Function, não RPC — precisa do JWT da sessão pra
// autenticar quem está pedindo) e devolve a URL de checkout hospedada por eles pra redirecionar.
export async function createSubscriptionCheckout(scope, tier) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("não autenticado");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mp-create-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ scope, tier }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "não deu pra criar a assinatura");
  return body.init_point;
}

export async function createCouple(code, names = {}, genders = {}, emojis = {}) {
  // via função no servidor: quem está criando ainda não é membro, então não consegue ler a linha de volta
  const { data, error } = await supabase.rpc("create_couple", { p_code: code, p_names: names, p_genders: genders, p_emojis: emojis });
  if (error) throw error;
  return { id: data, code };
}

// nomes/gênero já salvos de um casal, pra quem vai entrar pelo código (busca exata, nunca lista)
export async function findCouplePreview(code) {
  const { data, error } = await supabase.rpc("find_couple_preview", { p_code: code.trim().toUpperCase() });
  if (error) throw error;
  return data?.[0] || null;
}

export async function getCoupleSettings(coupleId) {
  const { data, error } = await supabase.from("couple_settings").select("*").eq("couple_id", coupleId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveCoupleSettings(coupleId, fields) {
  const { data, error } = await supabase
    .from("couple_settings")
    .upsert({ couple_id: coupleId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "couple_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// entrar (ou reentrar) num casal: a função no servidor confere o código e cria ou retoma o perfil
export async function joinCouple({ code, role, displayName }) {
  const { data, error } = await supabase.rpc("join_couple", { p_code: code.trim().toUpperCase(), p_role: role, p_name: displayName });
  if (error) throw error;
  // o servidor devolve o erro de código como resposta (e não como exceção) pra poder contar a tentativa
  if (data?.error) throw new Error(data.error === "codigo_invalido" ? "código inválido" : data.error);
  return data;
}

export async function getMyProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getPartnerProfile(coupleId, myRole) {
  const otherRole = myRole === "gabriel" ? "tata" : "gabriel";
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("role", otherRole)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------- plano do mês (meta + saldo acumulado) ----------

export async function ensureMonthPlan(coupleId, mk, baseTarget = 2) {
  let { data, error } = await supabase
    .from("month_plans")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("month", mk)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  // calcula o quanto ficou faltando no mês anterior pra somar como meta extra
  const prevMk = prevMonthKey(mk);
  const prevPlan = await supabase
    .from("month_plans")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("month", prevMk)
    .maybeSingle();

  let carryIn = 0;
  if (prevPlan.data) {
    const prevTarget = prevPlan.data.base_target + prevPlan.data.carry_in;
    const prevHappened = await countHappenedPlanejados(coupleId, prevMk);
    carryIn = Math.max(0, prevTarget - prevHappened);
  }

  const inserted = await supabase
    .from("month_plans")
    .insert({ couple_id: coupleId, month: mk, base_target: baseTarget, carry_in: carryIn })
    .select()
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

export async function countHappenedPlanejados(coupleId, mk) {
  const { count, error } = await supabase
    .from("encounters")
    .select("id", { count: "exact", head: true })
    .eq("couple_id", coupleId)
    .eq("month", mk)
    .eq("kind", "planejado")
    .eq("status", "aconteceu");
  if (error) throw error;
  return count || 0;
}

// ---------- encontros ----------

export async function listEncountersForMonth(coupleId, mk) {
  const { data, error } = await supabase
    .from("encounters")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("month", mk)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

// ---------- cronômetro do último beijo ----------

export async function getCoupleStats(coupleId) {
  const { data, error } = await supabase.from("couple_stats").select("*").eq("couple_id", coupleId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function setLastKiss(coupleId, isoDateTime) {
  const { data, error } = await supabase
    .from("couple_stats")
    .upsert({ couple_id: coupleId, last_kiss_at: isoDateTime, updated_at: new Date().toISOString() }, { onConflict: "couple_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createEncounter({ coupleId, startDate, endDate, title, kind, createdBy, status, category, yearly }) {
  const mk = monthKey(startDate);
  const { data, error } = await supabase
    .from("encounters")
    .insert({
      couple_id: coupleId,
      month: mk,
      start_date: toISODate(startDate),
      end_date: endDate ? toISODate(endDate) : null,
      title: title || "",
      kind,
      status: status || (kind === "convite" ? "pendente" : "agendado"),
      counts_as_point: kind === "planejado",
      ...(kind === "evento" ? { category: category || "outro", yearly: !!yearly } : {}),
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// datas especiais que se repetem todo ano (aniversário de namoro etc.)
export async function listYearlyDates(coupleId) {
  const { data, error } = await supabase
    .from("encounters")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("kind", "evento")
    .eq("yearly", true);
  if (error) throw error;
  return data || [];
}

export async function updateEncounterStatus(id, status) {
  const { data, error } = await supabase
    .from("encounters")
    .update({ status })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEncounter(id) {
  const { error } = await supabase.from("encounters").delete().eq("id", id);
  if (error) throw error;
}

export async function listPendingInvites(coupleId) {
  const { data, error } = await supabase
    .from("encounters")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("kind", "convite")
    .eq("status", "pendente")
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listAllInvites(coupleId) {
  const { data, error } = await supabase
    .from("encounters")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("kind", "convite")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------- humor ----------

export async function upsertMood(coupleId, dayISO, role, mood, moodPartner, wantsToTalk, note) {
  const { data, error } = await supabase
    .from("moods")
    .upsert(
      { couple_id: coupleId, day: dayISO, role, mood, mood_partner: moodPartner, wants_to_talk: wantsToTalk, note: note || "", updated_at: new Date().toISOString() },
      { onConflict: "couple_id,day,role" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getMoodsForDay(coupleId, dayISO) {
  const { data, error } = await supabase.from("moods").select("*").eq("couple_id", coupleId).eq("day", dayISO);
  if (error) throw error;
  return data || [];
}

export async function getMoodHistory(coupleId, sinceISO) {
  const { data, error } = await supabase
    .from("moods")
    .select("*")
    .eq("couple_id", coupleId)
    .gte("day", sinceISO)
    .order("day", { ascending: true });
  if (error) throw error;
  return data || [];
}

// ---------- pergunta da semana ----------

export async function getWeeklyAnswers(coupleId, weekIndex) {
  const { data, error } = await supabase
    .from("weekly_answers")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("week_index", weekIndex);
  if (error) throw error;
  return data || [];
}

// retorna isNew=true só na primeira vez que essa pessoa responde essa semana (pra decidir a moeda)
export async function saveWeeklyAnswer(coupleId, weekIndex, role, answer) {
  const existing = await supabase
    .from("weekly_answers")
    .select("id")
    .eq("couple_id", coupleId)
    .eq("week_index", weekIndex)
    .eq("role", role)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const isNew = !existing.data;

  const { data, error } = await supabase
    .from("weekly_answers")
    .upsert(
      { couple_id: coupleId, week_index: weekIndex, role, answer, updated_at: new Date().toISOString() },
      { onConflict: "couple_id,week_index,role" }
    )
    .select()
    .single();
  if (error) throw error;
  return { ...data, isNew };
}

// ---------- fim de semana de recarregar ----------

export async function setWeekendRecharge(coupleId, weekStartISO, role, active) {
  const { data, error } = await supabase
    .from("weekend_recharge")
    .upsert(
      { couple_id: coupleId, week_start: weekStartISO, role, active },
      { onConflict: "couple_id,week_start,role" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getWeekendRecharge(coupleId, mk) {
  const { data, error } = await supabase
    .from("weekend_recharge")
    .select("*")
    .eq("couple_id", coupleId)
    .gte("week_start", `${mk}-01`)
    .lt("week_start", `${nextMonthKey(mk)}-01`);
  if (error) throw error;
  return data || [];
}

// ---------- moedas ----------

export async function getCoinBalances(coupleId) {
  const { data, error } = await supabase.from("coin_balances").select("*").eq("couple_id", coupleId);
  if (error) throw error;
  const map = { gabriel: 0, tata: 0 };
  for (const row of data || []) map[row.role] = row.balance;
  return map;
}

export async function addCoinTransaction(coupleId, role, delta, reason) {
  const { error } = await supabase.from("coin_ledger").insert({ couple_id: coupleId, role, delta, reason });
  if (error) throw error;
}

// ---------- progresso em jogos (Capibatman etc.) ----------

// soma quanta moeda cada papel já ganhou de um jogo específico (o motivo de cada lançamento
// começa com o nome do jogo, ex.: "Capibatman: fase 7") — progresso é por pessoa, não do casal
export async function getGameCoinsEarnedByRole(coupleId, gameLabel) {
  const { data, error } = await supabase.from("coin_ledger").select("role, delta").eq("couple_id", coupleId).like("reason", `${gameLabel}:%`);
  if (error) throw error;
  const map = { gabriel: 0, tata: 0 };
  for (const row of data || []) map[row.role] = (map[row.role] || 0) + row.delta;
  return map;
}

export async function getGameProgress(coupleId, role, gameId) {
  const { data, error } = await supabase
    .from("couple_game_progress")
    .select("current_level")
    .eq("couple_id", coupleId)
    .eq("role", role)
    .eq("game_id", gameId)
    .maybeSingle();
  if (error) throw error;
  return data?.current_level || 1;
}

export async function getGameProgressBothRoles(coupleId, gameId) {
  const { data, error } = await supabase.from("couple_game_progress").select("role, current_level").eq("couple_id", coupleId).eq("game_id", gameId);
  if (error) throw error;
  const map = { gabriel: 1, tata: 1 };
  for (const row of data || []) map[row.role] = row.current_level;
  return map;
}

export async function advanceGameProgress(coupleId, role, gameId, newLevel) {
  const { error } = await supabase
    .from("couple_game_progress")
    .upsert({ couple_id: coupleId, role, game_id: gameId, current_level: newLevel, updated_at: new Date().toISOString() }, { onConflict: "couple_id,role,game_id" });
  if (error) throw error;
}

export async function listCoinHistory(coupleId, limit = 20) {
  const { data, error } = await supabase
    .from("coin_ledger")
    .select("*")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ---------- recadinhos fofos ----------

export async function sendSweetNote(coupleId, role, message) {
  const { data, error } = await supabase
    .from("sweet_notes")
    .insert({ couple_id: coupleId, role, message })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listRecentSweetNotes(coupleId, limit = 10) {
  const { data, error } = await supabase
    .from("sweet_notes")
    .select("*")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ---------- reações (um toque no humor ou no recadinho do par) ----------

export async function listReactions(coupleId, kind) {
  const { data, error } = await supabase
    .from("reactions")
    .select("target_id, role, emoji")
    .eq("couple_id", coupleId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return data || [];
}

export async function setReaction(coupleId, kind, targetId, role, emoji) {
  const { error } = await supabase
    .from("reactions")
    .upsert({ couple_id: coupleId, kind, target_id: targetId, role, emoji, created_at: new Date().toISOString() }, { onConflict: "kind,target_id,role" });
  if (error) throw error;
}

export async function removeReaction(kind, targetId, role) {
  const { error } = await supabase.from("reactions").delete().eq("kind", kind).eq("target_id", targetId).eq("role", role);
  if (error) throw error;
}

// ---------- Lembrei de você (foto + observação) ----------

export async function countMyMemoriesToday(coupleId, role) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error } = await supabase
    .from("memory_photos")
    .select("id", { count: "exact", head: true })
    .eq("couple_id", coupleId)
    .eq("role", role)
    .gt("created_at", since);
  if (error) throw error;
  return count || 0;
}

export async function listMemories(coupleId, limit = 30) {
  const { data, error } = await supabase
    .from("memory_photos")
    .select("*")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// foto de perfil: sobe pro espaço público "avatars" (sempre no mesmo arquivo, um por pessoa —
// trocar substitui a antiga) e atualiza em todo lugar que guarda essa foto (perfil do casal
// e a linha em cada turma de amigos que a pessoa faz parte), pra ficar igual em todo canto
export async function uploadMyAvatar(userId, blob) {
  const path = `${userId}/avatar.jpg`;
  const up = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (up.error) {
    let who = null;
    try { who = await supabase.rpc("whoami"); } catch (e) { /* diagnóstico é só um bônus */ }
    throw new Error(`${up.error.message} [status ${up.error.status}/${up.error.statusCode}] (path: ${path}, auth.uid(): ${who?.data ?? "?"})`);
  }
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`; // muda a query pra forçar recarregar (o navegador cacheia por nome de arquivo)
  await Promise.all([
    supabase.from("profiles").update({ avatar_url: url }).eq("id", userId),
    supabase.from("friend_members").update({ avatar_url: url }).eq("user_id", userId),
  ]);
  return url;
}

// devolve um link temporário (1h) pra mostrar a foto — o espaço de arquivo é privado, só do casal
export async function memoryPhotoUrl(path) {
  const { data, error } = await supabase.storage.from("memories").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function createMemory(coupleId, role, photoBlob, caption) {
  const path = `${coupleId}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from("memories").upload(path, photoBlob, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  const { data, error } = await supabase
    .from("memory_photos")
    .insert({ couple_id: coupleId, role, photo_path: path, caption })
    .select()
    .single();
  if (error) {
    // deu erro depois de já ter subido o arquivo (ex.: limite diário): tira o arquivo órfão
    await supabase.storage.from("memories").remove([path]).catch(() => {});
    throw error;
  }
  return data;
}

// reação e/ou comentário do par a uma lembrança
export async function reactToMemory(coupleId, id, role, { emoji, reply } = {}) {
  if (emoji) {
    const { error } = await supabase
      .from("reactions")
      .upsert({ couple_id: coupleId, kind: "memory", target_id: id, role, emoji, created_at: new Date().toISOString() }, { onConflict: "kind,target_id,role" });
    if (error) throw error;
  }
  if (reply && reply.trim()) {
    const { error } = await supabase
      .from("memory_photos")
      .update({ reply_text: reply.trim().slice(0, 300), reply_role: role, replied_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }
}

export async function markMemoryPointsAwarded(id) {
  // só marca se ainda não tinha sido marcado (evita dar moeda 2x se a pessoa reagir e comentar)
  const { data, error } = await supabase
    .from("memory_photos")
    .update({ points_awarded: true })
    .eq("id", id)
    .eq("points_awarded", false)
    .select("id");
  if (error) throw error;
  return (data || []).length > 0; // true = essa chamada que "ganhou a corrida" e deve dar moeda
}

export async function deleteMemory(id, photoPath) {
  await supabase.storage.from("memories").remove([photoPath]).catch(() => {});
  const { error } = await supabase.from("memory_photos").delete().eq("id", id);
  if (error) throw error;
}

// ---------- cápsula do tempo ----------

export async function createTimeCapsule(coupleId, fromRole, message, openOnISO) {
  const { data, error } = await supabase
    .from("time_capsules")
    .insert({ couple_id: coupleId, from_role: fromRole, message, open_on: openOnISO })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listTimeCapsules(coupleId) {
  const { data, error } = await supabase
    .from("time_capsules")
    .select("*")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------- desafio do dia ----------

export async function upsertChallengeAnswer(coupleId, dayISO, role, answer) {
  const { data, error } = await supabase
    .from("daily_challenge_answers")
    .upsert(
      { couple_id: coupleId, day: dayISO, role, answer },
      { onConflict: "couple_id,day,role" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getChallengeAnswersForDay(coupleId, dayISO) {
  const { data, error } = await supabase
    .from("daily_challenge_answers")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("day", dayISO);
  if (error) throw error;
  return data || [];
}

export async function listChallengeAnswersHistory(coupleId, sinceISO) {
  const { data, error } = await supabase
    .from("daily_challenge_answers")
    .select("*")
    .eq("couple_id", coupleId)
    .gte("day", sinceISO)
    .order("day", { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------- desejos secretos ----------

export async function getWishesForRole(coupleId, role) {
  const { data, error } = await supabase
    .from("secret_wishes")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("role", role)
    .order("slot", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function upsertWish(coupleId, role, slot, text) {
  const { data, error } = await supabase
    .from("secret_wishes")
    .upsert(
      { couple_id: coupleId, role, slot, text, updated_at: new Date().toISOString() },
      { onConflict: "couple_id,role,slot" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createWishRedemption(coupleId, redeemedBy, wishOwner, wishText, revealOnISO) {
  const { data, error } = await supabase
    .from("wish_redemptions")
    .insert({ couple_id: coupleId, redeemed_by: redeemedBy, wish_owner: wishOwner, wish_text: wishText, reveal_on: revealOnISO })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listWishRedemptions(coupleId) {
  const { data, error } = await supabase
    .from("wish_redemptions")
    .select("*")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function markWishFulfilled(id) {
  const { error } = await supabase.from("wish_redemptions").update({ fulfilled: true }).eq("id", id);
  if (error) throw error;
}

// ---------- sequência de uso do app ----------

export async function recordAppOpen(coupleId, role, dayISO) {
  const { error } = await supabase
    .from("app_opens")
    .upsert({ couple_id: coupleId, role, day: dayISO }, { onConflict: "couple_id,role,day" });
  if (error) throw error;
}

export async function getAppOpenDays(coupleId, role, sinceISO) {
  const { data, error } = await supabase
    .from("app_opens")
    .select("day")
    .eq("couple_id", coupleId)
    .eq("role", role)
    .gte("day", sinceISO);
  if (error) throw error;
  return (data || []).map((r) => r.day);
}

export async function getStreakFreezeDays(coupleId, role, sinceISO) {
  const { data, error } = await supabase
    .from("streak_freezes")
    .select("day")
    .eq("couple_id", coupleId)
    .eq("role", role)
    .gte("day", sinceISO);
  if (error) throw error;
  return (data || []).map((r) => r.day);
}

export async function addStreakFreeze(coupleId, role, dayISO) {
  const { error } = await supabase.from("streak_freezes").insert({ couple_id: coupleId, role, day: dayISO });
  if (error) throw error;
}

// ---------- lojinha ----------

export async function listShopRedemptions(coupleId, limit = 30) {
  const { data, error } = await supabase
    .from("shop_redemptions")
    .select("*")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function redeemPerk(coupleId, role, perk) {
  await addCoinTransaction(coupleId, role, -perk.cost, `resgatou: ${perk.title}`);
  const { data, error } = await supabase
    .from("shop_redemptions")
    .insert({ couple_id: coupleId, role, perk_id: perk.id, title: perk.title, cost: perk.cost, status: "pendente" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function markRedemptionFulfilled(id, rewardPaid) {
  const { error } = await supabase
    .from("shop_redemptions")
    .update({ status: "cumprido", fulfilled_at: new Date().toISOString(), reward_paid: rewardPaid })
    .eq("id", id);
  if (error) throw error;
}

export async function undoRedemptionFulfilled(id) {
  const { error } = await supabase
    .from("shop_redemptions")
    .update({ status: "pendente", fulfilled_at: null, reward_paid: null })
    .eq("id", id);
  if (error) throw error;
}

// ---------- realtime ----------

export function subscribeCoupleChanges(coupleId, onChange, onSettings) {
  const channel = supabase
    .channel(`couple-${coupleId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "encounters", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "moods", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "weekend_recharge", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "coin_ledger", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "couple_game_progress", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "weekly_answers", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "shop_redemptions", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "couple_stats", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "sweet_notes", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "memory_photos", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "time_capsules", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "daily_challenge_answers", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "secret_wishes", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "wish_redemptions", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "couple_settings", filter: `couple_id=eq.${coupleId}` }, onSettings || onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ---------- itens da lojinha criados pelo casal ----------

export async function listCustomPerks(coupleId) {
  const { data, error } = await supabase
    .from("custom_perks")
    .select("*")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveCustomPerk({ id, coupleId, emoji, title, description, cost, fulfillReward, createdBy }) {
  const fields = { emoji, title, description, cost, fulfill_reward: fulfillReward };
  const q = id
    ? supabase.from("custom_perks").update(fields).eq("id", id)
    : supabase.from("custom_perks").insert({ ...fields, couple_id: coupleId, created_by: createdBy });
  const { data, error } = await q.select().single();
  if (error) throw error;
  return data;
}

export async function deleteCustomPerk(id) {
  const { error } = await supabase.from("custom_perks").delete().eq("id", id);
  if (error) throw error;
}

// ---------- modo dono ----------

export async function adminStats(key) {
  const { data, error } = await supabase.rpc("admin_stats", { p_key: key });
  if (error) throw error;
  return data;
}

export async function adminErrors(key) {
  const { data, error } = await supabase.rpc("admin_errors", { p_key: key });
  if (error) throw error;
  return data;
}

export async function adminContentReports(key) {
  const { data, error } = await supabase.rpc("admin_content_reports", { p_key: key });
  if (error) throw error;
  return data;
}

// ---------- ciclo menstrual (opcional; o banco só entrega ao parceiro se ela compartilhar) ----------

export async function getCycle(coupleId, role) {
  const { data, error } = await supabase
    .from("cycle_settings")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("role", role)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveCycle(coupleId, role, fields) {
  const { data, error } = await supabase
    .from("cycle_settings")
    .upsert(
      { couple_id: coupleId, role, ...fields, updated_at: new Date().toISOString() },
      { onConflict: "couple_id,role" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCycle(coupleId, role) {
  const { error } = await supabase.from("cycle_settings").delete().eq("couple_id", coupleId).eq("role", role);
  if (error) throw error;
}

// lê a configuração mais recente antes de mudar, pra dois aparelhos não apagarem a mudança um do outro
export async function updateCoupleFeatures(coupleId, mutate) {
  const cur = await getCoupleSettings(coupleId);
  const features = mutate({ ...(cur?.features || {}) });
  return saveCoupleSettings(coupleId, { features });
}

export async function setMonthBaseTarget(coupleId, mk, baseTarget) {
  const { error } = await supabase.from("month_plans").update({ base_target: baseTarget }).eq("couple_id", coupleId).eq("month", mk);
  if (error) throw error;
}

// datas especiais (aniversário de namoro etc.), pra mostrar a próxima na tela inicial
export async function listSpecialDates(coupleId) {
  const { data, error } = await supabase
    .from("encounters")
    .select("title,start_date,yearly")
    .eq("couple_id", coupleId)
    .eq("kind", "evento")
    .eq("category", "comemorativa");
  if (error) throw error;
  return data || [];
}
