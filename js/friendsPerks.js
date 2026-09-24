// prêmios do Modo Amigos: itens fixos, trocados pelo cofre de moedas do grupo (não é por
// pessoa como no casal) — pensados pra turma, não reaproveita os itens românticos do casal.
// Custo sempre fixo e visível: nunca caixa-surpresa/sorteio (ver estudo sobre gamificação ética).
export const FRIEND_PERK_CATEGORIES = {
  role: { emoji: "👥", label: "Regalias de rolê" },
  zoeira: { emoji: "🃏", label: "Regalias de zoeira" },
  pratico: { emoji: "🛠️", label: "Regalias práticas" },
};

export const FRIEND_PERKS = [
  { id: "escolhe_jogo", emoji: "🎮", title: "Escolhe o jogo da vez", sub: "Ninguém reclama, é lei.", cost: 8, category: "role" },
  { id: "escolhe_filme", emoji: "🎬", title: "Escolhe o filme da sessão", sub: "Sem votação, sem empate.", cost: 8, category: "role" },
  { id: "escolhe_local", emoji: "📍", title: "Escolhe o local do próximo rolê", sub: "Todo mundo topa.", cost: 10, category: "role" },
  { id: "imunidade_zoeira", emoji: "🃏", title: "Imunidade de zoeira (1x)", sub: "Ninguém tira sarro de você por um dia.", cost: 12, category: "zoeira" },
  { id: "veta_zoeira", emoji: "🤐", title: "Veta uma zoeira", sub: "Escolhe uma piada que não pode rolar hoje.", cost: 10, category: "zoeira" },
  { id: "coroa_resenha", emoji: "👑", title: "Rei/rainha da resenha (1 semana)", sub: "Título honorário, sem função real.", cost: 15, category: "zoeira" },
  { id: "vale_carona", emoji: "🚗", title: "Vale carona", sub: "Alguém da turma te busca no próximo rolê.", cost: 15, category: "pratico" },
  { id: "paga_rodada", emoji: "💸", title: "Alguém paga sua rodada", sub: "Só uma, não abusa.", cost: 12, category: "pratico" },
  { id: "chega_atrasado", emoji: "⏰", title: "Chega atrasado sem climinha", sub: "Passe livre de até 30 min.", cost: 6, category: "pratico" },
];

export const FRIEND_PERK_BY_ID = Object.fromEntries(FRIEND_PERKS.map((p) => [p.id, p]));
