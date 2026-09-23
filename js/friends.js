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
