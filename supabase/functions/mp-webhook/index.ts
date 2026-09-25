// Edge Function: recebe a notificação do Mercado Pago quando uma assinatura muda de status
// (paga, cancelada, etc.) e atualiza o plano de casal/pessoa correspondente. É o Mercado Pago
// batendo direto nesta URL (configurada no painel deles) — não é Database Webhook do Supabase.
//
// Nunca confia no status que vem no corpo da notificação: sempre busca o estado atual direto
// na API deles com o id recebido, que é a prática recomendada. Como só troca `plan_source`
// pra "mercado_pago" quando o pagamento é confirmado, casais/pessoas "legado" (que nunca
// passam por checkout) não são afetados.
//
// Hardening possível pra depois (fora do escopo desta rodada): validar a assinatura
// x-signature que o Mercado Pago manda, pra descartar chamadas forjadas antes até de gastar
// uma consulta na API deles.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN")!;

const PLAN_TIERS = ["entrada", "acessivel", "premium"];
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    let body: any = {};
    try { body = await req.json(); } catch (_e) { /* alguns eventos vêm só via query string, sem corpo */ }

    const type = url.searchParams.get("type") || body.type;
    const dataId = url.searchParams.get("data.id") || body.data?.id || body.id;
    if (!dataId) return new Response("nada pra processar", { status: 200 });
    if (type !== "preapproval" && type !== "subscription_preapproval") {
      return new Response("ignorado (não é notificação de assinatura)", { status: 200 });
    }

    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${dataId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (!mpRes.ok) {
      console.error("falha ao consultar preapproval no mercado pago", dataId, await mpRes.text());
      return new Response("erro ao consultar", { status: 502 });
    }
    const preapproval = await mpRes.json();

    const ref: string = preapproval.external_reference || "";
    const [kind, id, tier] = ref.split(":");
    if ((kind !== "couple" && kind !== "user") || !id || !PLAN_TIERS.includes(tier)) {
      console.error("external_reference inesperado", ref);
      return new Response("referência desconhecida", { status: 200 });
    }

    const active = preapproval.status === "authorized";
    // 35 dias de folga sobre o ciclo mensal, pra cobrir atraso de renovação sem cortar acesso na hora
    const expiresAt = active ? new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString() : null;
    const plan = active ? tier : "gratis";

    if (kind === "couple") {
      const { error } = await supabase.from("couples").update({ plan, plan_expires_at: expiresAt, plan_source: "mercado_pago" }).eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("user_plans").upsert(
        { user_id: id, plan, plan_expires_at: expiresAt, plan_source: "mercado_pago", updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (error) throw error;
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500 });
  }
});
