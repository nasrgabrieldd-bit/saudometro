export const PERKS = [
  {
    id: "sem_recusa",
    emoji: "🎟️",
    title: "Encontro sem recusa",
    desc: "O próximo convite que você mandar, ela não pode recusar.",
    cost: 15,
  },
  {
    id: "surpresa",
    emoji: "🎁",
    title: "Direito a uma surpresa",
    desc: "Ela te deve uma surpresa — ela escolhe o que, você só resgata o direito de receber.",
    cost: 10,
  },
  {
    id: "fala_sincera",
    emoji: "🗣️",
    title: "Falar sem filtro",
    desc: "Você pode falar algo que não gostou, e ela promete ouvir sem drama.",
    cost: 8,
  },
];

export const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));
