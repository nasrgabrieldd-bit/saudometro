// Modo Amigos: contas separadas do casal. Uma pessoa pode estar em várias turmas ao
// mesmo tempo (diferente do casal, que é só 1). Exige login com Google (não anônimo) —
// isso é conferido de novo no banco, não só aqui.
import { supabase } from "./supabaseClient.js";

export async function listMyFriendGroups() {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const myId = userData?.user?.id;
  // duas consultas: a primeira só a MINHA linha em cada turma (uma por turma que eu faço parte);
  // a segunda traz todo mundo de todas as minhas turmas, só pra contar quantos tem em cada uma
  // (sem esse filtro por user_id, uma turma de 3 pessoas aparecia repetida 3x na lista)
  const [{ data: mine, error: err1 }, { data: allMembers, error: err2 }] = await Promise.all([
    supabase.from("friend_members").select("friend_group_id, display_name, friend_groups(id, name, code, emoji, color_key)").eq("user_id", myId).order("joined_at", { ascending: true }),
    supabase.from("friend_members").select("friend_group_id"),
  ]);
  if (err1) throw err1;
  if (err2) throw err2;
  const counts = {};
  (allMembers || []).forEach((r) => { counts[r.friend_group_id] = (counts[r.friend_group_id] || 0) + 1; });
  return (mine || []).map((r) => ({
    id: r.friend_group_id,
    name: r.friend_groups?.name || "Turma",
    code: r.friend_groups?.code || "",
    emoji: r.friend_groups?.emoji || "👥",
    colorKey: r.friend_groups?.color_key || "azul",
    myDisplayName: r.display_name,
    memberCount: counts[r.friend_group_id] || 1,
  }));
}

