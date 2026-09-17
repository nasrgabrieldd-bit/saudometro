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
];

export const MOOD_BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]));

export const TALK_OPTIONS = [
  { id: "sim", emoji: "💬", label: "Quero conversar" },
  { id: "talvez", emoji: "🤏", label: "Só rapidinho" },
  { id: "nao", emoji: "🤫", label: "Só carinho à distância hoje" },
];

export const TALK_BY_ID = Object.fromEntries(TALK_OPTIONS.map((t) => [t.id, t]));
