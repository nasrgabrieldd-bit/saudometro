import { initTheme } from "./theme.js";
import { MOODS, MOOD_BY_ID, TALK_OPTIONS, TALK_BY_ID } from "./moods.js";
import {
  toISODate, monthKey, parseISODate, addDays, addMonths, startOfMonth,
  daysInMonth, mondayIndex, humanDateLong, humanDateShort, weekdayAbbrev,
  monthLabel, isSameDate, todayISO, fridayOfWeekend,
} from "./util.js";

const ROLE_LABEL = { gabriel: "Gabriel", tata: "Tata" };
const ROLE_EMOJI = { gabriel: "🦁", tata: "🦋" };
const ROLE = "gabriel"; // simula o ponto de vista do Gabriel nesta prévia

// -------- dados fictícios: estado real de vocês agora --------
const now = new Date();
const Y = now.getFullYear(), M = now.getMonth();
const d = (day) => new Date(Y, M, day);
const prevMonth = addMonths(startOfMonth(now), -1);
const dPrev = (day) => new Date(prevMonth.getFullYear(), prevMonth.getMonth(), day);

const SAMPLE_ENCOUNTERS = [
  // último encontro da cota: aconteceu 29→30 do mês passado (fecha a meta do mês anterior)
  { id: "1", start_date: toISODate(dPrev(29)), end_date: toISODate(dPrev(30)), title: "", kind: "planejado", status: "aconteceu", created_by: "gabriel" },
  // 01/set: encontro de saudade — não entra na cota do mês
  { id: "2", start_date: toISODate(d(1)), end_date: null, title: "", kind: "saudade", status: "aconteceu", created_by: "gabriel" },
  // convite de jantar dia 19 às 18h, aguardando resposta da Tata
  { id: "3", start_date: toISODate(d(19)), end_date: null, title: "Jantar às 18h", kind: "convite", status: "pendente", created_by: "gabriel" },
];

const SAMPLE_PLAN = { base_target: 2, carry_in: 0 };
const SAMPLE_COINS = { gabriel: 3, tata: 2 };
const SAMPLE_WEEKEND = [{ week_start: toISODate(fridayOfWeekend(d(26)) || d(26)), role: "tata", active: true }];
const SAMPLE_MOOD_TODAY = { tata: { mood: "saudade", wants_to_talk: "sim", note: "com muita saudade de vc hoje 🥺" } };
const SAMPLE_HISTORY = [
  { day: toISODate(addDays(now, -5)), role: "gabriel", mood: "feliz" },
  { day: toISODate(addDays(now, -5)), role: "tata", mood: "animada" },
  { day: toISODate(addDays(now, -3)), role: "gabriel", mood: "cansada" },
  { day: toISODate(addDays(now, -3)), role: "tata", mood: "tranquila" },
  { day: toISODate(addDays(now, -1)), role: "gabriel", mood: "saudade" },
  { day: toISODate(addDays(now, -1)), role: "tata", mood: "saudade" },
];

const State = { calendarMonth: startOfMonth(now), calendarEncounters: SAMPLE_ENCOUNTERS, calendarWeekend: SAMPLE_WEEKEND };
const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view-container");

function otherRole() { return ROLE === "gabriel" ? "tata" : "gabriel"; }
function startOfDay(dt) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); }

