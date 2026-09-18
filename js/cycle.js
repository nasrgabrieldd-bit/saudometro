import { parseISODate, addDays } from "./util.js";

export const CYCLE_COLORS = { mens: "#E8508F", fert: "#9B87F5", ovul: "#F5B731", tpm: "#3BB3A6" };

export const CYCLE_DISCLAIMER =
  "Tudo aqui é estimativa baseada nos registros. Não substitui orientação médica e não serve como método anticoncepcional.";

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function fmt(d) {
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
}
function fmtRange(a, b) {
  return a.getTime() === b.getTime() ? fmt(a) : `${fmt(a)} a ${fmt(b)}`;
}

// tudo é calculado a partir do 1º dia da última menstruação + duração do ciclo
export function cycleInfo(s, today = new Date()) {
  const T = startOfDay(today);
  const L = s.cycle_length, P = s.period_length;
  const start = parseISODate(s.last_period_start);
  const diff = Math.max(0, Math.round((T - start) / 86400000));
  const k = Math.floor(diff / L);
  const cur = addDays(start, k * L);
  const day = diff - k * L + 1;
  const next = addDays(cur, L);
  const ov = L - 14, fs = ov - 5, fe = ov + 1, ts = L - 4;
  const upcoming = (i0, i1) => {
    let a = addDays(cur, i0 - 1), b = addDays(cur, i1 - 1);
    if (b < T) { a = addDays(a, L); b = addDays(b, L); }
    return [a, b];
  };
  return {
    L, P, day, ov, fs, fe, ts,
    toNext: Math.round((next - T) / 86400000),
    nextMens: next,
    dOv: upcoming(ov, ov),
    dFert: upcoming(fs, fe),
    dTpm: upcoming(ts, L),
  };
}

function phaseOf(c, d, full) {
  if (d <= c.P) return "mens";
  if (d >= c.ts) return "tpm";
  if (full && d === c.ov) return "ovul";
  if (full && d >= c.fs && d <= c.fe) return "fert";
  return "rest";
}

export function cyclePhaseName(c, full) {
  const p = phaseOf(c, c.day, full);
  return { mens: "Menstruação", tpm: "TPM", ovul: "Ovulação", fert: "Período fértil (estimativa)", rest: c.day < c.ov ? "Fase folicular" : "Fase lútea" }[p];
}

function pt(a, r) {
  const t = (a * Math.PI) / 180;
  return [130 + r * Math.cos(t), 130 + r * Math.sin(t)];
}

function arc(c, i0, i1, col, pad) {
  const per = 360 / c.L;
  const a0 = -90 + (i0 - 1) * per + pad, a1 = -90 + i1 * per - pad;
  const p0 = pt(a0, 100), p1 = pt(a1, 100);
  return `<path d="M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A100 100 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}" fill="none" stroke="${col}" stroke-width="22" stroke-linecap="round"/>`;
}

