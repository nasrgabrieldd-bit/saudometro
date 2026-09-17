// um desafio por dia — mais leve e rápido que a pergunta da semana, pra quando bate
// aquele branco na hora de mandar um recado. Roda em ciclo depois de acabar.
export const CHALLENGES = [
  "Qual foi o motivo do seu último sorriso hoje?",
  "Manda um elogio sincero pro seu par, agora.",
  "Descreve o abraço perfeito de vocês dois.",
  "Qual música te lembra ele(a) agora mesmo?",
  "Conta uma lembrança boa de vocês dois.",
  "Qual foi a última vez que você riu igual bobo(a) pensando nele(a)?",
  "O que você tá com vontade de fazer com ele(a) esse fim de semana?",
  "Qual comida você adoraria comer com ele(a) agora?",
  "Descreve ele(a) em 3 palavras.",
  "Qual foi a coisa mais fofa que ele(a) fez essa semana?",
  "Se pudesse mandar um beijo por mensagem, como seria?",
  "Qual é o seu apelido favorito pra ele(a)?",
  "Conta um plano bobo que vocês ainda não realizaram.",
  "O que você mais sente falta quando ele(a) não tá por perto?",
  "Qual foto de vocês dois é a sua favorita, e por quê?",
  "Descreve o cheiro dele(a) com suas palavras.",
  "Qual foi a última vez que ele(a) te surpreendeu?",
  "O que você faria se pudesse ver ele(a) agora mesmo?",
  "Qual é uma qualidade dele(a) que você queria ter?",
  "Conta uma coisa boba que só vocês dois entendem.",
  "Qual filme ou série combina com a relação de vocês?",
  "O que você mais admira nele(a) hoje?",
  "Manda um 'eu te amo' diferente do de sempre.",
  "Qual foi o dia mais engraçado que vocês já tiveram juntos?",
  "Se hoje fosse o primeiro encontro de vocês, o que você diria pra ele(a)?",
  "Qual gesto pequeno dele(a) te derrete todas as vezes?",
  "O que você tá agradecendo por ter ele(a) na sua vida hoje?",
  "Descreve como seria um dia perfeito com ele(a).",
];

export function dayIndexSince(coupleCreatedAt, atDate = new Date()) {
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = atDate.getTime() - new Date(coupleCreatedAt).getTime();
  return Math.max(0, Math.floor(diff / dayMs));
}

export function challengeForDay(dayIndex) {
  return CHALLENGES[dayIndex % CHALLENGES.length];
}
