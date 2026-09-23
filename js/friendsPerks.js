// prêmios do Modo Amigos: itens fixos, trocados pelo cofre de moedas do grupo (não é por
// pessoa como no casal) — pensados pra turma, não reaproveita os itens românticos do casal.
export const FRIEND_PERKS = [
  { id: "escolhe_jogo", emoji: "🎮", title: "Escolhe o jogo da vez", sub: "Ninguém reclama, é lei.", cost: 8 },
  { id: "imunidade_zoeira", emoji: "🃏", title: "Imunidade de zoeira (1x)", sub: "Ninguém tira sarro de você por um dia.", cost: 12 },
  { id: "vale_carona", emoji: "🚗", title: "Vale carona", sub: "Alguém da turma te busca no próximo rolê.", cost: 15 },
];

export const FRIEND_PERK_BY_ID = Object.fromEntries(FRIEND_PERKS.map((p) => [p.id, p]));
