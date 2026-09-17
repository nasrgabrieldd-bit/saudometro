// Edge Function: dispara notificação push pro parceiro quando humor, convite/calendário
// ou resposta da pergunta da semana muda. Chamada por Database Webhooks (INSERT).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails("mailto:gabriel.nasr@gutierrefilmes.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const ROLE_LABEL: Record<string, string> = { gabriel: "Gabriel", tata: "Tata" };

function messageFor(table: string, record: any): { title: string; body: string } | null {
  if (table === "moods") {
    return { title: "Humor atualizado 💗", body: `${ROLE_LABEL[record.role] || record.role} registrou o humor de hoje.` };
  }
  if (table === "encounters") {
    if (record.kind === "convite" && record.status === "pendente") {
      return { title: "Novo convite 💌", body: `${ROLE_LABEL[record.created_by]} te convidou: ${record.title || "um encontro"}` };
    }
    if (record.kind === "planejado") {
      return { title: "Calendário atualizado 📅", body: `${ROLE_LABEL[record.created_by]} definiu um encontro do mês.` };
    }
    if (record.kind === "saudade") {
      return { title: "Calendário atualizado 🫂", body: `${ROLE_LABEL[record.created_by]} marcou um encontro de saudade.` };
    }
    return null;
  }
  if (table === "weekly_answers") {
    return { title: "Pergunta da semana 💭", body: `${ROLE_LABEL[record.role]} respondeu a pergunta da semana!` };
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const table = payload.table;
    const record = payload.record;
    if (!record) return new Response("no record", { status: 200 });

    const msg = messageFor(table, record);
    if (!msg) return new Response("nothing to notify", { status: 200 });

    // manda pro OUTRO papel, não pra quem causou a mudança
    const actorRole = record.role || record.created_by;
    const partnerRole = actorRole === "gabriel" ? "tata" : "gabriel";

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("couple_id", record.couple_id)
      .eq("role", partnerRole);
    if (error) throw error;

    const results = await Promise.allSettled(
      (subs || []).map((s) =>
        webpush
          .sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: msg.title, body: msg.body, url: "./" })
          )
          .catch(async (err: any) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
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
