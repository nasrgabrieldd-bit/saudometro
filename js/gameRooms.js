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

// regra oficial do Uno: chama "UNO" com 1 carta na mão; qualquer outro jogador pode flagrar
// quem não chamou a tempo (penalidade de 2 cartas)
export async function callUno(matchId) {
  const { error } = await supabase.rpc("call_uno", { p_match_id: matchId });
  if (error) throw error;
}

export async function catchUno(matchId, targetUserId) {
  const { data, error } = await supabase.rpc("catch_uno", { p_match_id: matchId, p_target_user_id: targetUserId });
  if (error) throw error;
  return data; // { caught }
}

export function subscribeCardMatch(matchId, onChange) {
  const channel = supabase
    .channel(`card-match-${matchId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "card_matches", filter: `id=eq.${matchId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "card_match_players", filter: `match_id=eq.${matchId}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ================= Stop/Adedonha (Fase 3: motor de regras) =================
// startStopMatch serve tanto pra começar quanto pra revanche (idempotente, mesma lógica de
// startCardMatch: se já tem partida "playing" pra essa sala, devolve ela).

export async function startStopMatch(roomId) {
  const { data, error } = await supabase.rpc("start_stop_match", { p_room_id: roomId });
  if (error) throw error;
  return data; // { match_id }
}

export async function getStopMatch(matchId) {
  const { data, error } = await supabase.from("stop_matches").select("*").eq("id", matchId).single();
  if (error) throw error;
  return data;
}

// answersObj = { nome: "...", animal: "...", ... } — pode chamar de novo quantas vezes quiser
// enquanto a rodada ainda estiver na fase de resposta (grava por cima, campo a campo)
export async function submitStopAnswers(matchId, answersObj) {
  const { error } = await supabase.rpc("submit_stop_answers", { p_match_id: matchId, p_answers: answersObj });
  if (error) throw error;
}

// force=true é o botão STOP (fecha a rodada na hora); sem force, só fecha de verdade se já
// passou do horário — o servidor revalida, não confia no relógio do cliente que chamou
export async function finishRound(matchId, force = false) {
  const { error } = await supabase.rpc("finish_round", { p_match_id: matchId, p_force: force });
  if (error) throw error;
}

export async function advanceStopRound(matchId) {
  const { data, error } = await supabase.rpc("advance_stop_round", { p_match_id: matchId });
  if (error) throw error;
  return data; // { finished }
}

// idempotente: devolve awarded=true só pra quem chamar primeiro depois da partida terminar —
// evita conceder moeda em dobro se os dois celulares chegarem na tela de fim ao mesmo tempo
export async function markStopCoinsAwarded(matchId) {
  const { data, error } = await supabase.rpc("mark_stop_coins_awarded", { p_match_id: matchId });
  if (error) throw error;
  return data; // { awarded }
}

// RLS só devolve a própria resposta enquanto a rodada não "virou passado" — nada especial pra
// fazer aqui além de pedir tudo, o banco já filtra sozinho. roundNumber omitido = todas as
// rodadas já reveladas (pra somar o placar final).
export async function listStopAnswers(matchId, roundNumber = null) {
  let q = supabase.from("stop_answers").select("*").eq("match_id", matchId);
  if (roundNumber != null) q = q.eq("round_number", roundNumber);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export function subscribeStopMatch(matchId, onChange) {
  const channel = supabase
    .channel(`stop-match-${matchId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "stop_matches", filter: `id=eq.${matchId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "stop_answers", filter: `match_id=eq.${matchId}` }, onChange)
    // contestação/voto não tem match_id direto (só via join) — sem filter, qualquer evento
    // nessas duas tabelas dispara um refetch geral, mesmo padrão de "nudge" já usado aqui
    .on("postgres_changes", { event: "*", schema: "public", table: "stop_contests" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "stop_contest_ballots" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ================= Contestar resposta do STOP (Fase 4: refino) =================

export async function proposeStopContest(matchId, roundNumber, category, targetUserId) {
  const { data, error } = await supabase.rpc("propose_stop_contest", {
    p_match_id: matchId, p_round_number: roundNumber, p_category: category, p_target_user_id: targetUserId,
  });
  if (error) throw error;
  return data; // contest id
}

export async function castStopContestBallot(contestId, vote) {
  const { data, error } = await supabase.rpc("cast_stop_contest_ballot", { p_contest_id: contestId, p_vote: vote });
  if (error) throw error;
  return data; // { resolved, invalid, yes?, eligible? }
}

export async function finishStopContest(contestId) {
  const { error } = await supabase.rpc("finish_stop_contest", { p_contest_id: contestId });
  if (error) throw error;
}

export async function listStopContests(matchId, roundNumber) {
  const { data, error } = await supabase.from("stop_contests").select("*, stop_contest_ballots(*)").eq("match_id", matchId).eq("round_number", roundNumber);
  if (error) throw error;
  return data;
}
