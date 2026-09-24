// Novidades do app: cada vez que a gente lança algo relevante, adiciona uma entrada aqui.
// "casal" só aparece pra quem usa o modo casal, "amigos" só pra quem tá numa turma, "geral"
// aparece pros dois. A pessoa vê um mini-tutorial e reage — isso marca como vista (por
// aparelho, guardado no localStorage, não sincroniza entre os dois celulares do casal).
export const CHANGELOG = [
  {
    id: "amigos-fundacao",
    tag: "geral",
    emoji: "👥",
    title: "Chegou o Modo Amigos",
    text: "Agora dá pra usar o Saudômetro com a turma também, não só o casal. Toque em \"Usar com amigos\" na entrada, ou troque de conta pelo Perfil a qualquer momento — sem precisar logar de novo.",
  },
  {
    id: "amigos-abas",
    tag: "amigos",
    emoji: "📅",
    title: "4 abas novas na sua turma",
    text: "Rolês: calendário da turma, com categoria e confirmação de presença. Humor: veja como todo mundo tá hoje. Experiências: indique filme, série, jogo ou playlist, reaja e comente. Prêmios: cofre de moedas da turma trocável por regalias.",
  },
  {
    id: "amigos-personalizar-gestao",
    tag: "amigos",
    emoji: "🎨",
    title: "Personalize e administre sua turma",
    text: "Em Turma, toque em \"Editar\" pra escolher um emoji e uma cor. Dá pra trocar o código quando quiser, propor remover alguém por votação da turma, ou excluir a turma inteira, se for o caso.",
  },
];

const SEEN_KEY = "changelogSeen";

function getSeenIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
  } catch (e) {
    return new Set();
  }
}

export function markChangelogSeen(id) {
  try {
    const seen = getSeenIds();
    seen.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch (e) { /* sem storage: só vai mostrar de novo */ }
}

// novidades ainda não vistas que fazem sentido pro modo atual ("casal" ou "amigos")
export function unseenChangelogFor(mode) {
  const seen = getSeenIds();
  return CHANGELOG.filter((c) => (c.tag === "geral" || c.tag === mode) && !seen.has(c.id));
}
