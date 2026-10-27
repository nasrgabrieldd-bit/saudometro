// Edge Function: dispara notificação push pra turma sempre que algo relevante muda —
// rolê marcado, ideia nova de "fazer juntos", cápsula do tempo selada. Diferente da function
// "notify" (casal, avisa 1 parceiro), aqui avisa VÁRIAS pessoas (todo mundo da turma, exceto
// quem criou o registro) — por isso não usa push_subscriptions (couple_id/role), usa
// friend_push_subscriptions (user_id).
// Chamada por Database Webhooks (INSERT).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails("mailto:gabriel.nasr@gutierrefilmes.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// a maioria desses avisa a turma inteira (menos quem criou), com excludeUserId. A
// Capisurpresa é diferente — é um carinho pra UMA pessoa só, não pra turma toda — por
// isso tem targetUserId como alternativa: quando presente, ignora excludeUserId e manda
// só pra esse usuário.
type Msg = { title: string; body: string; path: string; excludeUserId?: string | null; targetUserId?: string | null } | null;

// lembrete das 20h (scripts/lembrete-humor.mjs): estilo "coruja do Duolingo", frase ao acaso
const MOOD_REMINDERS: Array<[string, string]> = [
  ["Psiu! 🦫", "A capivara ficou o dia todo esperando seu humor. Leva só 10 segundinhos!"],
  ["O Saudômetro tá com saudade de você 🥺", "Seu humor de hoje ainda não chegou. Como foi o seu dia?"],
  ["Já são mais de 20h... ⏰", "Seu humor de hoje ainda tá em branco. Bora fechar o dia?"],
  ["Esses lembretes não vão parar 😈", "Registra o humor de hoje e a capivara te deixa em paz. Talvez."],
  ["Seu humor tá chorando num canto 😢", "Ninguém registrou ele hoje. Vem dar um abraço nele!"],
  ["A sequência tá em perigo! 🔥", "Falta só registrar o humor de hoje pra não perder o embalo."],
  ["Tá tudo bem por aí? 💗", "Conta pra turma como foi seu dia: o humor de hoje ainda tá esperando."],
  ["A capivara não vai dormir sem saber 🌙", "Registra o humor de hoje rapidinho e descansa tranquilo(a)."],
];

function messageFor(table: string, type: string, record: any): Msg {
  if (table === "mood_reminder" && type === "INSERT") {
    const [title, body] = MOOD_REMINDERS[Math.floor(Math.random() * MOOD_REMINDERS.length)];
    return { title, body, path: "?tab=mood", targetUserId: record.user_id };
  }
  if (table === "friend_events" && type === "INSERT") {
    return {
      title: "Novo rolê marcado 📅",
      body: `${record.title || "Um rolê novo"} foi marcado na turma.`,
      path: "?tab=roles",
      excludeUserId: record.created_by,
    };
  }
  if (table === "friend_date_ideas" && type === "INSERT") {
    return {
      title: "Nova ideia de fazer juntos 🎯",
      body: `"${record.title}" foi adicionada pra turma avaliar.`,
      path: "?tab=home",
      excludeUserId: record.created_by,
    };
  }
  if (table === "friend_time_capsules" && type === "INSERT") {
    return {
      title: "Cápsula do tempo selada 🕰️",
      body: "Alguém da turma selou uma cápsula do tempo pra abrir todo mundo junto.",
      path: "?tab=home",
      excludeUserId: record.from_user_id,
    };
  }
  // só notifica quando já está disponível de verdade — ver mesmo comentário na function
  // "notify" (casal): sem worker em segundo plano, não dá pra disparar isso na hora exata
  // de um envio agendado, então agendadas simplesmente não notificam.
  if (table === "capisurpresas" && type === "INSERT" && record.friend_group_id && record.status === "disponivel") {
    return {
      title: "Chegou um carinho 💌",
      body: "Alguém da turma te mandou uma Capisurpresa.",
      path: "?tab=notes&view=capisurpresa",
      targetUserId: record.recipient_user_id,
    };
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const type = payload.type;
    const table = payload.table;
    const record = payload.record;
    if (!record || !record.friend_group_id) return new Response("no record", { status: 200 });

    const msg = messageFor(table, type, record);
    if (!msg) return new Response("nothing to notify", { status: 200 });

    let userIds: string[];
    if (msg.targetUserId) {
      userIds = [msg.targetUserId];
    } else {
      let membersQuery = supabase.from("friend_members").select("user_id").eq("friend_group_id", record.friend_group_id);
      if (msg.excludeUserId) membersQuery = membersQuery.neq("user_id", msg.excludeUserId);
      const { data: members, error: memErr } = await membersQuery;
      if (memErr) throw memErr;
      userIds = (members || []).map((m) => m.user_id);
    }
    if (!userIds.length) return new Response("no recipients", { status: 200 });

    const { data: subs, error } = await supabase.from("friend_push_subscriptions").select("*").in("user_id", userIds);
    if (error) throw error;

    const results = await Promise.allSettled(
      (subs || []).map((s) =>
        webpush
          .sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: msg.title, body: msg.body, url: `./${msg.path}` })
          )
          .catch(async (err: any) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              await supabase.from("friend_push_subscriptions").delete().eq("endpoint", s.endpoint);
            }
            throw err;
          })
      )
    );

    return new Response(JSON.stringify({ sent: results.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500 });
  }
});
