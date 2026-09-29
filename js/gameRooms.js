// Sistema de salas compartilhado pelos minigames multiplayer (Cartas, Stop) — não sabe
// regra de jogo nenhuma, só sala/lobby/presença/reconexão. Sala vive dentro de uma turma
// existente (reaproveita a confiança que a turma já estabelece).
import { supabase } from "./supabaseClient.js";

export async function createRoom(friendGroupId, gameType, settings = {}) {
  const { data, error } = await supabase.rpc("create_game_room", { p_friend_group_id: friendGroupId, p_game_type: gameType, p_settings: settings });
  if (error) throw error;
  return data; // { id, code }
}

export async function joinRoom(code) {
  const { data, error } = await supabase.rpc("join_game_room", { p_code: code });
  if (error) throw error;
  return data; // { id, code } ou { error: "sala_nao_encontrada" | "partida_ja_iniciada" | "sala_cheia" }
}

export async function setReady(roomId, ready) {
  const { error } = await supabase.rpc("set_player_ready", { p_room_id: roomId, p_ready: ready });
  if (error) throw error;
}

export async function startMatch(roomId) {
  const { error } = await supabase.rpc("start_match", { p_room_id: roomId });
  if (error) throw error;
}

export async function leaveRoom(roomId) {
  const { data, error } = await supabase.rpc("leave_game_room", { p_room_id: roomId });
  if (error) throw error;
  return data; // { new_host }
}

export async function getRoom(roomId) {
  const { data, error } = await supabase.from("game_rooms").select("*").eq("id", roomId).single();
  if (error) throw error;
  return data;
}

export async function listRoomPlayers(roomId) {
  const { data, error } = await supabase.from("game_room_players").select("*").eq("room_id", roomId).is("left_at", null).order("joined_at");
  if (error) throw error;
  return data;
}

// pra reconexão: sala não fechada onde a pessoa ainda está (left_at nulo) — pra oferecer
// "voltar pra partida em andamento" ao abrir o app ou a lista de jogos
export async function findMyActiveRoom(friendGroupId, userId) {
  const { data, error } = await supabase
    .from("game_room_players")
    .select("room_id, game_rooms!inner(id, code, game_type, status, friend_group_id)")
    .eq("user_id", userId)
    .is("left_at", null)
    .eq("game_rooms.friend_group_id", friendGroupId)
    .not("game_rooms.status", "in", "(closed,finished)")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.game_rooms || null;
}

export function subscribeRoomChanges(roomId, onChange) {
  const channel = supabase
    .channel(`game-room-${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "game_room_players", filter: `room_id=eq.${roomId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// presença (quem tá com o app aberto agora nessa sala) — não grava nada no banco, é só a
// lista de canais ativos no servidor do Supabase. Usa isso pra "🟢 online" / "🟡 reconectando"
// sem gastar escrita nenhuma a cada segundo.
export function trackPresence(roomId, userId, displayName) {
  const channel = supabase.channel(`presence-room-${roomId}`, { config: { presence: { key: userId } } });
  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track({ user_id: userId, display_name: displayName, online_at: new Date().toISOString() });
    }
  });
  return channel;
}

// devolve o conjunto de user_id atualmente presentes (com o app aberto nessa sala agora)
export function presentUserIds(channel) {
  const state = channel.presenceState();
  return new Set(Object.keys(state));
}

export function subscribePresence(channel, onSync) {
  channel.on("presence", { event: "sync" }, () => onSync(presentUserIds(channel)));
}

export function stopPresence(channel) {
  supabase.removeChannel(channel);
}
