import { toISODate } from "./util.js";

// Páscoa (algoritmo de Meeus/Jones/Butcher)
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function shift(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// n-ésimo domingo do mês (month 0-11)
function nthSunday(year, month, n) {
  const first = new Date(year, month, 1);
  return new Date(year, month, 1 + ((7 - first.getDay()) % 7) + (n - 1) * 7);
}

const cache = {};

// { "YYYY-MM-DD": { emoji, label } } — feriados nacionais + datas comemorativas
export function holidaysForYear(year) {
  if (cache[year]) return cache[year];
  const map = {};
  const put = (date, emoji, label) => { map[toISODate(date)] = { emoji, label }; };
  const fixed = (m, d, emoji, label) => put(new Date(year, m - 1, d), emoji, label);

  fixed(1, 1, "🎆", "Ano Novo");
  fixed(3, 8, "💐", "Dia Internacional da Mulher");
  fixed(4, 21, "🇧🇷", "Tiradentes");
  fixed(5, 1, "🛠️", "Dia do Trabalho");
  fixed(6, 12, "💘", "Dia dos Namorados");
  fixed(7, 13, "💋", "Dia do Beijo");
  fixed(7, 20, "🤝", "Dia do Amigo");
  fixed(9, 7, "🇧🇷", "Independência do Brasil");
  fixed(10, 12, "🧸", "Dia das Crianças / N. Sra. Aparecida");
  fixed(10, 31, "🎃", "Halloween");
  fixed(11, 2, "🕯️", "Finados");
  fixed(11, 15, "🇧🇷", "Proclamação da República");
  fixed(11, 20, "✊🏿", "Consciência Negra");
  fixed(12, 24, "🎄", "Véspera de Natal");
  fixed(12, 25, "🎄", "Natal");
  fixed(12, 31, "🥂", "Réveillon");

  const easter = easterSunday(year);
  put(shift(easter, -48), "🎭", "Carnaval (segunda)");
  put(shift(easter, -47), "🎭", "Carnaval (terça)");
  put(shift(easter, -2), "✝️", "Sexta-feira Santa");
  put(easter, "🐰", "Páscoa");
  put(shift(easter, 60), "⛪", "Corpus Christi");

  put(nthSunday(year, 4, 2), "💐", "Dia das Mães");
  put(nthSunday(year, 7, 2), "👔", "Dia dos Pais");

  cache[year] = map;
  return map;
}

export function holidayOn(date) {
  return holidaysForYear(date.getFullYear())[toISODate(date)] || null;
}
