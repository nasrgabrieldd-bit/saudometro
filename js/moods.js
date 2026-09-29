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
];

export const MOOD_BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]));

export const TALK_OPTIONS = [
  { id: "sim", emoji: "💬", label: "Quero conversar" },
  { id: "talvez", emoji: "🤏", label: "Só rapidinho" },
  { id: "nao", emoji: "🤫", label: "Só carinho à distância hoje" },
];

export const TALK_BY_ID = Object.fromEntries(TALK_OPTIONS.map((t) => [t.id, t]));
