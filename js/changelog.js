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
    text: "Agora dá pra usar o Saudômetro com a turma também, não só o casal. Toque em \"Usar com amigos\" na entrada, ou troque de conta pelo Perfil a qualquer momento, sem precisar logar de novo.",
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
  {
    id: "foto-de-perfil",
    tag: "geral",
    emoji: "👤",
    title: "Foto de perfil",
    text: "Toque no seu avatar (o círculo com a inicial, no topo da tela) pra trocar sua foto de perfil. Funciona no casal e em cada turma de amigos, e a foto fica igual em todo canto.",
  },
  {
    id: "amigos-feed-convites",
    tag: "amigos",
    emoji: "📷",
    title: "Feed de fotos e rolê marcado pra você",
    text: "Experiências agora tem um feed de fotos da turma, privado, só pra vocês. Marque uma foto de fofoca pra ela ficar destacada, comente em thread e dê like. Nos Rolês, dá pra chamar só algumas pessoas pra um encontro, e quem for chamado recebe um aviso ao abrir a aba.",
  },
  {
    id: "jogo-capivarinhas-casal",
    tag: "casal",
    emoji: "🦫",
    image: "icons/capivarinhas.jpg",
    title: "Capibatman chegou pra vocês dois",
    text: "Um quebra-cabeça fofo de achar capivara escondida, na Lojinha. Cada fase que vocês passam já cai moeda na carteira do casal, e vai ficando mais gostoso de difícil conforme avança. Bora descobrir onde elas estão?",
  },
  {
    id: "jogo-capivarinhas-amigos",
    tag: "amigos",
    emoji: "🦫",
    image: "icons/capivarinhas.jpg",
    title: "Capibatman chegou pra turma",
    text: "Um quebra-cabeça de achar capivara escondida, agora nos Prêmios da turma. Cada fase que a turma passa cai moeda no cofre, e a dificuldade sobe aos poucos. Quem topa ser o primeiro a jogar?",
  },
  {
    id: "perfil-lojinha-atalhos-2026-09",
    tag: "geral",
    emoji: "🗂️",
    title: "Perfil e Lojinha mais organizados",
    text: "As duas telas viraram um hub com atalhos, igual Recados já era: menos rolagem, mais fácil de achar as coisas. E agora, se você já faz parte de uma turma, tem um botão direto pra ela no topo do Perfil.",
  },
  {
    id: "humores-e-reacoes-2026-09",
    tag: "geral",
    emoji: "🥰",
    title: "Mais humores e mais reações",
    text: "Um monte de humor novo (De zoeira, Queria colo, Melosa(o), e mais) e mais emojis pra reagir. E o \"como você está com seu par\" agora tem uma lista própria, mais a ver com o sentimento de vocês dois.",
  },
  {
    id: "convite-vira-encontro-2026-09",
    tag: "casal",
    emoji: "🎉",
    title: "Convite aceito agora é encontro de verdade",
    text: "Quando um convite é aceito, ele conta na meta de encontros do mês (antes só \"encontro combinado\" contava). E os dois recebem um aviso comemorando quando abrirem o app. O card da meta, na Home, ganhou setinhas pra navegar entre os meses.",
  },
  {
    id: "faixa-humor-semana-2026-09",
    tag: "geral",
    emoji: "📅",
    title: "Humor da semana na tela inicial",
    text: "Uma faixa nova na Home mostra o humor dos últimos 7 dias, com um visual bem mais colorido. Casal vê dos dois, turma vê de todo mundo. A aba Humor continua com o visual de sempre.",
  },
  {
    id: "fazer-juntos-casal-2026-09",
    tag: "casal",
    emoji: "🎯",
    title: "Fazer juntos: chegou no lugar do Sinal de Saudade",
    text: "Agora, em Recados, dá pra guardar ideias de coisas pra fazer juntos (com link e foto) e avaliar com estrelas — o ranking se forma sozinho pela média de vocês dois. Um aviso aparece quando tem ideia nova esperando sua nota.",
  },
  {
    id: "fazer-juntos-amigos-2026-09",
    tag: "amigos",
    emoji: "🎯",
    title: "Fazer juntos, agora na turma também",
    text: "Na Home da turma tem uma seção nova pra guardar ideias de rolê (com link e foto) e avaliar com estrelas — o ranking é pela média de todo mundo que votou.",
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