export function cycleRingSVG(c, full, who = "Você está") {
  const per = 360 / c.L;
  let s = `<svg viewBox="0 0 260 260" width="100%" style="max-width:270px;display:block;margin:0 auto" role="img" aria-label="Círculo do ciclo, dia ${c.day} de ${c.L}">`;
  s += `<circle cx="130" cy="130" r="100" fill="none" stroke="var(--surface-sunk)" stroke-width="22"/>`;
  const groups = [["mens", 1, c.P, 4], ["tpm", c.ts, c.L, 4]];
  if (full) { groups.push(["fert", c.fs, c.fe, 4]); groups.push(["ovul", c.ov, c.ov, 1.2]); }
  groups.forEach(([k, a, b, pad]) => { s += arc(c, a, b, CYCLE_COLORS[k], pad); });
  for (let i = 1; i <= c.L; i++) {
    const m = pt(-90 + (i - 0.5) * per, 100), rest = phaseOf(c, i, full) === "rest";
    s += `<circle cx="${m[0].toFixed(1)}" cy="${m[1].toFixed(1)}" r="2" fill="${rest ? "var(--text-faint)" : "#fff"}" opacity="${rest ? 0.6 : 0.95}"/>`;
  }
  const mk = pt(-90 + (c.day - 0.5) * per, 100);
  s += `<circle cx="${mk[0].toFixed(1)}" cy="${mk[1].toFixed(1)}" r="15" fill="var(--surface)" stroke="var(--text)" stroke-width="3"/>`;
  s += `<text x="${mk[0].toFixed(1)}" y="${(mk[1] + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="var(--text)">${c.day}</text>`;
  const inMens = c.day <= c.P;
  const big = inMens ? `Dia ${c.day}` : `${c.toNext} ${c.toNext === 1 ? "dia" : "dias"}`;
  s += `<text x="130" y="118" text-anchor="middle" font-size="13" fill="var(--text-muted)">${inMens ? `${who} no` : "Próxima menstruação em"}</text>`;
  s += `<text x="130" y="146" text-anchor="middle" font-size="26" font-weight="800" fill="var(--text)">${big}</text>`;
  s += `<text x="130" y="166" text-anchor="middle" font-size="12" fill="var(--text-muted)">${cyclePhaseName(c, full)}</text>`;
  return s + "</svg>";
}

export function cycleLegendHTML(full) {
  const items = [["mens", "Menstruação"]];
  if (full) { items.push(["fert", "Período fértil"]); items.push(["ovul", "Ovulação"]); }
  items.push(["tpm", "TPM"]);
  return `<div style="display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-top:10px;">${items
    .map(([k, l]) => `<span class="pill pill-muted"><span style="width:9px;height:9px;border-radius:50%;background:${CYCLE_COLORS[k]};display:inline-block;"></span>${l}</span>`)
    .join("")}</div>`;
}

function tile(icon, color, title, value) {
  return `
    <div style="background:var(--surface-alt); border-radius:14px; padding:10px 12px; display:flex; align-items:center; gap:10px;">
      <div style="width:34px;height:34px;border-radius:50%;background:${color}33;display:flex;align-items:center;justify-content:center;font-size:17px;flex:none;">${icon}</div>
      <div><div class="hint-text" style="margin:0;">${title}</div><div style="font-size:14px; font-weight:800;">${value}</div></div>
    </div>`;
}

export function cycleTilesHTML(c, full) {
  let h = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:14px;">`;
  h += tile("🩸", CYCLE_COLORS.mens, "Próxima menstruação", fmt(c.nextMens));
  h += tile("🌧️", CYCLE_COLORS.tpm, "TPM", fmtRange(c.dTpm[0], c.dTpm[1]));
  if (full) {
    h += tile("☀️", CYCLE_COLORS.ovul, "Ovulação", fmt(c.dOv[0]));
    h += tile("🌸", CYCLE_COLORS.fert, "Período fértil", fmtRange(c.dFert[0], c.dFert[1]));
  }
  return h + "</div>";
}

export function cycleTip(c) {
  const p = phaseOf(c, c.day, false);
  if (p === "mens") return "Ela pode estar cansada ou com cólica. Um carinho ajuda.";
  if (p === "tpm") return "Fase mais sensível. Paciência e colo hoje.";
  return "Tudo tranquilo por aqui.";
}

