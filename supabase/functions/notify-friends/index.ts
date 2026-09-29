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

type Msg = { title: string; body: string; path: string; excludeUserId: string | null } | null;

function messageFor(table: string, type: string, record: any): Msg {
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

    let membersQuery = supabase.from("friend_members").select("user_id").eq("friend_group_id", record.friend_group_id);
    if (msg.excludeUserId) membersQuery = membersQuery.neq("user_id", msg.excludeUserId);
    const { data: members, error: memErr } = await membersQuery;
    if (memErr) throw memErr;
    const userIds = (members || []).map((m) => m.user_id);
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
