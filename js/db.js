import { supabase } from "./supabaseClient.js";
import { monthKey, prevMonthKey, nextMonthKey, toISODate } from "./util.js";

// ---------- auth / casal / perfil ----------

export async function ensureAnonSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  const { data: signed, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signed.session;
}

export async function findCoupleByCode(code) {
  const { data, error } = await supabase
    .from("couples")
    .select("id, code")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createCouple(code) {
  const { data, error } = await supabase
    .from("couples")
    .insert({ code })
    .select("id, code")
    .single();
  if (error) throw error;
  return data;
}

export async function getRolesTaken(coupleId) {
  const { data, error } = await supabase.from("profiles").select("role").eq("couple_id", coupleId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.role));
}

export async function createProfile({ id, coupleId, role, displayName }) {
  const { data, error } = await supabase
    .from("profiles")
    .insert({ id, couple_id: coupleId, role, display_name: displayName })
    .select()
    .single();
  if (error) throw error;
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

export async function ensureMonthPlan(coupleId, mk) {
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
    .insert({ couple_id: coupleId, month: mk, base_target: 2, carry_in: carryIn })
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

export async function createEncounter({ coupleId, startDate, endDate, title, kind, createdBy, status }) {
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
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
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

export async function upsertMood(coupleId, dayISO, role, mood, wantsToTalk, note) {
  const { data, error } = await supabase
    .from("moods")
    .upsert(
      { couple_id: coupleId, day: dayISO, role, mood, wants_to_talk: wantsToTalk, note: note || "", updated_at: new Date().toISOString() },
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

// ---------- realtime ----------

export function subscribeCoupleChanges(coupleId, onChange) {
  const channel = supabase
    .channel(`couple-${coupleId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "encounters", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "moods", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "weekend_recharge", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "coin_ledger", filter: `couple_id=eq.${coupleId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `couple_id=eq.${coupleId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
