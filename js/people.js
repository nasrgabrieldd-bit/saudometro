// nomes, gênero e emoji de cada pessoa do casal. "gabriel" e "tata" são só os dois lugares
// (slots) internos: o que aparece na tela vem da configuração do casal.
// Casal sem configuração salva usa o padrão antigo (Gabriel/Tata), então nada muda pra ele.

const LEGACY = {
  names: { gabriel: "Gabriel", tata: "Tata" },
  genders: { gabriel: "homem", tata: "mulher" },
  emojis: { gabriel: "🦁", tata: "🦋" },
};

let settings = null;

export function setPeopleSettings(s) { settings = s || null; }
export function getPeopleSettings() { return settings; }

// tira caracteres que quebrariam HTML: o nome é usado em textos, atributos e alertas
export function cleanName(s) {
  return String(s ?? "").replace(/[<>&"'`\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

export function nameOf(role) {
  return cleanName(settings?.names?.[role]) || LEGACY.names[role] || String(role);
}

export function genderOf(role) {
  const g = settings?.genders?.[role];
  return g === "mulher" || g === "homem" ? g : LEGACY.genders[role] || "mulher";
}

export function emojiOf(role) {
  const e = String(settings?.emojis?.[role] || "");
  return e && e.length <= 8 && !/[<>&"']/.test(e) ? e : LEGACY.emojis[role] || "💗";
}

export function legacyPeople() {
  return { names: { ...LEGACY.names }, genders: { ...LEGACY.genders }, emojis: { ...LEGACY.emojis } };
}

// emojis padrão de um casal novo: por gênero, e sempre diferentes entre os dois
export function defaultEmojis(g1, g2) {
  const pool = { mulher: ["🦋", "🌸", "🐰"], homem: ["🦁", "🐻", "🐺"] };
  const e1 = pool[g1][0];
  const e2 = pool[g2].find((e) => e !== e1) || "💗";
  return [e1, e2];
}

// concorda o texto com o gênero: "cansada(o)" -> cansada/cansado, "ele(a)" -> ela/ele, "bobo(a)" -> boba/bobo
export function gen(text, gender) {
  const fem = gender === "mulher";
  return String(text)
    .replace(/(\w*)a\(o\)/g, (_, p) => p + (fem ? "a" : "o"))
    .replace(/(\w*)o\(a\)/g, (_, p) => p + (fem ? "a" : "o"))
    .replace(/(\w*)a\(e\)/g, (_, p) => p + (fem ? "a" : "e"))
    .replace(/(\w*)e\(a\)/g, (_, p) => p + (fem ? "a" : "e"));
}

// texto com dois "personagens": ele(a)/ela(e) falam do parceiro; cansada(o)/bobo(a) falam de quem lê
export function genMixed(text, ownGender, partnerGender) {
  const own = ownGender === "mulher", par = partnerGender === "mulher";
  return String(text)
    .replace(/(\w*)a\(o\)/g, (_, p) => p + (own ? "a" : "o"))
    .replace(/(\w*)o\(a\)/g, (_, p) => p + (own ? "a" : "o"))
    .replace(/(\w*)a\(e\)/g, (_, p) => p + (par ? "a" : "e"))
    .replace(/(\w*)e\(a\)/g, (_, p) => p + (par ? "a" : "e"));
}

// recursos que o casal pode ligar/desligar. Sem configuração salva, tudo fica ligado (como sempre foi).
export function feat(key) {
  return settings?.features?.[key] !== false;
}

export function goalTarget() {
  const n = settings?.features?.goal_target;
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : 2;
}
