// banco de mensagens fofas pra lembrar cada um de cuidar do outro à distância.
// escolhidas por contexto (humor recente, dias sem beijo, semana sem encontro) e sorteadas
// de forma estável pelo dia, pra não ficar mudando toda hora que a home recarrega.

export const MOOD_NUDGES = [
  (p) => `${p} andou numa semana mais estressada. Capricha no carinho hoje 💛`,
  (p) => `${p} registrou o humor meio de baixo ultimamente. Um gesto simples já ajuda bastante.`,
  (p) => `${p} tá mais cansada(o) nos últimos dias. Que tal aliviar o dia dela(e) com algo fofo?`,
  (p) => `${p} não andou tão bem no humor. Ela(e) vai gostar de saber que você tá pensando nela(e).`,
  (p) => `${p} sinalizou saudade recentemente. Um oizinho fofo cai muito bem agora 🫂`,
  (p) => `${p} pode estar precisando de mais atenção hoje. Um carinho extra nunca é demais.`,
];

export const KISS_DAYS_NUDGES = [
  (p, d) => `Já faz ${d} dias que vocês não se beijam. ${p} deve estar contando as horas pra te ver de novo 😘`,
  (p, d) => `${d} dias sem um beijo é osso! Pensa em ${p} com carinho hoje.`,
  (p, d) => `O cronômetro não mente: ${d} dias sem se beijar. Manda um "tô com saudade" pra ${p}.`,
  (p, d) => `Faz ${d} dias desde o último beijo. Um recadinho fofo hoje pode alegrar o dia de ${p}.`,
  (p, d) => `${d} dias sem se ver de perto... ${p} tá guardando um abraço apertado pro próximo encontro.`,
  (p, d) => `Já são ${d} dias sem beijo. Que tal já ir pensando em quando dá pra resolver isso? 😉`,
  (p, d) => `${d} dias e contando. ${p} com certeza tá com saudade do seu abraço.`,
];

export const NO_MEETUP_NUDGES = [
  (p) => `Semana sem encontro marcado... ${p} já deve estar com saudade. Manda um oizinho fofo hoje 🫂`,
  (p) => `Vocês ainda não combinaram nada essa semana. Que tal mandar um recadinho pra ${p} matar a saudade?`,
  (p) => `${p} não vê a hora de te ver. Separa um tempinho pra chamar ela(e) pra alguma coisa essa semana 💗`,
  (p) => `Passou a semana correndo e ainda não rolou encontro? ${p} vai adorar uma surpresa, mesmo que pequena.`,
  (p) => `Semana ainda sem plano juntos. Um "tô com saudade" simples já ilumina o dia de ${p} 🥺`,
  (p) => `Nada marcado essa semana ainda... ${p} entende, mas um carinho à distância nunca é demais.`,
  (p) => `Sem encontro na agenda essa semana. Bora combinar algo, nem que seja rapidinho, pra não ficar só na saudade?`,
];

// hash simples e estável (mesmo dia + mesmo papel + mesma categoria = sempre a mesma mensagem)
function stableIndex(seed, length) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % length;
}

// escolhe UMA mensagem de carinho pro dia, priorizando o sinal mais relevante:
// humor recente do parceiro > dias sem beijo > semana sem encontro marcado.
export function pickSaudadeNudge({ role, todayISO, partnerName, partnerNeedsCare, daysSinceKiss, weekHasSomething }) {
  const seedBase = `${todayISO}:${role}`;
  if (partnerNeedsCare) {
    const i = stableIndex(seedBase + ":mood", MOOD_NUDGES.length);
    return MOOD_NUDGES[i](partnerName);
  }
  if (daysSinceKiss != null && daysSinceKiss >= 7) {
    const i = stableIndex(seedBase + ":kiss", KISS_DAYS_NUDGES.length);
    return KISS_DAYS_NUDGES[i](partnerName, daysSinceKiss);
  }
  if (!weekHasSomething) {
    const i = stableIndex(seedBase + ":week", NO_MEETUP_NUDGES.length);
    return NO_MEETUP_NUDGES[i](partnerName);
  }
  return null;
}