function iconFor(e) {
  if (e.kind === "planejado") { if (e.status === "aconteceu") return "✅"; if (e.status === "nao_aconteceu") return "⚪"; return "💗"; }
  if (e.kind === "saudade") return "🫂";
  if (e.status === "pendente") return "✉️";
  if (e.status === "confirmado") return "✅";
  if (e.status === "recusado") return "✖️";
  return "✉️";
}
function defaultTitle(e) {
  if (e.kind === "planejado") return "Encontro combinado";
  if (e.kind === "saudade") return "Encontro de saudade";
  return "Convite";
}
function statusLabel(e) {
  const map = { agendado: "combinado", confirmado: "confirmado", aconteceu: "aconteceu", nao_aconteceu: "não aconteceu", pendente: "pendente", recusado: "recusado" };
  return map[e.status] || e.status;
}
function progressDots(happened, target) {
  let out = ""; for (let i = 0; i < target; i++) out += i < happened ? "●" : "○"; return out || "○";
}
function daysUntilLabel(date) {
  const dd = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
  if (dd === 0) return "é hoje! 🎉"; if (dd === 1) return "amanhã"; if (dd > 1) return `em ${dd} dias`;
  if (dd === -1) return "foi ontem"; return "já passou";
}
function entryItemHTML(e) {
  const mine = e.created_by === ROLE;
  let actions = "";
  if (e.kind === "planejado" && e.status !== "aconteceu" && e.status !== "nao_aconteceu") {
    actions = `<button class="btn btn-success btn-sm">Aconteceu ✅</button><button class="btn btn-ghost btn-sm">Não rolou</button>`;
  } else if (e.kind === "convite" && e.status === "pendente") {
    actions = mine
      ? `<span class="pill pill-muted">Esperando resposta de ${ROLE_LABEL[otherRole()]}</span> <button class="btn btn-ghost btn-sm">Cancelar</button>`
      : `
        <button class="btn btn-success btn-sm">Aceitar 🪙+1</button>
        <button class="btn btn-danger btn-sm">Recusar</button>
        <div class="hint-text" style="flex-basis:100%; margin-top:4px;">recusar custa 1🪙 (de graça se for na sua semana de recarregar)</div>
      `;
  }
  return `
    <div class="entry-item">
      <div class="entry-icon">${iconFor(e)}</div>
      <div class="entry-body">
        <div class="entry-title">${e.title || defaultTitle(e)}</div>
        <div class="entry-meta">${statusLabel(e)} · criado por ${ROLE_LABEL[e.created_by]}</div>
        <div class="entry-actions">${actions}</div>
      </div>
    </div>`;
}

function setActiveTab(tab) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  ({ home: renderHome, calendar: renderCalendar, mood: renderMood, invites: renderInvites, profile: renderProfile }[tab] || renderHome)();
}
document.querySelectorAll(".nav-btn").forEach((btn) => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));

