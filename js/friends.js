// Modo Amigos: contas separadas do casal. Uma pessoa pode estar em várias turmas ao
// mesmo tempo (diferente do casal, que é só 1). Exige login com Google (não anônimo) —
// isso é conferido de novo no banco, não só aqui.
import { supabase } from "./supabaseClient.js";

export async function listMyFriendGroups() {
  const { data, error } = await supabase
    .from("friend_members")
    .select("friend_group_id, display_name, friend_groups(id, name, code)")
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.friend_group_id,
    name: r.friend_groups?.name || "Turma",
    code: r.friend_groups?.code || "",
    myDisplayName: r.display_name,
  }));
}

export async function listGroupMembers(friendGroupId) {
  const { data, error } = await supabase
    .from("friend_members")
    .select("user_id, display_name, joined_at")
    .eq("friend_group_id", friendGroupId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createFriendGroup(name, displayName) {
  const { data, error } = await supabase.rpc("create_friend_group", { p_name: name, p_display_name: displayName });
  if (error) throw error;
  return data;
}

export async function joinFriendGroup(code, displayName) {
  const { data, error } = await supabase.rpc("join_friend_group", { p_code: code, p_display_name: displayName });
  if (error) throw error;
  // código errado vem como resposta (não como exceção) pra a tentativa poder ficar registrada
  if (data?.error) throw new Error(data.error);
  return data;
}

// ---------- humor da turma ----------

export async function getMoodsForDay(friendGroupId, dayISO) {
  const { data, error } = await supabase.from("friend_moods").select("*").eq("friend_group_id", friendGroupId).eq("day", dayISO);
  if (error) throw error;
  return data || [];
}

export async function setMyMood(friendGroupId, dayISO, userId, mood) {
  const { error } = await supabase
    .from("friend_moods")
    .upsert({ friend_group_id: friendGroupId, day: dayISO, user_id: userId, mood }, { onConflict: "friend_group_id,day,user_id" });
  if (error) throw error;
}

// ---------- prêmios (cofre de moedas do grupo) ----------

export async function getGroupCoinBalance(friendGroupId) {
  const { data, error } = await supabase.from("friend_coin_balances").select("balance").eq("friend_group_id", friendGroupId).maybeSingle();
  if (error) throw error;
  return data?.balance || 0;
}

export async function listGroupRedemptions(friendGroupId, limit = 30) {
  const { data, error } = await supabase
    .from("friend_redemptions")
    .select("*")
    .eq("friend_group_id", friendGroupId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function redeemGroupPerk(friendGroupId, userId, perk) {
  const { error: err1 } = await supabase
    .from("friend_coin_ledger")
    .insert({ friend_group_id: friendGroupId, user_id: userId, delta: -perk.cost, reason: `resgate: ${perk.title}` });
  if (err1) throw err1;
  const { data, error: err2 } = await supabase
    .from("friend_redemptions")
    .insert({ friend_group_id: friendGroupId, user_id: userId, perk_id: perk.id, title: perk.title, cost: perk.cost, status: "pendente" })
    .select()
    .single();
  if (err2) throw err2;
  return data;
}

export async function markGroupRedemptionFulfilled(id) {
  const { error } = await supabase.from("friend_redemptions").update({ status: "cumprido", fulfilled_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ---------- rolês (agenda de encontros da turma) ----------

export async function listUpcomingEvents(friendGroupId, fromDateISO, limit = 20) {
  const { data, error } = await supabase
    .from("friend_events")
    .select("*, friend_event_rsvps(user_id, status)")
    .eq("friend_group_id", friendGroupId)
    .gte("start_date", fromDateISO)
    .order("start_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function listEventsForMonth(friendGroupId, monthStartISO, monthEndISO) {
  const { data, error } = await supabase
    .from("friend_events")
    .select("*, friend_event_rsvps(user_id, status)")
    .eq("friend_group_id", friendGroupId)
    .gte("start_date", monthStartISO)
    .lt("start_date", monthEndISO)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createEvent(friendGroupId, userId, title, startDateISO, startTime, category) {
  const { data, error } = await supabase
    .from("friend_events")
    .insert({ friend_group_id: friendGroupId, title, start_date: startDateISO, start_time: startTime || null, category: category || "amigos", created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEvent(id) {
  const { error } = await supabase.from("friend_events").delete().eq("id", id);
  if (error) throw error;
}

export async function setMyRsvp(eventId, userId, status) {
  const { error } = await supabase
    .from("friend_event_rsvps")
    .upsert({ event_id: eventId, user_id: userId, status, updated_at: new Date().toISOString() }, { onConflict: "event_id,user_id" });
  if (error) throw error;
}
