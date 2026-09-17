export const PERKS = [
  {
    id: "cafe_na_cama",
    emoji: "🍳",
    title: "Café da manhã na cama",
    desc: "O outro prepara um café da manhã especial pra você, sem pedir duas vezes.",
    cost: 18,
  },
  {
    id: "tarefa_livre",
    emoji: "🧹",
    title: "Livre de uma tarefa chata",
    desc: "Escolhe uma tarefa de casa que você odeia — o outro assume ela por um dia.",
    cost: 20,
  },
  {
    id: "surpresa",
    emoji: "🎁",
    title: "Direito a uma surpresa",
    desc: "Ela te deve uma surpresa — ela escolhe o que, você só resgata o direito de receber.",
    cost: 25,
  },
  {
    id: "fala_sincera",
    emoji: "🗣️",
    title: "Falar sem filtro",
    desc: "Você pode falar algo que não gostou, e ela promete ouvir sem drama.",
    cost: 20,
  },
  {
    id: "passeio_surpresa",
    emoji: "🎡",
    title: "Passeio surpresa que você planeja",
    desc: "O contrário do de cima: aqui você prepara um passeio surpresa e o outro só aparece.",
    cost: 35,
  },
  {
    id: "sem_recusa",
    emoji: "🎟️",
    title: "Encontro sem recusa",
    desc: "O próximo convite que você mandar, ela não pode recusar.",
    cost: 40,
  },
];

export const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));
