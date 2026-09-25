// plano pago: casal (compartilhado, um paga vale pros dois) e pessoa (Modo Amigos, cada um
// paga o próprio benefício, vale em toda turma que participa). Fase 1 só guarda o status —
// nenhuma tela ainda chama planAllows() pra travar recurso nenhum; fica pronto pra Fase 2.

export const PLAN_RANK = { gratis: 0, entrada: 1, acessivel: 2, premium: 3 };

export const PLAN_LABEL = { gratis: "Grátis", entrada: "Entrada", acessivel: "Acessível", premium: "Premium" };

// planInfo: { plan, plan_expires_at, plan_source } — vindo de getMyCouplePlan/getMyUserPlan.
// "legado" (casal/pessoa de antes da cobrança existir) sempre libera tudo, não importa o plano.
export function planAllows(planInfo, minTier) {
  if (!planInfo) return false;
  if (planInfo.plan_source === "legado") return true;
  const plan = planInfo.plan || "gratis";
  if (planInfo.plan_expires_at && new Date(planInfo.plan_expires_at) < new Date()) return false;
  return (PLAN_RANK[plan] ?? 0) >= (PLAN_RANK[minTier] ?? 0);
}

export function planLabel(planInfo) {
  if (planInfo?.plan_source === "legado") return "Legado (acesso total)";
  return PLAN_LABEL[planInfo?.plan || "gratis"];
}
