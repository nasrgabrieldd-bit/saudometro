// uma pergunta por semana — a lista roda em ciclo depois de acabar.
// Diferente do desafio do dia (challenges.js): aqui o par é "pergunta de fundo", pensada pra
// uma conversa mais longa, não pra responder na hora — por isso evitamos temas que já aparecem
// lá (cheiro/música/lembrança de rir juntos) e focamos em passado, medos, sonhos e futuro a dois.
export const QUESTIONS = [
  "Qual foi o momento em que você sentiu mais orgulho de mim?",
  "Se pudesse reviver um dia nosso, qual seria e por quê?",
  "Qual é o seu jeito favorito de receber carinho: palavras, toque, tempo junto, presentes ou atos de serviço?",
  "O que você mudaria em mim se pudesse, e o que nunca mudaria?",
  "Qual memória de infância te define até hoje?",
  "O que te dá mais medo em relação ao nosso futuro?",
  "O que você sente que eu não sei sobre você ainda?",
  "Qual é um sonho que você nunca me contou?",
  "Como você prefere ser consolada(o) quando está triste?",
  "Qual é a coisa mais corajosa que você já fez?",
  "O que te faz sentir mais amada(o) por mim?",
  "Se a gente pudesse morar em qualquer lugar do mundo, onde seria?",
  "Qual discussão nossa, olhando pra trás, te ensinou algo?",
  "O que você mais admira na sua própria família?",
  "Qual é o seu maior orgulho pessoal até hoje?",
  "O que te deixa com mais saudade quando estamos longe?",
  "Qual é uma coisa que você queria ter coragem de me pedir?",
  "Como você imagina a gente daqui a 10 anos?",
  "Qual foi a decisão mais difícil que você já tomou por nós dois?",
  "O que você aprendeu sobre amor com seus pais?",
  "Qual foi a primeira vez que você pensou 'eu quero ficar com essa pessoa'?",
  "O que te faz sentir segura(o) numa relação?",
  "Se pudesse mudar uma coisa na forma como a gente resolve brigas, o que seria?",
  "Qual é um objetivo de vida seu que eu poderia te ajudar mais a alcançar?",
];

// mesmo ajuste do desafio do dia (ver challenges.js): conta semanas de calendário a partir
// da meia-noite local do dia de criação, não "7×24h exatas" — senão a pergunta da semana
// também trocaria no meio do dia, na hora exata em que o casal foi criado.
export function weekIndexSince(coupleCreatedAt, atDate = new Date()) {
  const start = new Date(coupleCreatedAt);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const atDay = new Date(atDate.getFullYear(), atDate.getMonth(), atDate.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const daysSince = Math.round((atDay.getTime() - startDay.getTime()) / dayMs);
  return Math.max(0, Math.floor(daysSince / 7));
}

export function questionForWeek(weekIndex) {
  return QUESTIONS[weekIndex % QUESTIONS.length];
}
