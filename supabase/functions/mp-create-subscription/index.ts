// Edge Function: cria uma assinatura (Preapproval) no Mercado Pago e devolve a URL de
// checkout hospedada por eles. Chamada pelo app via fetch (não é RPC do Postgres), com o
// token de sessão do usuário no header Authorization — é assim que confirmamos quem está
// pedindo sem confiar em nada que o cliente mande solto no corpo.
//
// Aviso: os nomes de campo da API de Preapproval do Mercado Pago abaixo seguem a documentação
// oficial no momento em que isto foi escrito — teste no ambiente de sandbox deles antes de
// confiar em produção, a API pode ter mudado.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN")!;
const APP_URL = Deno.env.get("APP_URL") || "https://nasrgabrieldd-bit.github.io/saudometro/";

const PRICES: Record<string, number> = { entrada: 1.99, acessivel: 4.99, premium: 14.9 };
const PLAN_LABEL: Record<string, string> = { entrada: "Entrada", acessivel: "Acessível", premium: "Premium" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "não autenticado" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // confirma quem está pedindo validando o token dele contra o servidor de auth — nunca
    // confia em nenhum id vindo solto no corpo da requisição
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "sessão inválida" }, 401);
    const user = userData.user;

    const { scope, tier } = await req.json();
    if (!PRICES[tier]) return json({ error: "plano inválido" }, 400);
    if (scope !== "casal" && scope !== "individual") return json({ error: "escopo inválido" }, 400);

    let externalReference: string;
    if (scope === "casal") {
      const { data: profile } = await admin.from("profiles").select("couple_id").eq("id", user.id).maybeSingle();
      if (!profile?.couple_id) return json({ error: "essa conta não tem casal vinculado" }, 400);
      externalReference = `couple:${profile.couple_id}:${tier}`;
    } else {
      externalReference = `user:${user.id}:${tier}`;
    }

    const mpRes = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      body: JSON.stringify({
        reason: `Saudômetro - Plano ${PLAN_LABEL[tier]}`,
        external_reference: externalReference,
        payer_email: user.email,
        back_url: APP_URL,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: PRICES[tier],
          currency_id: "BRL",
        },
      }),
    });
    const mpBody = await mpRes.json();
    if (!mpRes.ok) {
      console.error("mercado pago: falha ao criar preapproval", mpBody);
      return json({ error: "não deu pra criar a assinatura no Mercado Pago" }, 502);
    }

    return json({ init_point: mpBody.init_point });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
