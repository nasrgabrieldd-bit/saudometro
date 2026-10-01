// Motor puro do Stop/Adedonha: não sabe nada sobre Supabase, sala, casal ou turma. A pontuação
// aqui é só matemática de apresentação em cima de respostas que já passaram pela RPC (só aceita
// durante a fase de resposta da rodada certa) — não tem o que trapacear, só o que exibir, por
// isso pode ser client-side (diferente da jogada de Cartas, que muda estado compartilhado).

// pool completo de categorias clássicas: cada partida sorteia 6 delas (server-side, em
// start_stop_match) e guarda em stop_matches.categories — fica fixo a partida toda, só a letra
// muda a cada rodada. CATEGORIES continua existindo como alias do pool completo (usado nos
// testes e em qualquer lugar que precise só da lista, sem depender de uma partida real).
// freeform:true = não precisa começar com a letra sorteada (ex: CEP, que é só número) — ainda
// pontua por unicidade igual as outras, só não valida o começo
export const ALL_CATEGORIES = [
  { key: "nome", label: "Nome" },
  { key: "animal", label: "Animal" },
  { key: "comida", label: "Comida" },
  { key: "cep", label: "CEP", freeform: true },
  { key: "objeto", label: "Objeto" },
  { key: "filme_serie", label: "Filme/Série" },
  { key: "cor", label: "Cor" },
  { key: "pais", label: "País" },
  { key: "profissao", label: "Profissão" },
  { key: "marca", label: "Marca" },
  { key: "fruta", label: "Fruta" },
  { key: "apelido_vinculo", label: "Apelido pro namorado(a)" }, // rótulo troca pra "Apelido pra sogra" em turma — ver relationalCategoryLabel
];
export const CATEGORIES = ALL_CATEGORIES;
export const CATEGORY_LABEL = Object.fromEntries(ALL_CATEGORIES.map((c) => [c.key, c.label]));
const FREEFORM_KEYS = new Set(ALL_CATEGORIES.filter((c) => c.freeform).map((c) => c.key));
export function isFreeformCategory(key) {
  return FREEFORM_KEYS.has(key);
}

// "apelido_vinculo" muda de alvo conforme o modo: no casal pergunta sobre o namorado(a), na
// turma vira uma piadinha sobre a sogra — mesma categoria (mesma chave, mesma pontuação),
// só o texto mostrado muda
export function relationalCategoryLabel(room) {
  return room?.couple_id ? "Apelido pro namorado(a)" : "Apelido pra sogra";
}

// rodada picante: só modo casal, opt-in, sempre a última rodada da partida quando ligada —
// pool fixo (não sorteado), tom picante-leve/flertante, não explícito
export const CATEGORIES_SPICY = [
  { key: "lugar_beijo", label: "Lugar pra dar um beijo" },
  { key: "elogio_picante", label: "Elogio picante" },
  { key: "apelido_safado", label: "Apelido safadinho" },
  { key: "fantasia_leve", label: "Fantasia leve" },
  { key: "peca_intima", label: "Peça íntima" },
  { key: "programa_noite", label: "Programa pra noite" },
];
Object.assign(CATEGORY_LABEL, Object.fromEntries(CATEGORIES_SPICY.map((c) => [c.key, c.label])));

// sorteia 6 categorias do pool completo — usado no cliente só por conveniência/testes;
// a escolha que vale de verdade é feita no banco (start_stop_match), com a mesma regra
export function pickMatchCategories(pool = ALL_CATEGORIES, count = 6) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// decide quais categorias valem pra rodada atual de uma partida: picante só na última rodada,
// só se a sala ligou o modo picante e é uma sala de casal (nunca turma)
export function categoriesForRound(match, room) {
  const isSpicyRound = !!room?.settings?.spicy && !!room?.couple_id && match.round_number === match.total_rounds;
  if (isSpicyRound) return CATEGORIES_SPICY;
  const keys = match.categories && match.categories.length ? match.categories : ALL_CATEGORIES.map((c) => c.key);
  return keys.map((key) => ({
    key,
    label: key === "apelido_vinculo" ? relationalCategoryLabel(room) : (CATEGORY_LABEL[key] || key),
    freeform: isFreeformCategory(key),
  }));
}

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

// freeform=true pula a checagem de "começa com a letra" (ex: CEP) — ainda exige não-vazio
export function isValidAnswer(answer, letter, freeform = false) {
  const n = normalize(answer);
  if (!n) return false;
  if (freeform) return true;
  return n.startsWith(normalize(letter));
}

// answers: [{ user_id, answer, invalidated? }] de uma categoria numa rodada -> Map<user_id, pontos>
// única resposta válida = 10, resposta válida repetida (2+ pessoas) = 5 cada, inválida/vazia/
// contestada e invalidada pela turma = 0
export function scoreCategory(answers, letter, freeform = false) {
  const points = new Map();
  const validNormalized = new Map(); // user_id -> normalized
  for (const a of answers) {
    if (!a.invalidated && isValidAnswer(a.answer, letter, freeform)) validNormalized.set(a.user_id, normalize(a.answer));
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
  for (const [catKey, categoryAnswers] of Object.entries(answersByCategory)) {
    const catPoints = scoreCategory(categoryAnswers, letter, isFreeformCategory(catKey));
    for (const [userId, pts] of catPoints) total.set(userId, (total.get(userId) || 0) + pts);
  }
  return total;
}
