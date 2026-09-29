// Motor puro do Stop/Adedonha: não sabe nada sobre Supabase, sala, casal ou turma. A pontuação
// aqui é só matemática de apresentação em cima de respostas que já passaram pela RPC (só aceita
// durante a fase de resposta da rodada certa) — não tem o que trapacear, só o que exibir, por
// isso pode ser client-side (diferente da jogada de Cartas, que muda estado compartilhado).

export const CATEGORIES = [
  { key: "nome", label: "Nome" },
  { key: "animal", label: "Animal" },
  { key: "comida", label: "Comida" },
  { key: "cidade", label: "Cidade" },
  { key: "objeto", label: "Objeto" },
  { key: "filme_serie", label: "Filme/Série" },
];

// letras raras em português (K, W, Y) ficam de fora do sorteio
export const STOP_LETTERS = "ABCDEFGHIJLMNOPQRSTUVXZ".split("");

// remove acento, baixa caixa, tira espaço nas pontas — pra comparar/validar sem diferença de
// "Água" vs "agua" vs " Água "
export function normalize(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function isValidAnswer(answer, letter) {
  const n = normalize(answer);
  if (!n) return false;
  return n.startsWith(normalize(letter));
}

// answers: [{ user_id, answer, invalidated? }] de uma categoria numa rodada -> Map<user_id, pontos>
// única resposta válida = 10, resposta válida repetida (2+ pessoas) = 5 cada, inválida/vazia/
// contestada e invalidada pela turma = 0
export function scoreCategory(answers, letter) {
  const points = new Map();
  const validNormalized = new Map(); // user_id -> normalized
  for (const a of answers) {
    if (!a.invalidated && isValidAnswer(a.answer, letter)) validNormalized.set(a.user_id, normalize(a.answer));
    else points.set(a.user_id, 0);
  }
  const countByText = new Map();
  for (const norm of validNormalized.values()) countByText.set(norm, (countByText.get(norm) || 0) + 1);
  for (const [userId, norm] of validNormalized) {
    points.set(userId, countByText.get(norm) > 1 ? 5 : 10);
  }
  return points;
}

// answersByCategory: { categoryKey: [{ user_id, answer }] } -> Map<user_id, pontos totais da rodada>
export function scoreRound(answersByCategory, letter) {
  const total = new Map();
  for (const categoryAnswers of Object.values(answersByCategory)) {
    const catPoints = scoreCategory(categoryAnswers, letter);
    for (const [userId, pts] of catPoints) total.set(userId, (total.get(userId) || 0) + pts);
  }
  return total;
}
