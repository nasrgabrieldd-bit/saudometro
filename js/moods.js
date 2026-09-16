export const MOODS = [
  { id: "apaixonada", emoji: "🥰", label: "Apaixonada(o)", tint: "pink" },
  { id: "feliz", emoji: "😊", label: "Feliz", tint: "amber" },
  { id: "animada", emoji: "🎉", label: "Animada(o)", tint: "coral" },
  { id: "tranquila", emoji: "😌", label: "Tranquila(o)", tint: "sage" },
  { id: "saudade", emoji: "🥺", label: "Com saudade", tint: "plum" },
  { id: "cansada", emoji: "🥱", label: "Cansada(o)", tint: "mauve" },
  { id: "estressada", emoji: "😤", label: "Estressada(o)", tint: "rust" },
  { id: "mal", emoji: "🤒", label: "Meio mal", tint: "slate" },
];

export const MOOD_BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]));

export const TALK_OPTIONS = [
  { id: "sim", emoji: "💬", label: "Quero conversar" },
  { id: "talvez", emoji: "🤏", label: "Só rapidinho" },
  { id: "nao", emoji: "🤫", label: "Só carinho à distância hoje" },
];

export const TALK_BY_ID = Object.fromEntries(TALK_OPTIONS.map((t) => [t.id, t]));
