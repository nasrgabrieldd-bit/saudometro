// Edge Function: dispara notificação push pro parceiro sempre que algo relevante muda —
// humor, convite (enviado E respondido), encontro do calendário, pergunta da semana,
// desafio do dia, resgate na lojinha, resgate de desejo secreto ou cápsula do tempo.
// Chamada por Database Webhooks (INSERT e, pra convites, também UPDATE).
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails("mailto:gabriel.nasr@gutierrefilmes.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const ROLE_LABEL: Record<string, string> = { gabriel: "Gabriel", tata: "Tata" };
const otherRole = (role: string) => (role === "gabriel" ? "tata" : "gabriel");

type Msg = { targetRole: string; title: string; body: string; path: string } | null;

function messageFor(table: string, type: string, record: any, oldRecord: any): Msg {
  if (table === "moods" && type === "INSERT") {
    return {
      targetRole: otherRole(record.role),
      title: "Humor atualizado 💗",
      body: `${ROLE_LABEL[record.role] || record.role} registrou o humor de hoje.`,
      path: "?tab=mood",
    };
  }

  if (table === "encounters") {
    if (type === "INSERT" && record.kind === "convite" && record.status === "pendente") {
      return {
        targetRole: otherRole(record.created_by),
        title: "Novo convite 💌",
        body: `${ROLE_LABEL[record.created_by]} te convidou: ${record.title || "um encontro"}`,
        path: "?tab=notes&view=invites",
      };
    }
    if (type === "INSERT" && record.kind === "planejado") {
      return {
        targetRole: otherRole(record.created_by),
        title: "Calendário atualizado 📅",
        body: `${ROLE_LABEL[record.created_by]} definiu um encontro do mês.`,
        path: "?tab=calendar",
      };
    }
    if (type === "INSERT" && record.kind === "saudade") {
      return {
        targetRole: otherRole(record.created_by),
        title: "Calendário atualizado 🫂",
        body: `${ROLE_LABEL[record.created_by]} marcou um encontro de saudade.`,
        path: "?tab=calendar",
      };
    }
    // convite respondido — avisa quem mandou o convite, não quem respondeu
    if (type === "UPDATE" && record.kind === "convite" && oldRecord?.status === "pendente" && record.status === "confirmado") {
      return {
        targetRole: record.created_by,
        title: "Convite aceito 🎉",
        body: `${ROLE_LABEL[otherRole(record.created_by)]} aceitou seu convite: ${record.title || "o encontro"}!`,
        path: "?tab=notes&view=invites",
      };
    }
    if (type === "UPDATE" && record.kind === "convite" && oldRecord?.status === "pendente" && record.status === "recusado") {
      return {
        targetRole: record.created_by,
        title: "Convite recusado 😔",
        body: `${ROLE_LABEL[otherRole(record.created_by)]} não pôde topar o convite dessa vez.`,
        path: "?tab=notes&view=invites",
      };
    }
    return null;
  }

  if (table === "weekly_answers" && type === "INSERT") {
    return {
      targetRole: otherRole(record.role),
      title: "Pergunta da semana 💭",
      body: `${ROLE_LABEL[record.role]} respondeu a pergunta da semana!`,
      path: "?tab=mood",
    };
  }

  if (table === "daily_challenge_answers" && type === "INSERT") {
    return {
      targetRole: otherRole(record.role),
      title: "Desafio do dia 🎯",
      body: `${ROLE_LABEL[record.role]} respondeu o desafio de hoje!`,
      path: "?tab=notes&view=challenge",
    };
  }

  if (table === "shop_redemptions") {
    if (type === "INSERT") {
      return {
        targetRole: otherRole(record.role),
        title: "Resgate na lojinha 🎁",
        body: `${ROLE_LABEL[record.role]} resgatou "${record.title}"! Já sabe o que fazer 😉`,
        path: "?tab=shop",
      };
    }
    // marcado como cumprido — avisa quem resgatou (pediu), não quem cumpriu
    if (type === "UPDATE" && oldRecord?.status === "pendente" && record.status === "cumprido") {
      return {
        targetRole: record.role,
        title: "Resgate cumprido ✅",
        body: `${ROLE_LABEL[otherRole(record.role)]} confirmou: "${record.title}" foi cumprido!`,
        path: "?tab=shop",
      };
    }
    // desfeito por engano — avisa quem tem que cumprir que ainda falta fazer
    if (type === "UPDATE" && oldRecord?.status === "cumprido" && record.status === "pendente") {
      return {
        targetRole: otherRole(record.role),
        title: "Ainda falta cumprir ↩️",
        body: `Foi desfeito: "${record.title}" ainda não foi cumprido de verdade.`,
        path: "?tab=shop",
      };
    }
    return null;
  }

  // resgate de desejo secreto: avisa o DONO do desejo, sem contar qual foi (é às cegas)
  if (table === "wish_redemptions" && type === "INSERT") {
    return {
      targetRole: record.wish_owner,
      title: "Desejo secreto resgatado 🎁",
      body: `${ROLE_LABEL[record.redeemed_by]} resgatou um dos seus desejos secretos às cegas — só revela amanhã!`,
      path: "?tab=notes&view=wishes",
    };
  }

  if (table === "time_capsules" && type === "INSERT") {
    return {
      targetRole: otherRole(record.from_role),
      title: "Cápsula do tempo 🕰️",
      body: `${ROLE_LABEL[record.from_role]} selou uma cápsula do tempo pra você! Abre em ${record.open_on}.`,
      path: "?tab=notes&view=capsule",
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
    const oldRecord = payload.old_record;
    if (!record) return new Response("no record", { status: 200 });

    const msg = messageFor(table, type, record, oldRecord);
    if (!msg) return new Response("nothing to notify", { status: 200 });

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("couple_id", record.couple_id)
      .eq("role", msg.targetRole);
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