// ---------------- HOME ----------------
function inCurrentMonth(iso) {
  const dt = parseISODate(iso);
  return dt.getFullYear() === Y && dt.getMonth() === M;
}
function renderHome() {
  const target = SAMPLE_PLAN.base_target + SAMPLE_PLAN.carry_in;
  const planejadosThisMonth = SAMPLE_ENCOUNTERS.filter((e) => e.kind === "planejado" && inCurrentMonth(e.start_date));
  const happened = planejadosThisMonth.filter((e) => e.status === "aconteceu").length;
  const pct = Math.min(100, Math.round((happened / target) * 100));

  const todayStart = startOfDay(now);
  const upcoming = SAMPLE_ENCOUNTERS
    .filter((e) => e.status !== "recusado" && e.status !== "nao_aconteceu")
    .filter((e) => parseISODate(e.end_date || e.start_date) >= todayStart)
    .sort((a, b) => parseISODate(a.start_date) - parseISODate(b.start_date))[0];

  const weekStart = addDays(now, -((now.getDay() + 6) % 7));
  const weekEnd = addDays(weekStart, 6);
  const weekEntries = SAMPLE_ENCOUNTERS.filter((e) => {
    const s = parseISODate(e.start_date); const en = e.end_date ? parseISODate(e.end_date) : s;
    return en >= weekStart && s <= weekEnd;
  });
  const weekHasSomething = weekEntries.some((e) => e.status === "aconteceu" || e.status === "confirmado" || e.status === "agendado");

  const nextWeekendFriday = fridayOfWeekend(d(26)) || d(26);

  view.innerHTML = `
    ${!weekHasSomething ? `
    <div class="banner banner-warm">
      <div class="banner-icon">🥹</div>
      <div class="banner-text"><strong>Semana sem encontro confirmado...</strong>Fica esperta que o Gabriel já tá com saudade! Responde o convite dele e manda um oizinho fofo 🫂</div>
    </div>` : ""}

    <div class="card">
      <div class="card-title">${monthLabel(monthKey(now))}</div>
      <div class="card-sub">Meta desse mês: <strong>${target} encontros</strong></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="row" style="margin-top:10px; align-items:center;">
        <div class="progress-dots">${progressDots(happened, target)}</div>
        <div style="text-align:right; flex:0 0 auto;"><span class="pill pill-success">${happened}/${target}</span></div>
      </div>
      <button class="btn btn-secondary btn-block" style="margin-top:14px;">Definir encontros do mês</button>
    </div>

    <div class="card">
      <div class="card-title">Próximo encontro</div>
      ${upcoming ? `
      <div class="entry-item" style="border:none; padding:6px 0;">
        <div class="entry-icon">${iconFor(upcoming)}</div>
        <div class="entry-body">
          <div class="entry-title">${upcoming.title || defaultTitle(upcoming)}${upcoming.status === "pendente" ? " · aguardando resposta" : ""}</div>
          <div class="entry-meta">${humanDateLong(parseISODate(upcoming.start_date))} · ${daysUntilLabel(parseISODate(upcoming.start_date))}</div>
        </div>
      </div>` : `<p class="center-note" style="padding:6px 0;">Nada marcado ainda. Que tal combinar um? 🫂</p>`}
    </div>

    <div class="card">
      <div class="switch-row">
        <div>
          <div class="card-title" style="font-size:15px;">🔋 Fim de semana de recarregar</div>
          <div class="card-sub" style="margin-bottom:0;">${humanDateShort(nextWeekendFriday)} a ${humanDateShort(addDays(nextWeekendFriday, 2))}. Tata também recarregando</div>
        </div>
        <button class="switch"></button>
      </div>
    </div>

    <div class="card">
      <div class="card-title" style="font-size:15px;">Mandar sinal de saudade</div>
      <div class="card-sub">Gasta 1 moeda 🪙 e manda um pedido de visita pra Tata aprovar.</div>
      <div class="row" style="align-items:center;">
        <span class="pill pill-coin">🪙 você tem ${SAMPLE_COINS.gabriel}</span>
        <button class="btn btn-warm">🥺 Mandar sinal</button>
      </div>
    </div>
  `;
}

