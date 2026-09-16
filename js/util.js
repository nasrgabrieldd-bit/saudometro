export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function monthKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function parseMonthKey(mk) {
  const [y, m] = mk.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// segunda = 0 ... domingo = 6
export function mondayIndex(d) {
  return (d.getDay() + 6) % 7;
}

export function mondayOfWeek(d) {
  return addDays(d, -mondayIndex(d));
}

// dado qualquer dia, retorna a sexta-feira do bloco sex/sáb/dom que ele pertence,
// ou null se o dia não for sexta, sábado ou domingo.
export function fridayOfWeekend(d) {
  const dow = d.getDay(); // 0 dom .. 6 sáb
  if (dow === 5) return new Date(d);
  if (dow === 6) return addDays(d, -1);
  if (dow === 0) return addDays(d, -2);
  return null;
}

// dado qualquer dia da semana, retorna a sexta-feira do fim de semana daquela mesma semana
export function fridayOfWeekContaining(d) {
  return addDays(mondayOfWeek(d), 4);
}

const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS_ABREV = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function humanDateLong(d) {
  return `${DIAS_SEMANA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

export function humanDateShort(d) {
  return `${d.getDate()} ${MESES_ABREV[d.getMonth()]}`;
}

export function weekdayAbbrev(d) {
  return DIAS_ABREV[d.getDay()];
}

export function monthLabel(mk) {
  const d = parseMonthKey(mk);
  return `${MESES[d.getMonth()][0].toUpperCase()}${MESES[d.getMonth()].slice(1)} de ${d.getFullYear()}`;
}

export function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function todayISO() {
  return toISODate(new Date());
}

export function prevMonthKey(mk) {
  return monthKey(addMonths(parseMonthKey(mk), -1));
}

export function nextMonthKey(mk) {
  return monthKey(addMonths(parseMonthKey(mk), 1));
}

export function genCoupleCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sem letras/números confusos
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