export async function listGroupMembers(friendGroupId) {
  const { data, error } = await supabase
    .from("friend_members")
    .select("user_id, display_name, avatar_url, joined_at")
    .eq("friend_group_id", friendGroupId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function updateMyDisplayName(friendGroupId, userId, displayName) {
  const { error } = await supabase.from("friend_members").update({ display_name: displayName }).eq("friend_group_id", friendGroupId).eq("user_id", userId);
  if (error) throw error;
}

export async function createFriendGroup(name, displayName, emoji, colorKey) {
  const { data, error } = await supabase.rpc("create_friend_group", { p_name: name, p_display_name: displayName, p_emoji: emoji || "👥", p_color_key: colorKey || "azul" });
  if (error) throw error;
  return { id: data.id, name: data.name, code: data.code, emoji: data.emoji, colorKey: data.color_key };
}

export async function updateFriendGroup(friendGroupId, { name, emoji, colorKey }) {
  const fields = {};
  if (name !== undefined) fields.name = name;
  if (emoji !== undefined) fields.emoji = emoji;
  if (colorKey !== undefined) fields.color_key = colorKey;
  const { error } = await supabase.from("friend_groups").update(fields).eq("id", friendGroupId);
  if (error) throw error;
}

export async function joinFriendGroup(code, displayName) {
  const { data, error } = await supabase.rpc("join_friend_group", { p_code: code, p_display_name: displayName });
  if (error) throw error;
  // código errado vem como resposta (não como exceção) pra a tentativa poder ficar registrada
  if (data?.error) throw new Error(data.error);
  return { id: data.id, name: data.name, code: data.code, emoji: data.emoji, colorKey: data.color_key };
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

export async function listCoinHistory(friendGroupId, limit = 30) {
  const { data, error } = await supabase
    .from("friend_coin_ledger")
    .select("*")
    .eq("friend_group_id", friendGroupId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function addCoinBonus(friendGroupId, userId, delta, reason) {
  const { error } = await supabase.from("friend_coin_ledger").insert({ friend_group_id: friendGroupId, user_id: userId, delta, reason });
  if (error) throw error;
}

// ---------- progresso em jogos (Capibatman etc.) ----------

// soma quanta moeda cada membro já ganhou de um jogo específico — progresso é por pessoa
export async function getGameCoinsEarnedByUser(friendGroupId, gameLabel) {
  const { data, error } = await supabase.from("friend_coin_ledger").select("user_id, delta").eq("friend_group_id", friendGroupId).like("reason", `${gameLabel}:%`);
  if (error) throw error;
  const map = {};
  for (const row of data || []) map[row.user_id] = (map[row.user_id] || 0) + row.delta;
  return map;
}

export async function getGameProgress(friendGroupId, userId, gameId) {
  const { data, error } = await supabase
    .from("friend_game_progress")
    .select("current_level")
    .eq("friend_group_id", friendGroupId)
    .eq("user_id", userId)
    .eq("game_id", gameId)
    .maybeSingle();
  if (error) throw error;
  return data?.current_level || 1;
}

export async function getGameProgressAllMembers(friendGroupId, gameId) {
  const { data, error } = await supabase.from("friend_game_progress").select("user_id, current_level").eq("friend_group_id", friendGroupId).eq("game_id", gameId);
  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.user_id, r.current_level]));
}

export async function advanceGameProgress(friendGroupId, userId, gameId, newLevel) {
  const { error } = await supabase
    .from("friend_game_progress")
    .upsert({ friend_group_id: friendGroupId, user_id: userId, game_id: gameId, current_level: newLevel, updated_at: new Date().toISOString() }, { onConflict: "friend_group_id,user_id,game_id" });
  if (error) throw error;
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

export async function createEvent(friendGroupId, userId, title, startDateISO, startTime, category, details, invitedUserIds) {
  const { data, error } = await supabase
    .from("friend_events")
    .insert({ friend_group_id: friendGroupId, title, start_date: startDateISO, start_time: startTime || null, category: category || "amigos", details: details || "", invited_user_ids: invitedUserIds && invitedUserIds.length ? invitedUserIds : null, created_by: userId })
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

// ---------- experiências (achados: filme/série/jogo/playlist/recado) ----------

export async function listFinds(friendGroupId, limit = 50) {
  const { data, error } = await supabase
    .from("friend_finds")
    .select("*, friend_find_reactions(user_id, reaction)")
    .eq("friend_group_id", friendGroupId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function createFind(friendGroupId, userId, kind, title, link, note, photoBlob) {
  let photoPath = null;
  if (photoBlob) {
    photoPath = `${friendGroupId}/${crypto.randomUUID()}.jpg`;
    const up = await supabase.storage.from("friend-feed").upload(photoPath, photoBlob, { contentType: "image/jpeg" });
    if (up.error) throw up.error;
  }
  const { data, error } = await supabase
    .from("friend_finds")
    .insert({ friend_group_id: friendGroupId, user_id: userId, kind, title, link: link || "", note: note || "", photo_path: photoPath })
    .select()
    .single();
  if (error) {
    if (photoPath) await supabase.storage.from("friend-feed").remove([photoPath]).catch(() => {});
    throw error;
  }
  return data;
}

export async function deleteFind(id, photoPath) {
  if (photoPath) await supabase.storage.from("friend-feed").remove([photoPath]).catch(() => {});
  const { error } = await supabase.from("friend_finds").delete().eq("id", id);
  if (error) throw error;
}

export async function setMyFindReaction(findId, userId, reaction) {
  const { error } = await supabase
    .from("friend_find_reactions")
    .upsert({ find_id: findId, user_id: userId, reaction }, { onConflict: "find_id,user_id" });
  if (error) throw error;
}

export async function clearMyFindReaction(findId, userId) {
  const { error } = await supabase.from("friend_find_reactions").delete().eq("find_id", findId).eq("user_id", userId);
  if (error) throw error;
}

// ---------- ofensiva do dia (sequência de uso da turma) ----------

export async function recordGroupActivityToday(friendGroupId, dayISO) {
  const { error } = await supabase.from("friend_streak_days").upsert({ friend_group_id: friendGroupId, day: dayISO }, { onConflict: "friend_group_id,day", ignoreDuplicates: true });
  if (error) throw error;
}

export async function listStreakDays(friendGroupId, sinceISO) {
  const { data, error } = await supabase.from("friend_streak_days").select("day").eq("friend_group_id", friendGroupId).gte("day", sinceISO);
  if (error) throw error;
  return (data || []).map((r) => r.day);
}

// ---------- prêmios criados pela própria turma ----------

export async function listCustomPerks(friendGroupId) {
  const { data, error } = await supabase.from("friend_custom_perks").select("*").eq("friend_group_id", friendGroupId).order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createCustomPerk(friendGroupId, userId, emoji, title, description, cost) {
  const { data, error } = await supabase
    .from("friend_custom_perks")
    .insert({ friend_group_id: friendGroupId, emoji: emoji || "🎁", title, description: description || "", cost, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCustomPerk(id) {
  const { error } = await supabase.from("friend_custom_perks").delete().eq("id", id);
  if (error) throw error;
}

// ---------- gestão da turma (excluir, trocar código, remover por votação) ----------

export async function deleteFriendGroup(friendGroupId) {
  const { error } = await supabase.from("friend_groups").delete().eq("id", friendGroupId);
  if (error) throw error;
}

export async function regenerateFriendGroupCode(friendGroupId) {
  const { data, error } = await supabase.rpc("regenerate_friend_group_code", { p_friend_group_id: friendGroupId });
  if (error) throw error;
  return data;
}

export async function leaveFriendGroup(friendGroupId) {
  const { error } = await supabase.rpc("leave_friend_group", { p_friend_group_id: friendGroupId });
  if (error) throw error;
}

export async function listActiveKickVotes(friendGroupId) {
  const { data, error } = await supabase
    .from("friend_kick_votes")
    .select("*, friend_kick_ballots(user_id, vote)")
    .eq("friend_group_id", friendGroupId)
    .eq("resolved", false);
  if (error) throw error;
  return data || [];
}

export async function proposeKickVote(friendGroupId, targetUserId) {
  const { data, error } = await supabase.rpc("propose_kick_vote", { p_friend_group_id: friendGroupId, p_target_user_id: targetUserId });
  if (error) throw error;
  return data;
}

export async function castKickBallot(kickVoteId, vote) {
  const { data, error } = await supabase.rpc("cast_kick_ballot", { p_kick_vote_id: kickVoteId, p_vote: vote });
  if (error) throw error;
  return data;
}

// ---------- comentários num achado ----------

export async function listFindComments(findId) {
  const { data, error } = await supabase.from("friend_find_comments").select("*").eq("find_id", findId).order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addFindComment(findId, userId, text) {
  const { data, error } = await supabase.from("friend_find_comments").insert({ find_id: findId, user_id: userId, text }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFindComment(id) {
  const { error } = await supabase.from("friend_find_comments").delete().eq("id", id);
  if (error) throw error;
}

// ---------- feed de fotos (Experiências) ----------

export async function listFeedPosts(friendGroupId, limit = 60) {
  const nowISO = new Date().toISOString();
  const { data, error } = await supabase
    .from("friend_feed_posts")
    .select("*, friend_feed_likes(user_id), friend_feed_comments(id)")
    .eq("friend_group_id", friendGroupId)
    .or(`expires_at.is.null,expires_at.gt.${nowISO}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function feedPhotoUrl(path) {
  const { data, error } = await supabase.storage.from("friend-feed").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function createFeedPost(friendGroupId, userId, photoBlob, caption, isFofoca, hashtag, expiresAt) {
  const path = `${friendGroupId}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from("friend-feed").upload(path, photoBlob, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  const { data, error } = await supabase
    .from("friend_feed_posts")
    .insert({ friend_group_id: friendGroupId, user_id: userId, photo_path: path, caption: caption || "", is_fofoca: !!isFofoca, hashtag: hashtag || null, expires_at: expiresAt || null })
    .select()
    .single();
  if (error) {
    await supabase.storage.from("friend-feed").remove([path]).catch(() => {});
    throw error;
  }
  return data;
}

export async function deleteFeedPost(id, photoPath) {
  await supabase.storage.from("friend-feed").remove([photoPath]).catch(() => {});
  const { error } = await supabase.from("friend_feed_posts").delete().eq("id", id);
  if (error) throw error;
}

export async function likeFeedPost(postId, userId) {
  const { error } = await supabase.from("friend_feed_likes").insert({ post_id: postId, user_id: userId });
  if (error) throw error;
}

export async function unlikeFeedPost(postId, userId) {
  const { error } = await supabase.from("friend_feed_likes").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) throw error;
}

export async function listFeedComments(postId) {
  const { data, error } = await supabase.from("friend_feed_comments").select("*").eq("post_id", postId).order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addFeedComment(postId, userId, text) {
  const { data, error } = await supabase.from("friend_feed_comments").insert({ post_id: postId, user_id: userId, text }).select().single();
  if (error) throw error;
  return data;
}
