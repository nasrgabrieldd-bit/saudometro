// Temas sazonais (Natal, Ano Novo, Halloween...): uma camada temporária por cima da identidade do app.
// O tema original nunca é alterado: a data só liga/desliga o atributo html[data-season], e é o CSS
// (css/seasons.css) que troca as cores e mostra os enfeites. Fora do período, o atributo some e tudo volta ao normal.
// As datas valem pelo horário de Brasília (America/Sao_Paulo), em qualquer lugar do mundo.
import { easter } from "./promos.js";

const TZ = "America/Sao_Paulo";
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));

// ready: já existe CSS/enfeites pra esse tema. Os outros ficam preparados, mas só entram quando forem desenhados.
export const SEASONS = [
  { id: "natal", name: "Natal", ready: true, range: (y) => [`${y}-11-17`, `${y}-12-26`] },
  { id: "ano_novo", name: "Ano Novo", ready: false, range: (y) => [`${y}-12-27`, `${y + 1}-01-02`] },
  { id: "carnaval", name: "Carnaval", ready: false, range: (y) => { const e = easter(y); return [iso(addDays(e, -51)), iso(addDays(e, -46))]; } },
  { id: "pascoa", name: "Páscoa", ready: false, range: (y) => { const e = easter(y); return [iso(addDays(e, -7)), iso(e)]; } },
  { id: "namorados", name: "Dia dos Namorados", ready: false, range: (y) => [`${y}-06-05`, `${y}-06-12`] },
  { id: "halloween", name: "Halloween", ready: false, range: (y) => [`${y}-10-25`, `${y}-10-31`] },
];

// data de hoje (AAAA-MM-DD) no horário de Brasília
export function dataBrasilia(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

// id do tema ativo na data (ou null). Só considera temas prontos, a menos que { all: true }.
export function activeSeason(date = new Date(), { all = false } = {}) {
  const hoje = dataBrasilia(date);
  const ano = Number(hoje.slice(0, 4));
  for (const s of SEASONS) {
    if (!all && !s.ready) continue;
    for (const y of [ano - 1, ano]) {
      const [ini, fim] = s.range(y);
      if (hoje >= ini && hoje <= fim) return s.id;
    }
  }
  return null;
}

// prévia pelo endereço: ?tema=natal liga, ?tema=off desliga (vale só na aba, pra testar sem mexer na data)
function previewOverride() {
  try {
    const q = new URLSearchParams(location.search).get("tema");
    if (q) sessionStorage.setItem("saudometro-tema-previa", q);
    return sessionStorage.getItem("saudometro-tema-previa");
  } catch (e) { return null; }
}

let atual;
export function applySeason(date = new Date()) {
  const prev = previewOverride();
  const id = prev === "off" ? null : prev && SEASONS.some((s) => s.id === prev && s.ready) ? prev : activeSeason(date);
  if (id === atual) return id;
  atual = id;
  const root = document.documentElement;
  if (id) root.dataset.season = id; else delete root.dataset.season;
  window.dispatchEvent(new CustomEvent("seasonchange", { detail: id }));
  return id;
}

// liga agora e confere de novo quando o app volta pra frente (virou o dia, acabou o período...)
export function watchSeason() {
  applySeason();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) applySeason(); });
  setInterval(() => applySeason(), 30 * 60 * 1000);
}
