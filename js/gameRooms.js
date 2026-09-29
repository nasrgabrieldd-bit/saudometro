// Sistema de salas compartilhado pelos minigames multiplayer (Cartas, Stop) — não sabe
// regra de jogo nenhuma, só sala/lobby/presença/reconexão. Sala vive dentro de uma turma
// OU de um casal existente (reaproveita a confiança que já existe, nunca convite pra estranho).
import { supabase } from "./supabaseClient.js";

// owner = { type: "friend_group" | "couple", id }
export async function createRoom(owner, gameType, settings = {}) {
  const params = { p_friend_group_id: owner.type === "friend_group" ? owner.id : null, p_game_type: gameType, p_settings: settings };
  if (owner.type === "couple") params.p_couple_id = owner.id;
  const { data, error } = await supabase.rpc("create_game_room", params);
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
export async function findMyActiveRoom(owner, userId) {
  const ownerColumn = owner.type === "couple" ? "couple_id" : "friend_group_id";
  const { data, error } = await supabase
    .from("game_room_players")
    .select(`room_id, game_rooms!inner(id, code, game_type, status, ${ownerColumn})`)
    .eq("user_id", userId)
    .is("left_at", null)
    .eq(`game_rooms.${ownerColumn}`, owner.id)
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
// onSync precisa ser registrado ANTES do subscribe() (o cliente do Supabase Realtime recusa
// registrar callback de "presence" depois que o canal já está inscrito), por isso trackPresence
// já recebe onSync em vez de exigir uma chamada separada depois
export function trackPresence(roomId, userId, displayName, onSync) {
  const channel = supabase.channel(`presence-room-${roomId}`, { config: { presence: { key: userId } } });
  if (onSync) channel.on("presence", { event: "sync" }, () => onSync(presentUserIds(channel)));
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

export function stopPresence(channel) {
  supabase.removeChannel(channel);
}

// ================= Cartas (Fase 2: motor de regras) =================
// Chama startCardMatch tanto pra começar quanto pra revanche (é idempotente: se já tem uma
// partida "playing" pra essa sala, devolve ela; se a anterior terminou, cria uma nova).

export async function startCardMatch(roomId) {
  const { data, error } = await supabase.rpc("start_card_match", { p_room_id: roomId });
  if (error) throw error;
  return data; // { match_id }
}

export async function getCardMatch(matchId) {
  const { data, error } = await supabase.from("card_matches").select("*").eq("id", matchId).single();
  if (error) throw error;
  return data;
}

export async function listCardMatchPlayers(matchId) {
  const { data, error } = await supabase.from("card_match_players").select("*").eq("match_id", matchId).order("seat_order");
  if (error) throw error;
  return data;
}

// RLS só devolve a própria linha (card_hands: user_id = auth.uid()) — mesmo pedindo tudo,
// ninguém mais consegue ler a mão de outro jogador por aqui
export async function getMyHand(matchId, userId) {
  const { data, error } = await supabase.from("card_hands").select("cards").eq("match_id", matchId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data?.cards || [];
}

export async function playCard(matchId, cardIndex, chosenColor = null) {
  const { data, error } = await supabase.rpc("play_card", { p_match_id: matchId, p_card_index: cardIndex, p_chosen_color: chosenColor });
  if (error) throw error;
  return data; // { ok, winner }
}

export async function drawCard(matchId) {
  const { data, error } = await supabase.rpc("draw_card", { p_match_id: matchId });
  if (error) throw error;
  return data; // { card }
}

export async function passTurn(matchId) {
  const { error } = await supabase.rpc("pass_turn", { p_match_id: matchId });
  if (error) throw error;
}

// chamado depois de detectar (via subscribeRoomChanges, quando um jogador sai) que a pessoa
// da vez pode ter saído da sala — sem efeito nenhum se não for o caso
export async function skipDepartedTurn(matchId) {
  const { error } = await supabase.rpc("skip_departed_turn", { p_match_id: matchId });
  if (error) throw error;
}

export function subscribeCardMatch(matchId, onChange) {
  const channel = supabase
    .channel(`card-match-${matchId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "card_matches", filter: `id=eq.${matchId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "card_match_players", filter: `match_id=eq.${matchId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
