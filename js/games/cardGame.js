// Motor puro do jogo de Cartas (estilo baralho de descarte por cor, inspirado em Uno mas sem
// copiar nome/logo/verso da Mattel): não sabe nada sobre Supabase, sala, casal ou turma. Serve
// pra duas coisas só: (1) prever localmente quais cartas da mão são jogáveis (destaque visual),
// (2) ser testável isoladamente. A regra "de verdade" (quem ganhou, quem compra, etc.) mora nas
// RPCs do Postgres — esse arquivo NUNCA é a fonte da verdade do resultado de uma partida real.

export const COLORS = ["vermelho", "amarelo", "verde", "azul"];

// baralho completo: 0-9 em 4 cores (um 0 + dois de cada 1-9), bloqueio/inversão/+2 (2 de cada
// cor) e curinga/curinga+4 (4 de cada) — mesma distribuição de um baralho clássico desse tipo de
// jogo, 108 cartas ao todo.
export function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push({ color, value: 0, kind: "number" });
    for (let value = 1; value <= 9; value++) {
      deck.push({ color, value, kind: "number" });
      deck.push({ color, value, kind: "number" });
    }
    for (const kind of ["skip", "reverse", "draw2"]) {
      deck.push({ color, kind });
      deck.push({ color, kind });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ kind: "wild" });
    deck.push({ kind: "wild4" });
  }
  return deck;
}

// Fisher-Yates com rng injetável (pra teste determinístico) — não usado pra embaralhar de
// verdade no servidor (isso é feito direto em SQL), só pra previsão/teste locais.
export function shuffle(deck, rng = Math.random) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// distribui handSize cartas por jogador e vira a primeira carta do descarte — simplificação
// deliberada: a primeira carta virada nunca é curinga/curinga+4 nem carta de ação (bloqueio,
// inversão, +2), só número, pra não precisar resolver "quem escolhe a cor"/"quem leva o efeito"
// logo na largada. Cartas de ação/curinga que saem na virada voltam pro fundo do monte.
export function dealHands(deck, playerCount, handSize = 7) {
  const pile = deck.slice();
  const hands = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < handSize; i++) {
    for (let p = 0; p < playerCount; p++) hands[p].push(pile.shift());
  }
  let discardTop = null;
  const skipped = [];
  while (pile.length) {
    const card = pile.shift();
    if (card.kind === "number") { discardTop = card; break; }
    skipped.push(card);
  }
  const drawPile = [...pile, ...skipped];
  return { hands, drawPile, discardTop, activeColor: discardTop?.color ?? null };
}

// pode jogar se bater a cor ativa, o valor (cartas número), o "símbolo" (mesmo kind de carta de
// ação, cor diferente) ou se for curinga. Curinga+4: regra oficial do Uno — só pode ser jogado
// se a pessoa NÃO tiver nenhuma carta da cor ativa na mão (por isso recebe a mão inteira, não
// só a carta sendo avaliada).
export function canPlay(card, topCard, activeColor, hand = []) {
  if (card.kind === "wild") return true;
  if (card.kind === "wild4") return !hand.some((c) => c.color === activeColor);
  if (card.color === activeColor) return true;
  if (card.kind === "number" && topCard?.kind === "number" && card.value === topCard.value) return true;
  if (card.kind !== "number" && card.kind === topCard?.kind) return true;
  return false;
}

export function nextSeatIndex(playerCount, fromIndex, direction, steps = 1) {
  return ((fromIndex + direction * steps) % playerCount + playerCount) % playerCount;
}

// reducer puro: dado o estado de turno (sem as mãos) e a carta jogada, devolve o próximo estado
// de turno/direção/cor — não mexe em mão de ninguém, é só pra prever pra onde a vez vai e quem
// vai precisar comprar. chosenColor é obrigatório pra curinga/curinga+4.
export function applyCard(state, card, chosenColor) {
  const { direction, currentIndex, playerCount } = state;
  if (card.kind === "skip") {
    return { direction, currentIndex: nextSeatIndex(playerCount, currentIndex, direction, 2), activeColor: card.color, drawEffect: null };
  }
  if (card.kind === "reverse") {
    // com só 2 jogadores não tem "pra quem inverter": a vez simplesmente volta pro mesmo
    // jogador que jogou (age como bloqueio), sem mudar a direção guardada
    if (playerCount === 2) {
      return { direction, currentIndex: nextSeatIndex(playerCount, currentIndex, direction, 2), activeColor: card.color, drawEffect: null };
    }
    const newDirection = -direction;
    return { direction: newDirection, currentIndex: nextSeatIndex(playerCount, currentIndex, newDirection, 1), activeColor: card.color, drawEffect: null };
  }
  if (card.kind === "draw2") {
    const targetSeat = nextSeatIndex(playerCount, currentIndex, direction, 1);
    return { direction, currentIndex: nextSeatIndex(playerCount, currentIndex, direction, 2), activeColor: card.color, drawEffect: { seat: targetSeat, amount: 2 } };
  }
  if (card.kind === "wild4") {
    const targetSeat = nextSeatIndex(playerCount, currentIndex, direction, 1);
    return { direction, currentIndex: nextSeatIndex(playerCount, currentIndex, direction, 2), activeColor: chosenColor, drawEffect: { seat: targetSeat, amount: 4 } };
  }
  if (card.kind === "wild") {
    return { direction, currentIndex: nextSeatIndex(playerCount, currentIndex, direction, 1), activeColor: chosenColor, drawEffect: null };
  }
  return { direction, currentIndex: nextSeatIndex(playerCount, currentIndex, direction, 1), activeColor: card.color, drawEffect: null };
}

export function checkWinner(hand) {
  return hand.length === 0;
}