// ---------------- CALENDÁRIO ----------------
function entriesOnDay(date) {
  return State.calendarEncounters.filter((e) => {
    const s = parseISODate(e.start_date); const en = e.end_date ? parseISODate(e.end_date) : s;
    return date >= s && date <= en;
  });
}
function buildDayGrid() {
  const grid = $("#day-grid");
  const month = State.calendarMonth;
  const total = daysInMonth(month);
  const firstDow = mondayIndex(startOfMonth(month));
  const leading = (firstDow + 1) % 7;
  let html = "";
  for (let i = 0; i < leading; i++) html += `<div class="day-cell empty"></div>`;
  for (let day = 1; day <= total; day++) {
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    const iso = toISODate(date);
    const entries = entriesOnDay(date);
    const isToday = isSameDate(date, now);
    const friday = fridayOfWeekend(date);
    const weekendActive = friday && State.calendarWeekend.some((w) => w.week_start === toISODate(friday) && w.active);
    const dots = entries.slice(0, 3).map(iconFor).join("");
    html += `<button class="day-cell ${isToday ? "today" : ""}" data-date="${iso}"><span class="num">${day}</span><span class="dots">${dots}${weekendActive ? "🔋" : ""}</span></button>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll(".day-cell:not(.empty)").forEach((cell) => cell.addEventListener("click", () => showDayDetail(cell.dataset.date)));
}
function showDayDetail(iso) {
  document.querySelectorAll(".day-cell").forEach((c) => c.classList.toggle("selected", c.dataset.date === iso));
  const date = parseISODate(iso);
  const entries = entriesOnDay(date);
  const entriesHTML = entries.length ? entries.map(entryItemHTML).join("") : `<div class="empty-state"><span class="emoji">🗓️</span>Nada marcado nesse dia ainda.</div>`;
  $("#day-detail").innerHTML = `
    <div class="card">
      <div class="card-title">${humanDateLong(date)}</div>
      <div class="stack">${entriesHTML}</div>
      <div class="row" style="margin-top:14px;">
        <button class="btn btn-secondary">🫂 Encontro de saudade</button>
        <button class="btn btn-secondary">🔋 Recarregar esse fds</button>
      </div>
    </div>`;
}
function renderCalendar() {
  const mk = monthKey(State.calendarMonth);
  const target = SAMPLE_PLAN.base_target + SAMPLE_PLAN.carry_in;
  const inThisGridMonth = (iso) => monthKey(parseISODate(iso)) === mk;
  const planejadosCount = SAMPLE_ENCOUNTERS.filter((e) => e.kind === "planejado" && inThisGridMonth(e.start_date)).length;
  const happened = SAMPLE_ENCOUNTERS.filter((e) => e.kind === "planejado" && e.status === "aconteceu" && inThisGridMonth(e.start_date)).length;
  view.innerHTML = `
    <div class="month-nav"><button id="prev-month">‹</button><h2>${monthLabel(mk)}</h2><button id="next-month">›</button></div>
    <div class="card">
      <div class="row" style="align-items:center;">
        <div><div class="card-title" style="font-size:15px;">${happened}/${target} encontros aconteceram</div><div class="card-sub" style="margin-bottom:0;">${planejadosCount} de ${target} já definidos nesse mês</div></div>
        <button class="btn btn-primary btn-sm">+ Encontro</button>
      </div>
    </div>
    <div class="card">
      <div class="weekday-row"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div>
      <div class="day-grid" id="day-grid"></div>
      <div class="legend"><span>💗 combinado</span><span>✅ aconteceu</span><span>🫂 saudade</span><span>✉️ convite</span><span>🔋 recarregando</span></div>
    </div>
    <div id="day-detail"></div>
  `;
  buildDayGrid();
  $("#prev-month").addEventListener("click", () => { State.calendarMonth = addMonths(State.calendarMonth, -1); renderCalendar(); });
  $("#next-month").addEventListener("click", () => { State.calendarMonth = addMonths(State.calendarMonth, 1); renderCalendar(); });
  showDayDetail(toISODate(now));
}

// ---------------- HUMOR ----------------
function historyStripHTML() {
  const days = []; for (let i = 6; i >= 0; i--) days.push(addDays(now, -i));
  const rows = ["gabriel", "tata"].map((role) => {
    const cells = days.map((dt) => {
      const iso = toISODate(dt);
      const entry = SAMPLE_HISTORY.find((h) => h.day === iso && h.role === role);
      return `<div class="history-day"><span class="dot">${entry ? MOOD_BY_ID[entry.mood]?.emoji || "•" : "·"}</span>${weekdayAbbrev(dt)}</div>`;
    }).join("");
    return `<div class="card-sub" style="margin:0 0 4px; font-weight:800; color:var(--text);">${ROLE_LABEL[role]}</div><div class="history-strip">${cells}</div>`;
  });
  return rows.join("<div style='height:14px;'></div>");
}
function renderMood() {
  const theirs = SAMPLE_MOOD_TODAY.tata;
  view.innerHTML = `
    <div class="card">
      <div class="card-title">Como você tá hoje?</div>
      <div class="mood-grid">${MOODS.map((m) => `<button class="mood-btn"><span class="emoji">${m.emoji}</span><span class="label">${m.label}</span></button>`).join("")}</div>
      <div class="section-title">Quer conversar?</div>
      <div class="talk-options">${TALK_OPTIONS.map((t) => `<div class="talk-option"><span>${t.emoji}</span><span>${t.label}</span></div>`).join("")}</div>
      <label class="field-label">Um recadinho (opcional)</label>
      <textarea rows="2" placeholder="algo que quer contar pra ele/ela..."></textarea>
      <button class="btn btn-primary btn-block" style="margin-top:16px;">Salvar humor de hoje</button>
    </div>
    <div class="section-title">Humor de Tata hoje</div>
    <div class="card">
      <div class="partner-mood-card">
        <span class="emoji-big">${MOOD_BY_ID[theirs.mood].emoji}</span>
        <div>
          <div class="card-title" style="font-size:15px;">${MOOD_BY_ID[theirs.mood].label}</div>
          <div class="card-sub" style="margin-bottom:0;">${TALK_BY_ID[theirs.wants_to_talk].emoji} ${TALK_BY_ID[theirs.wants_to_talk].label}</div>
          <div class="entry-meta" style="margin-top:6px;">"${theirs.note}"</div>
        </div>
      </div>
    </div>
    <div class="section-title">Últimos 7 dias</div>
    <div class="card">${historyStripHTML()}</div>
  `;
}

// ---------------- CONVITES ----------------
function renderInvites() {
  const all = SAMPLE_ENCOUNTERS.filter((e) => e.kind === "convite");
  const pendingForMe = all.filter((e) => e.status === "pendente" && e.created_by !== ROLE);
  const sentByMe = all.filter((e) => e.created_by === ROLE);
  view.innerHTML = `
    ${pendingForMe.length ? `<div class="section-title">Esperando sua resposta</div><div class="card"><div class="stack">${pendingForMe.map(entryItemHTML).join("")}</div></div>` : ""}
    <div class="section-title">Novo convite</div>
    <div class="card">
      <label class="field-label">Título (ex: jantar às 20h no Fogo de Chão)</label>
      <input type="text" placeholder="pra onde vamos?" />
      <label class="field-label">Data</label>
      <input type="date" value="${todayISO()}" />
      <button class="btn btn-primary btn-block" style="margin-top:14px;">Enviar convite</button>
    </div>
    <div class="section-title">Enviados por você</div>
    <div class="card">${sentByMe.length ? `<div class="stack">${sentByMe.map(entryItemHTML).join("")}</div>` : `<div class="empty-state"><span class="emoji">✉️</span>Nenhum convite enviado ainda.</div>`}</div>
  `;
}

// ---------------- PERFIL ----------------
function renderProfile() {
  view.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center;">
        <div class="avatar" style="width:56px;height:56px;font-size:22px;">${ROLE_EMOJI.gabriel}</div>
        <div><div class="card-title">Gabriel</div><div class="card-sub" style="margin-bottom:0;">você é Gabriel · par de Tata</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title" style="font-size:15px;">Código do casal</div>
      <div class="card-sub">Use em outro celular pra entrar como Tata (ou reinstalar).</div>
      <div class="onboarding-code" style="font-size:24px; padding:12px;">AB12CD</div>
    </div>
    <div class="section-title">Moedas 🪙</div>
    <div class="card">
      <div class="row"><span class="pill pill-coin">🦁 Gabriel: ${SAMPLE_COINS.gabriel}</span><span class="pill pill-coin">🦋 Tata: ${SAMPLE_COINS.tata}</span></div>
      <div class="stack" style="margin-top:12px; font-size:13px; color:var(--text-muted);">
        <div>🟢 <strong style="color:var(--text);">Ganha:</strong> encontro combinado do mês acontece (+1 pra cada um) · sequência de 7 dias registrando humor (+1) · aceitar um convite (+1)</div>
        <div>🔴 <strong style="color:var(--text);">Gasta:</strong> mandar um sinal de saudade fora da agenda (-1) · recusar um convite fora da agenda (-1, de graça se for na sua semana de recarregar)</div>
        <div>Recusar nunca fica bloqueado por falta de moeda. É só um joguinho por cima, ninguém é obrigado a nada.</div>
      </div>
    </div>
    <div class="section-title">Histórico de moedas</div>
    <div class="card">
      <div class="stack">
        <div class="entry-item"><div class="entry-icon">➕</div><div class="entry-body"><div class="entry-title">Gabriel ganhou 1</div><div class="entry-meta">encontro combinado aconteceu</div></div></div>
        <div class="entry-item"><div class="entry-icon">➖</div><div class="entry-body"><div class="entry-title">Tata gastou 1</div><div class="entry-meta">sinal de saudade</div></div></div>
      </div>
    </div>
    <button class="btn btn-ghost btn-block">Sair deste dispositivo</button>
  `;
}

initTheme();
setActiveTab("home");
