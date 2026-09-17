// uma pergunta por semana — a lista roda em ciclo depois de acabar
export const QUESTIONS = [
  "Qual foi o momento em que você sentiu mais orgulho de mim?",
  "Qual é uma coisa pequena que eu faço que te faz sorrir sem eu perceber?",
  "Se pudesse reviver um dia nosso, qual seria e por quê?",
  "Qual é o seu jeito favorito de receber carinho: palavras, toque, tempo junto, presentes ou atos de serviço?",
  "O que você mudaria em mim se pudesse, e o que nunca mudaria?",
  "Qual memória de infância te define até hoje?",
  "O que te dá mais medo em relação ao nosso futuro?",
  "Qual foi a vez que você mais riu comigo?",
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
  "Qual cheiro, música ou lugar te lembra de mim?",
  "O que você aprendeu sobre amor com seus pais?",
  "Qual foi a primeira vez que você pensou 'eu quero ficar com essa pessoa'?",
  "O que te faz sentir segura(o) numa relação?",
];

export function weekIndexSince(coupleCreatedAt) {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const diff = Date.now() - new Date(coupleCreatedAt).getTime();
  return Math.max(0, Math.floor(diff / weekMs));
}

export function questionForWeek(weekIndex) {
  return QUESTIONS[weekIndex % QUESTIONS.length];
}