function helpItems(full) {
  const it = [
    ["mens", "mens", "Menstruação", "É quando o ciclo recomeça: o corpo elimina o revestimento do útero, em geral por 3 a 7 dias. Muitas mulheres sentem cólica, cansaço, dor nas costas ou inchaço.", "Pergunte o que ela precisa, ofereça uma bolsa de água quente e tenha paciência com o ritmo dela."],
  ];
  if (full) {
    it.push(["folic", "rest", "Fase folicular", "Vem logo depois da menstruação. Os hormônios sobem e muitas mulheres se sentem com mais energia e disposição.", "É uma boa hora pra programar algo juntos."]);
    it.push(["fert", "fert", "Período fértil", "São os dias em que uma gravidez é mais provável, porque o espermatozoide pode sobreviver alguns dias esperando o óvulo. É só uma estimativa, e o dia real varia.", "Se vocês não estão planejando um filho, converse com ela sobre proteção. O app não é método anticoncepcional."]);
    it.push(["ovul", "ovul", "Ovulação", "É quando o ovário libera o óvulo, geralmente no meio do ciclo. Algumas mulheres sentem um leve desconforto ou mais disposição.", "Nada a fazer de especial, só saber que é uma fase normal."]);
    it.push(["lut", "rest", "Fase lútea", "Depois da ovulação, os hormônios mudam de novo e a energia pode cair aos poucos até a TPM.", "Vale ajudar com o dia a dia e diminuir a pressão."]);
  } else {
    it.push(["calm", "rest", "Demais dias", "Fora da menstruação e da TPM, o corpo costuma estar mais estável, mas cada mulher sente de um jeito.", "Tudo tranquilo, é só seguir a rotina."]);
  }
  it.push(["tpm", "tpm", "TPM", "São os dias antes da menstruação. Pode vir irritação, sensibilidade, cansaço, inchaço ou vontade de doce. É uma reação real aos hormônios, não é exagero. Algumas mulheres quase não sentem nada.", "Mais carinho, menos cobrança, e não discuta o que ela sente."]);
  return it;
}

function currentKey(c, full) {
  const p = phaseOf(c, c.day, full);
  if (p === "rest") return full ? (c.day < c.ov ? "folic" : "lut") : "calm";
  return p;
}

export function cycleHelpHTML(c, full) {
  const cur = currentKey(c, full);
  const items = helpItems(full).map(([id, colorKey, title, what, tip]) => {
    const isCur = id === cur;
    const dotColor = colorKey === "rest" ? "var(--text-faint)" : CYCLE_COLORS[colorKey];
    return `
      <div style="border-radius:14px; padding:10px 12px; background:${isCur ? "var(--accent-soft)" : "var(--surface-alt)"};">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
          <span style="width:10px;height:10px;border-radius:50%;background:${dotColor};display:inline-block;flex:none;"></span>
          <span style="font-size:14px; font-weight:800;">${title}</span>
          ${isCur ? `<span class="pill pill-muted" style="margin-left:auto;">Ela está aqui</span>` : ""}
        </div>
        <p class="card-sub" style="margin:0 0 6px;">${what}</p>
        <p style="font-size:13px; margin:0;">💗 ${tip}</p>
      </div>`;
  }).join("");
  return `
    <div style="display:flex; flex-direction:column; gap:8px;">${items}</div>
    <p class="hint-text" style="margin:10px 0 0;">Cada mulher é diferente. As datas são estimativas. O melhor guia é perguntar a ela.</p>`;
}

// média dos últimos ciclos registrados (precisa de pelo menos 3 inícios de menstruação)
export function averageCycleLength(starts) {
  const dates = [...new Set(starts)].sort().slice(-6).map(parseISODate);
  const gaps = [];
  for (let i = 1; i < dates.length; i++) {
    const g = Math.round((dates[i] - dates[i - 1]) / 86400000);
    if (g >= 18 && g <= 45) gaps.push(g);
  }
  if (gaps.length < 2) return null;
  const avg = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  return Math.min(40, Math.max(21, avg));
}

// fase de uma data qualquer (pra pintar o calendário); projeta o ciclo pra frente e pra trás
export function cyclePhaseOnDate(s, date, full) {
  const L = s.cycle_length;
  const T = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((T - parseISODate(s.last_period_start)) / 86400000);
  const day = ((diff % L) + L) % L + 1;
  const c = { L, P: s.period_length, ov: L - 14, fs: L - 19, fe: L - 13, ts: L - 4 };
  const p = phaseOf(c, day, full);
  return p === "rest" ? null : p;
}
