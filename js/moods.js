export const MOODS = [
  { id: "apaixonada", emoji: "🥰", label: "Apaixonada(o)" },
  { id: "feliz", emoji: "😊", label: "Feliz" },
  { id: "animada", emoji: "🎉", label: "Animada(o)" },
  { id: "tranquila", emoji: "😌", label: "Tranquila(o)" },
  { id: "saudade", emoji: "🥺", label: "Com saudade" },
  { id: "cansada", emoji: "🥱", label: "Cansada(o)" },
  { id: "estressada", emoji: "😤", label: "Estressada(o)" },
  { id: "mal", emoji: "🤒", label: "Meio mal" },
  { id: "grata", emoji: "🙏", label: "Grata(o)" },
  { id: "carinhosa", emoji: "🤗", label: "Com vontade de abraço" },
  { id: "brava", emoji: "😠", label: "Brava(o)" },
  { id: "triste", emoji: "😢", label: "Triste" },
  { id: "ansiosa", emoji: "😰", label: "Ansiosa(o)" },
  { id: "confusa", emoji: "😕", label: "Confusa(o)" },
  { id: "envergonhada", emoji: "😳", label: "Envergonhada(o)" },
  { id: "entediada", emoji: "😑", label: "Entediada(o)" },
  { id: "inspirada", emoji: "✨", label: "Inspirada(o)" },
  { id: "ciumenta", emoji: "😒", label: "Com ciúmes" },
  { id: "confiante", emoji: "😎", label: "Confiante" },
  { id: "assustada", emoji: "😨", label: "Assustada(o)" },
  { id: "pensativa", emoji: "🤔", label: "Pensativa(o)" },
  { id: "safadinha", emoji: "😏", label: "Safadinha(o)" },
  { id: "zoeira", emoji: "🤡", label: "De zoeira" },
  { id: "fominha", emoji: "🍕", label: "Com fominha" },
  { id: "cafeina", emoji: "☕", label: "Precisando de café" },
  { id: "gelada", emoji: "🥶", label: "Com frio" },
  { id: "risada", emoji: "😂", label: "Rindo à toa" },
  { id: "de_boa", emoji: "🤙", label: "De boa" },
  { id: "curiosa", emoji: "🧐", label: "Curiosa(o)" },
  { id: "orgulhosa", emoji: "🥲", label: "Orgulhosa(o)" },
  { id: "grogue", emoji: "🥴", label: "Grogue" },
  { id: "determinada", emoji: "💪", label: "Determinada(o)" },
  { id: "nostalgica", emoji: "🕰️", label: "Com nostalgia" },
  { id: "fofuxa", emoji: "🐶", label: "Fofa(o) que só" },
  { id: "melosa", emoji: "🍯", label: "Melosa(o)" },
  { id: "modo_trabalho", emoji: "💻", label: "No modo trabalho" },
  { id: "procrastinando", emoji: "🦥", label: "Procrastinando" },
  { id: "modo_detetive", emoji: "🕵️", label: "Em modo detetive" },
  { id: "convencida", emoji: "💅", label: "Se achando" },
  { id: "sortuda", emoji: "🍀", label: "Com sorte hoje" },
  { id: "dramatica", emoji: "🎭", label: "Dramática(o) hoje" },
  { id: "modo_cientista", emoji: "🧪", label: "No modo cientista maluco" },
  { id: "cheirinho", emoji: "🧴", label: "Quero cheirinho" },
];

export const MOOD_BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]));

// "como você está com [parceiro] hoje?" usa uma lista própria — os humores mais gerais/engraçados
// (comida, trabalho etc.) fazem sentido pro seu dia, mas não pra descrever o sentimento com o par.
// Os 22 humores originais continuam valendo aqui também (instrução: não mexer nos que já tinha).
const GENERAL_ONLY_MOOD_IDS = new Set([
  "zoeira", "fominha", "cafeina", "gelada", "risada",
  "curiosa", "orgulhosa", "grogue", "determinada", "nostalgica", "modo_trabalho",
  "procrastinando", "modo_detetive", "convencida", "sortuda", "dramatica", "modo_cientista",
]);
export const PARTNER_MOODS = [
  ...MOODS.filter((m) => !GENERAL_ONLY_MOOD_IDS.has(m.id)),
  { id: "queria_colo", emoji: "🫂", label: "Queria colo" },
  { id: "quietinha", emoji: "😶", label: "Quietinha(o) hoje" },
  { id: "grudenta", emoji: "🧸", label: "Grudenta(o) hoje" },
  { id: "derretida", emoji: "🫠", label: "Derretida(o) por você" },
  { id: "apaixonada_de_novo", emoji: "💘", label: "Apaixonada(o) de novo" },
];
export const PARTNER_MOOD_BY_ID = Object.fromEntries(PARTNER_MOODS.map((m) => [m.id, m]));

export const TALK_OPTIONS = [
  // os ids (sim/talvez/nao) ficam como estão pra não perder o que já foi registrado; só os nomes mudaram
  { id: "sim", emoji: "💬", label: "Falante" },
  { id: "talvez", emoji: "🤏", label: "Pouquinho" },
  { id: "nao", emoji: "🤫", label: "Modo avião" },
];

export const TALK_BY_ID = Object.fromEntries(TALK_OPTIONS.map((t) => [t.id, t]));

// Visual novo: duas listas bem diferentes pra escolher. As emoções "de casal" saem do humor geral e ficam só
// na lista "com o par". Os ids antigos continuam existindo em MOOD_BY_ID/PARTNER_MOOD_BY_ID, então o que já foi
// registrado continua aparecendo certo.
const COUPLE_MOOD_IDS = new Set(["apaixonada", "saudade", "carinhosa", "ciumenta", "safadinha", "fofuxa", "melosa", "cheirinho", "grata"]);
const GENERAL_FIRST = ["feliz", "animada", "tranquila", "cansada", "estressada", "ansiosa", "triste", "confiante", "inspirada", "pensativa", "mal", "de_boa"];
const generalRest = MOODS.filter((m) => !COUPLE_MOOD_IDS.has(m.id) && !GENERAL_FIRST.includes(m.id));
export const GENERAL_MOODS = [...GENERAL_FIRST.map((id) => MOOD_BY_ID[id]).filter(Boolean), ...generalRest];
// primeiro as fofas de casal; depois as do dia a dia (tranquila, feliz, brava, triste...) pra quando o sentimento com o par é comum, não só romântico
const PARTNER_FIRST = [
  "apaixonada", "carinhosa", "grudenta", "derretida", "saudade", "queria_colo", "cheirinho", "quietinha", "apaixonada_de_novo", "safadinha", "grata", "melosa", "fofuxa",
  "tranquila", "feliz", "de_boa", "animada", "confiante", "inspirada", "entediada", "pensativa", "confusa", "envergonhada",
  "brava", "triste", "ciumenta", "ansiosa", "estressada",
];
export const PARTNER_PICKER = PARTNER_FIRST.map((id) => PARTNER_MOOD_BY_ID[id]).filter(Boolean);
