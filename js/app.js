import { initTheme } from "./theme.js";
import { supabase, isConfigured } from "./supabaseClient.js";
import * as db from "./db.js";
import { MOODS, MOOD_BY_ID, TALK_OPTIONS, TALK_BY_ID } from "./moods.js";
import { weekIndexSince, questionForWeek } from "./questions.js";
import { pushSupported, permissionState, isSubscribed, subscribeToPush, unsubscribeFromPush, needsHomeScreenFirst } from "./push.js";
import { PERKS, PERK_BY_ID } from "./perks.js";
import { pickSaudadeNudge } from "./nudges.js";
import {
  toISODate, monthKey, parseISODate, addDays, addMonths, startOfMonth,
  daysInMonth, mondayIndex, mondayOfWeek, fridayOfWeekend, fridayOfWeekContaining, humanDateLong,
  humanDateShort, weekdayAbbrev, monthLabel, isSameDate, todayISO, genCoupleCode,
} from "./util.js";

const ROLE_LABEL = { gabriel: "Gabriel", tata: "Tata" };
const ROLE_EMOJI = { gabriel: "🦁", tata: "🦋" };
const NEEDS_CARE_MOODS = new Set(["saudade", "cansada", "estressada", "mal"]);

const State = {
  userId: null,
  profile: null,
  partner: null,
  coupleId: null,
  role: null,
  activeTab: "home",
  calendarMonth: startOfMonth(new Date()),
  calendarEncounters: [],
  calendarPlan: null,
  calendarWeekend: [],
  coupleCreatedAt: null,
  unsubscribe: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view-container");

// ---------------- modal ----------------

function openModal(html) {
  $("#modal-sheet").innerHTML = `<button class="modal-close" id="modal-close-btn">✕</button>${html}`;
  $("#modal-root").classList.add("open");
  $("#modal-close-btn").addEventListener("click", closeModal);
  $("#modal-overlay").onclick = closeModal;
}
function closeModal() {
  $("#modal-root").classList.remove("open");
  $("#modal-sheet").innerHTML = "";
}

// ---------------- boot ----------------

async function boot() {
  if (!isConfigured) {
    $("#screen-setup").style.display = "flex";
    return;
  }
  const session = await db.ensureAnonSession();
  State.userId = session.user.id;
  const profile = await db.getMyProfile(State.userId);
  if (profile) {
    await enterApp(profile);
  } else {
    renderOnboarding();
  }
}

async function enterApp(profile) {
  State.profile = profile;
  State.coupleId = profile.couple_id;
  State.role = profile.role;
  State.partner = await db.getPartnerProfile(State.coupleId, State.role);
  const coupleMeta = await db.getCoupleMeta(State.coupleId);
  State.coupleCreatedAt = coupleMeta.created_at;

  $("#screen-onboarding").style.display = "none";
  $("#screen-app").style.display = "flex";

  $("#avatar-badge").textContent = (profile.display_name || "?").trim()[0]?.toUpperCase() || "?";
  const hour = new Date().getHours();
  $("#greeting-eyebrow").textContent = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  $("#greeting-name").textContent = profile.display_name || ROLE_LABEL[profile.role];

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  if (State.unsubscribe) State.unsubscribe();
  State.unsubscribe = db.subscribeCoupleChanges(State.coupleId, () => renderActiveTab());

  setActiveTab("home");
  updateStreakBadge();
}

// dá moeda com 10% de chance de vir em dobro ("dia da sorte")
async function earnCoins(role, amount, reason) {
  const lucky = Math.random() < 0.1;
  const finalAmount = lucky ? amount * 2 : amount;
  await db.addCoinTransaction(State.coupleId, role, finalAmount, lucky ? `${reason} (🍀 dia da sorte, dobrado!)` : reason);
  if (lucky) alert(`🍀 Dia da sorte! Você ganhou o dobro: +${finalAmount} moedas em vez de +${amount}.`);
  return finalAmount;
}

// conta quantos dias seguidos (terminando hoje) um conjunto de datas ISO cobre
function countConsecutiveDays(daySet) {
  let streak = 0;
  let cursor = new Date();
  while (daySet.has(toISODate(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

// calcula a sequência de uso do app (dias abertos + freezes), sem registrar nem mexer na tela
async function computeLoginStreak() {
  const sinceISO = toISODate(addDays(new Date(), -60));
  const [openDays, freezeDays] = await Promise.all([
    db.getAppOpenDays(State.coupleId, State.role, sinceISO),
    db.getStreakFreezeDays(State.coupleId, State.role, sinceISO),
  ]);
  const validDays = new Set([...openDays, ...freezeDays]);
  return { streak: countConsecutiveDays(validDays), validDays };
}

// registra que o app foi aberto hoje, calcula a sequência de dias seguidos (com freezes contando)
// e mostra o selo discreto no topo. Também oferece "congelar" se faltou só ontem.
async function updateStreakBadge() {
  const todayIso = todayISO();
  await db.recordAppOpen(State.coupleId, State.role, todayIso);
  const { streak, validDays } = await computeLoginStreak();

  const badge = document.getElementById("streak-badge");
  if (badge) {
    if (streak > 1) {
      badge.hidden = false;
      badge.textContent = `🔥${streak}`;
    } else {
      badge.hidden = true;
    }
  }

  await maybeAwardLoginMilestone(streak);

  const yesterday = toISODate(addDays(new Date(), -1));
  const dayBeforeYesterday = toISODate(addDays(new Date(), -2));
  const missedYesterday = !validDays.has(yesterday) && validDays.has(dayBeforeYesterday);
  if (missedYesterday) offerStreakFreeze(yesterday);
}

async function maybeAwardLoginMilestone(streak) {
  if (streak !== 15 && streak !== 30) return;
  const reason = `sequência de uso: ${streak} dias`;
  const recent = await db.listCoinHistory(State.coupleId, 200);
  const already = recent.some((r) => r.role === State.role && r.reason.startsWith(reason));
  if (already) return;
  const amount = streak === 15 ? 10 : 25;
  await earnCoins(State.role, amount, reason);
  alert(`🔥 ${streak} dias seguidos usando o app! +${amount} moedas de bônus.`);
}

function offerStreakFreeze(missedDayISO) {
  const key = "freezeOffered:" + missedDayISO + ":" + State.role;
  if (sessionStorage.getItem(key)) return;
  try { sessionStorage.setItem(key, "1"); } catch (e) { /* ok */ }

  openModal(`
    <h3 class="modal-title">❄️ Quase perdeu a sequência!</h3>
    <p class="card-sub">Parece que ontem vocês não abriram o app. Quer gastar 1 moeda pra proteger sua sequência de dias?</p>
    <div class="row" style="margin-top:16px;">
      <button class="btn btn-ghost" id="btn-skip-freeze">Deixa quebrar</button>
      <button class="btn btn-primary" id="btn-do-freeze">Usar 1 moeda 💰</button>
    </div>
  `);
  $("#btn-skip-freeze").addEventListener("click", closeModal);
  $("#btn-do-freeze").addEventListener("click", async () => {
    setBusy("#btn-do-freeze", true);
    try {
      const balances = await db.getCoinBalances(State.coupleId);
      if ((balances[State.role] || 0) < 1) {
        alert("Você não tem moeda suficiente pra isso ainda.");
        closeModal();
        return;
      }
      await db.addCoinTransaction(State.coupleId, State.role, -1, "usou freeze de sequência");
      await db.addStreakFreeze(State.coupleId, State.role, missedDayISO);
      closeModal();
      await updateStreakBadge();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      closeModal();
    }
  });
}

function setActiveTab(tab) {
  State.activeTab = tab;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  renderActiveTab();
}

let kissTimerInterval = null;
function clearKissTimer() {
  if (kissTimerInterval) { clearInterval(kissTimerInterval); kissTimerInterval = null; }
}

function renderActiveTab() {
  if (!State.coupleId) return;
  clearKissTimer();
  const map = { home: renderHome, calendar: renderCalendar, mood: renderMood, invites: renderInvites, shop: renderShop, profile: renderProfile };
  (map[State.activeTab] || renderHome)();
}

// ================= ONBOARDING =================

function renderOnboarding() {
  $("#screen-onboarding").style.display = "flex";
  $("#screen-onboarding").innerHTML = `
    <div class="logo">💗</div>
    <h1>Saudômetro</h1>
    <p class="tagline">o encontrômetro do casal. Combinem os encontros do mês, guardem o humor do dia e mandem sinais de saudade um pro outro.</p>
    <div class="stack" id="onboarding-choices">
      <button class="btn btn-primary btn-block" id="btn-create">Criar nosso casal</button>
      <button class="btn btn-secondary btn-block" id="btn-join">Já tenho um código</button>
    </div>
    <div id="onboarding-flow"></div>
  `;
  $("#btn-create").addEventListener("click", startCreateFlow);
  $("#btn-join").addEventListener("click", startJoinFlow);
}

function startCreateFlow() {
  $("#onboarding-choices").style.display = "none";
  const suggestion = genCoupleCode();
  $("#onboarding-flow").innerHTML = `
    <div class="stack">
      <label class="field-label">Código do casal (pode trocar por uma palavra ou frase de vocês dois)</label>
      <input type="text" id="couple-code" value="${suggestion}" maxlength="40" style="text-align:center; font-family:'Baloo 2'; font-size:20px; letter-spacing:0.04em;" />
      <p class="hint-text">Guarde ou manda pra ela(e), vai precisar dele pra entrar no app pelo outro celular.</p>
      <p class="field-label">Quem é você?</p>
      <div class="role-pick" id="role-pick">
        ${roleButtonsHTML(new Set())}
      </div>
      <label class="field-label">Seu nome (como quer aparecer)</label>
      <input type="text" id="display-name" placeholder="ex: Gabriel" />
      <button class="btn btn-primary btn-block" id="confirm-create" disabled>Criar e entrar</button>
      <p class="error-text" id="onboarding-error"></p>
    </div>
  `;
  wireRolePick();
  $("#confirm-create").addEventListener("click", async () => {
    const role = $("#role-pick").dataset.selected;
    const name = $("#display-name").value.trim() || ROLE_LABEL[role];
    const code = $("#couple-code").value.trim().toUpperCase();
    $("#onboarding-error").textContent = "";
    if (code.length < 3) { $("#onboarding-error").textContent = "O código precisa ter pelo menos 3 letras."; return; }
    setBusy("#confirm-create", true);
    try {
      const couple = await db.createCouple(code);
      const profile = await db.createProfile({ id: State.userId, coupleId: couple.id, role, displayName: name });
      await db.addCoinTransaction(couple.id, role, 25, "saldo inicial");
      await enterApp(profile);
    } catch (e) {
      $("#onboarding-error").textContent = e.code === "23505"
        ? "Esse código já existe, tenta outro."
        : "Não deu pra criar agora: " + (e.message || e);
      setBusy("#confirm-create", false);
    }
  });
  syncCreateButtonState();
}

function startJoinFlow() {
  $("#onboarding-choices").style.display = "none";
  $("#onboarding-flow").innerHTML = `
    <div class="stack">
      <label class="field-label">Código do casal</label>
      <input type="text" id="join-code" placeholder="ex: AB12CD ou a palavra de vocês" style="text-transform:uppercase; text-align:center; letter-spacing:0.04em; font-family:'Baloo 2'; font-size:20px;" maxlength="40" />
      <button class="btn btn-secondary btn-block" id="btn-check-code">Procurar</button>
      <p class="error-text" id="onboarding-error"></p>
      <div id="join-step2"></div>
    </div>
  `;
  $("#btn-check-code").addEventListener("click", async () => {
    const code = $("#join-code").value.trim().toUpperCase();
    $("#onboarding-error").textContent = "";
    if (code.length < 3) { $("#onboarding-error").textContent = "Digite o código completo."; return; }
    setBusy("#btn-check-code", true);
    try {
      const couple = await db.findCoupleByCode(code);
      if (!couple) {
        $("#onboarding-error").textContent = "Não achei esse código. Confere com quem te mandou :)";
        setBusy("#btn-check-code", false);
        return;
      }
      const taken = await db.getRolesTaken(couple.id);
      renderJoinStep2(couple, taken);
    } catch (e) {
      $("#onboarding-error").textContent = "Deu ruim: " + (e.message || e);
      setBusy("#btn-check-code", false);
    }
  });
}

function renderJoinStep2(couple, taken) {
  $("#join-step2").innerHTML = `
    <p class="field-label">Quem é você?</p>
    <div class="role-pick" id="role-pick">${roleButtonsHTML(taken)}</div>
    <label class="field-label">Seu nome (como quer aparecer)</label>
    <input type="text" id="display-name" placeholder="ex: Tata" />
    <button class="btn btn-primary btn-block" id="confirm-join" disabled style="margin-top:14px;">Entrar</button>
  `;
  wireRolePick();
  $("#confirm-join").addEventListener("click", async () => {
    const role = $("#role-pick").dataset.selected;
    const name = $("#display-name").value.trim() || ROLE_LABEL[role];
    setBusy("#confirm-join", true);
    try {
      const profile = await db.createProfile({ id: State.userId, coupleId: couple.id, role, displayName: name });
      if (profile.isNew) await db.addCoinTransaction(couple.id, role, 25, "saldo inicial");
      await enterApp(profile);
    } catch (e) {
      $("#onboarding-error").textContent = "Não deu pra entrar: " + (e.message || e);
      setBusy("#confirm-join", false);
    }
  });
  syncCreateButtonState();
}

function roleButtonsHTML(takenSet) {
  return ["gabriel", "tata"].map((r) => `
    <button class="role-btn" data-role="${r}">
      <span class="role-emoji">${ROLE_EMOJI[r]}</span>
      <span>${ROLE_LABEL[r]}${takenSet.has(r) ? " (já em uso)" : ""}</span>
    </button>
  `).join("");
}

function wireRolePick() {
  const wrap = $("#role-pick");
  wrap.querySelectorAll(".role-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      wrap.querySelectorAll(".role-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      wrap.dataset.selected = btn.dataset.role;
      syncCreateButtonState();
    });
  });
}

function syncCreateButtonState() {
  const wrap = $("#role-pick");
  const confirmBtn = $("#confirm-create") || $("#confirm-join");
  if (!wrap || !confirmBtn) return;
  const check = () => { confirmBtn.disabled = !wrap.dataset.selected; };
  check();
  const nameInput = $("#display-name");
  if (nameInput) nameInput.addEventListener("input", check);
  const observer = new MutationObserver(check);
  observer.observe(wrap, { attributes: true, attributeFilter: ["data-selected"] });
}

function setBusy(sel, busy) {
  const btn = $(sel);
  if (btn) btn.disabled = busy;
}

// ================= HOME =================

async function renderHome() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const mk = monthKey(new Date());
  const [plan, encounters, coins, stats, sweetNotes, recentMoods] = await Promise.all([
    db.ensureMonthPlan(State.coupleId, mk),
    db.listEncountersForMonth(State.coupleId, mk),
    db.getCoinBalances(State.coupleId),
    db.getCoupleStats(State.coupleId),
    db.listRecentSweetNotes(State.coupleId, 10),
    db.getMoodHistory(State.coupleId, toISODate(addDays(new Date(), -2))),
  ]);
  const todayStr = todayISO();
  const iSentToday = sweetNotes.some((n) => n.role === State.role && n.created_at.slice(0, 10) === todayStr);
  const theirNoteToday = sweetNotes.find((n) => n.role !== State.role && n.created_at.slice(0, 10) === todayStr);

  const target = plan.base_target + plan.carry_in;
  const planejados = encounters.filter((e) => e.kind === "planejado");
  const happened = planejados.filter((e) => e.status === "aconteceu").length;
  const pct = Math.min(100, Math.round((happened / Math.max(1, target)) * 100));

  const today = new Date();
  const upcoming = await findNextUpcoming(today);

  const weekStart = mondayOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const weekEntries = await encountersInRange(weekStart, weekEnd);
  // só conta como "resolvido" o que já tá confirmado — um convite pendente não desliga o lembrete
  const weekHasSomething = weekEntries.some((e) => e.status === "aconteceu" || e.status === "confirmado" || e.status === "agendado");

  const nextWeekendFriday = fridayOfWeekend(today) || nextUpcomingFriday(today);
  const weekendRows = await db.getWeekendRecharge(State.coupleId, monthKey(nextWeekendFriday));
  const myWeekendOn = weekendRows.some((r) => r.week_start === toISODate(nextWeekendFriday) && r.role === State.role && r.active);
  const partnerWeekendOn = weekendRows.some((r) => r.week_start === toISODate(nextWeekendFriday) && r.role !== State.role && r.active);

  const partnerRecentMood = recentMoods.filter((m) => m.role !== State.role).sort((a, b) => a.day < b.day ? 1 : -1)[0];
  const partnerNeedsCare = NEEDS_CARE_MOODS.has(partnerRecentMood?.mood);
  const daysSinceKiss = stats?.last_kiss_at ? Math.floor((Date.now() - new Date(stats.last_kiss_at).getTime()) / 86400000) : null;
  const nudgeText = pickSaudadeNudge({
    role: State.role,
    todayISO: todayStr,
    partnerName: ROLE_LABEL[otherRole()],
    partnerNeedsCare,
    daysSinceKiss,
    weekHasSomething,
  });

  view.innerHTML = `
    ${nudgeText ? `
      <div class="banner banner-warm">
        <div class="banner-icon">🥹</div>
        <div class="banner-text">${nudgeText}</div>
      </div>
    ` : ""}

    <div class="card" id="kiss-card" style="cursor:pointer; text-align:center;">
      <div class="card-title" style="font-size:15px;">⏱️ Sem se beijar</div>
      ${stats?.last_kiss_at ? `
        <div class="flip-clock" id="kiss-counter">
          <div class="flip-unit"><span class="flip-value" data-unit="d">00</span><span class="flip-label">dias</span></div>
          <div class="flip-unit"><span class="flip-value" data-unit="h">00</span><span class="flip-label">hrs</span></div>
          <div class="flip-unit"><span class="flip-value" data-unit="m">00</span><span class="flip-label">min</span></div>
          <div class="flip-unit"><span class="flip-value" data-unit="s">00</span><span class="flip-label">seg</span></div>
        </div>
      ` : `<div class="card-sub" style="margin:10px 0;">—</div>`}
      <p class="hint-text">Toca aqui pra ${stats?.last_kiss_at ? "atualizar" : "registrar"} a hora do último beijo</p>
    </div>

    <div class="card">
      <div class="card-title">${monthLabel(mk)}</div>
      <div class="card-sub">Meta desse mês: <strong>${target} encontro${target === 1 ? "" : "s"}</strong>${plan.carry_in > 0 ? ` (${plan.carry_in} vindo${plan.carry_in > 1 ? "s" : ""} do mês passado)` : ""}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="row" style="margin-top:10px; align-items:center;">
        <div class="progress-dots">${progressDots(happened, target)}</div>
        <div style="text-align:right; flex:0 0 auto;"><span class="pill pill-success">${happened}/${target}</span></div>
      </div>
      ${planejados.length < target ? `<button class="btn btn-secondary btn-block" style="margin-top:14px;" id="btn-goto-define">Definir encontros do mês</button>` : ""}
    </div>

    <div class="card">
      <div class="card-title">Próximo encontro</div>
      ${upcoming ? `
        <div class="entry-item" style="border:none; padding:6px 0;">
          <div class="entry-icon">${iconFor(upcoming)}</div>
          <div class="entry-body">
            <div class="entry-title">${upcoming.title || defaultTitle(upcoming)}</div>
            <div class="entry-meta">${humanDateLong(parseISODate(upcoming.start_date))} · ${daysUntilLabel(parseISODate(upcoming.start_date))}</div>
          </div>
        </div>
      ` : `<p class="center-note" style="padding:6px 0;">Nada marcado ainda. Que tal combinar um? 💕</p>`}
    </div>

    <div class="card" id="weekend-card" style="cursor:pointer;">
      <div class="switch-row">
        <div>
          <div class="card-title" style="font-size:15px;">🔋 Fim de semana de recarregar</div>
          <div class="card-sub" style="margin-bottom:0;">${humanDateShort(nextWeekendFriday)} a ${humanDateShort(addDays(nextWeekendFriday, 2))}. ${myWeekendOn ? "Você está reclusa(o) recarregando" : "Tudo normal pra você"}${partnerWeekendOn ? `. ${ROLE_LABEL[State.partner?.role]} também recarregando` : ""}.</div>
        </div>
        <span class="switch ${myWeekendOn ? "on" : ""}" style="pointer-events:none;"></span>
      </div>
      <p class="hint-text" style="margin-top:8px;">Toca aqui pra escolher outro fim de semana</p>
    </div>

    <div class="card">
      <div class="card-title" style="font-size:15px;">Mandar sinal de saudade</div>
      <div class="card-sub">Gasta 1 moeda 💰 e manda um pedido de visita pra ${ROLE_LABEL[otherRole()]} aprovar.</div>
      <div class="row" style="align-items:center;">
        <span class="pill pill-coin">💰 você tem ${coins[State.role] || 0}</span>
        <button class="btn btn-warm" id="btn-saudade" ${((coins[State.role] || 0) < 1) ? "disabled" : ""}>🥺 Mandar sinal</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title" style="font-size:15px;">💌 Recadinho fofo</div>
      ${theirNoteToday ? `<div class="entry-meta" style="margin-bottom:10px;">"${escapeHTML(theirNoteToday.message)}" — ${ROLE_LABEL[otherRole()]}</div>` : ""}
      <div class="card-sub">${iSentToday ? "Você já mandou um hoje. Pode mandar outro, mas a moeda já foi." : "Manda um oi fofo. O primeiro do dia já ganha 1 moeda 💰."}</div>
      <button class="btn btn-secondary btn-block" id="btn-send-note">💌 Mandar recadinho</button>
    </div>
  `;

  $("#btn-goto-define")?.addEventListener("click", () => setActiveTab("calendar"));
  $("#weekend-card")?.addEventListener("click", () => openWeekendModal(nextWeekendFriday));
  $("#btn-send-note")?.addEventListener("click", () => openSweetNoteModal(iSentToday));
  $("#btn-saudade")?.addEventListener("click", openSaudadeModal);
  $("#kiss-card")?.addEventListener("click", () => openKissModal(stats?.last_kiss_at));

  clearKissTimer();
  if (stats?.last_kiss_at) {
    const target = new Date(stats.last_kiss_at).getTime();
    const counterEl = $("#kiss-counter");
    const dEl = counterEl.querySelector("[data-unit='d']");
    const hEl = counterEl.querySelector("[data-unit='h']");
    const mEl = counterEl.querySelector("[data-unit='m']");
    const sEl = counterEl.querySelector("[data-unit='s']");
    const tick = () => {
      const diff = Math.max(0, Date.now() - target);
      const totalSec = Math.floor(diff / 1000);
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      dEl.textContent = String(days).padStart(2, "0");
      hEl.textContent = String(hours).padStart(2, "0");
      mEl.textContent = String(mins).padStart(2, "0");
      sEl.textContent = String(secs).padStart(2, "0");
    };
    tick();
    kissTimerInterval = setInterval(tick, 1000);
  }

  maybeShowKissMilestone(daysSinceKiss, stats?.last_kiss_at);
}

// mostra uma animação de susto fofo quando o contador de beijo bate um múltiplo de 15 dias
// (uma vez só por marco, guardado no localStorage pra não repetir toda vez que abrir o app)
function maybeShowKissMilestone(daysSinceKiss, lastKissAt) {
  if (!lastKissAt || !daysSinceKiss || daysSinceKiss < 15 || daysSinceKiss % 15 !== 0) return;
  const key = `kissMilestoneShown:${State.role}:${lastKissAt}:${daysSinceKiss}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch (e) { /* ok, só não vai lembrar entre sessões */ }

  openModal(`
    <div class="milestone-icon">😱</div>
    <h3 class="modal-title" style="text-align:center;">Meu Deus...</h3>
    <div class="milestone-days">${daysSinceKiss} dias</div>
    <p class="card-sub" style="text-align:center;">...já fazem ${daysSinceKiss} dias que vocês não se beijam! Que tal já ir combinando um encontro? 🥺💗</p>
    <button class="btn btn-primary btn-block" style="margin-top:16px;" id="btn-milestone-ok">Bora combinar</button>
  `);
  $("#btn-milestone-ok")?.addEventListener("click", () => { closeModal(); setActiveTab("calendar"); });
}

function toLocalDatetimeInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openKissModal(currentISO) {
  const defaultLocal = toLocalDatetimeInputValue(currentISO ? new Date(currentISO) : new Date());
  openModal(`
    <h3 class="modal-title">⏱️ Último beijo</h3>
    <p class="card-sub">Registra quando foi, e o cronômetro conta a partir daí pros dois.</p>
    <label class="field-label">Data e hora</label>
    <input type="datetime-local" id="kiss-datetime" value="${defaultLocal}" />
    <button class="btn btn-primary btn-block" style="margin-top:16px;" id="btn-save-kiss">Salvar</button>
  `);
  $("#btn-save-kiss").addEventListener("click", async () => {
    const val = $("#kiss-datetime").value;
    if (!val) { alert("Escolhe uma data e hora :)"); return; }
    setBusy("#btn-save-kiss", true);
    try {
      await db.setLastKiss(State.coupleId, new Date(val).toISOString());
      closeModal();
      await renderHome();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#btn-save-kiss", false);
    }
  });
}

function openWeekendModal(defaultDate) {
  openModal(`
    <h3 class="modal-title">🔋 Recarregar a bateria</h3>
    <p class="card-sub">Escolhe um dia daquele fim de semana. Enquanto tiver ativo, ${ROLE_LABEL[otherRole()]} sabe que você quer ficar tranquila, sem compromisso.</p>
    <label class="field-label">Data</label>
    <input type="date" id="recharge-date" value="${toISODate(defaultDate)}" />
    <p class="hint-text" id="recharge-range" style="margin-top:8px;"></p>
    <button class="btn btn-warm btn-block" style="margin-top:16px;" id="btn-toggle-recharge">Ativar</button>
  `);

  const dateInput = $("#recharge-date");
  const btn = $("#btn-toggle-recharge");

  async function refresh() {
    const picked = parseISODate(dateInput.value);
    const friday = fridayOfWeekContaining(picked);
    $("#recharge-range").textContent = `Fim de semana de ${humanDateShort(friday)} a ${humanDateShort(addDays(friday, 2))}`;
    const rows = await db.getWeekendRecharge(State.coupleId, monthKey(friday));
    const active = rows.some((r) => r.week_start === toISODate(friday) && r.role === State.role && r.active);
    btn.textContent = active ? "Desativar" : "Ativar";
    btn.className = active ? "btn btn-danger btn-block" : "btn btn-warm btn-block";
    btn.dataset.friday = toISODate(friday);
    btn.dataset.active = active ? "1" : "0";
  }

  dateInput.addEventListener("change", refresh);
  refresh();

  btn.addEventListener("click", async () => {
    const friday = btn.dataset.friday;
    const nowActive = btn.dataset.active === "1";
    setBusy("#btn-toggle-recharge", true);
    try {
      await db.setWeekendRecharge(State.coupleId, friday, State.role, !nowActive);
      closeModal();
      renderActiveTab();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#btn-toggle-recharge", false);
    }
  });
}

function progressDots(happened, target) {
  let out = "";
  for (let i = 0; i < target; i++) out += i < happened ? "●" : "○";
  return out || "○";
}

function otherRole() { return State.role === "gabriel" ? "tata" : "gabriel"; }

function daysUntilLabel(date) {
  const d = Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);
  if (d === 0) return "é hoje! 🎉";
  if (d === 1) return "amanhã";
  if (d > 1) return `em ${d} dias`;
  if (d === -1) return "foi ontem";
  return "já passou";
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function nextUpcomingFriday(from) {
  let d = new Date(from);
  while (d.getDay() !== 5) d = addDays(d, 1);
  return d;
}

async function encountersInRange(start, end) {
  const months = new Set([monthKey(start), monthKey(end)]);
  let all = [];
  for (const mk of months) all = all.concat(await db.listEncountersForMonth(State.coupleId, mk));
  return all.filter((e) => {
    const s = parseISODate(e.start_date);
    const en = e.end_date ? parseISODate(e.end_date) : s;
    return en >= start && s <= end;
  });
}

async function findNextUpcoming(today) {
  const start = startOfDay(today);
  const end = addDays(start, 60);
  const all = await encountersInRange(start, end);
  const candidates = all
    .filter((e) => e.status !== "recusado" && e.status !== "nao_aconteceu")
    .filter((e) => { const en = e.end_date ? parseISODate(e.end_date) : parseISODate(e.start_date); return en >= start; })
    .sort((a, b) => parseISODate(a.start_date) - parseISODate(b.start_date));
  return candidates[0] || null;
}

function defaultTitle(e) {
  if (e.kind === "planejado") return "Encontro combinado";
  if (e.kind === "saudade") return "Encontro de saudade";
  return "Convite";
}

function iconFor(e) {
  // "aconteceu de verdade" tem prioridade sobre qualquer outro estado, de qualquer tipo
  if (e.status === "aconteceu") return "✅";
  if (e.status === "nao_aconteceu") return "⚪";
  if (e.kind === "planejado") return "💗";
  if (e.kind === "saudade") return "🫂";
  if (e.status === "pendente") return "✉️";
  if (e.status === "confirmado") return "📅"; // aceito/agendado, mas ainda não aconteceu de verdade
  if (e.status === "recusado") return "✖️";
  return "✉️";
}

// respeita a semana de recarregar: recusar um convite que cai nela nunca custa moeda
async function isRechargeExemptForDate(dateISO, role) {
  const friday = fridayOfWeekend(parseISODate(dateISO));
  if (!friday) return false;
  const rows = await db.getWeekendRecharge(State.coupleId, monthKey(friday));
  return rows.some((r) => r.week_start === toISODate(friday) && r.role === role && r.active);
}

// nunca bloqueia a ação por falta de moeda — só cobra quando dá pra cobrar
async function spendCoinIfAvailable(role, amount, reason) {
  const balances = await db.getCoinBalances(State.coupleId);
  if ((balances[role] || 0) >= amount) {
    await db.addCoinTransaction(State.coupleId, role, -amount, reason);
    return true;
  }
  return false;
}

// aceitar/recusar/cancelar um convite (fora dos 2 encontros oficiais do mês) e seus efeitos em moedas.
// mandar qualquer convite já custou 1 moeda de quem mandou (ver openSaudadeModal / renderInvites).
async function respondToConvite(entry, decision) {
  if (decision === "accept") {
    await db.updateEncounterStatus(entry.id, "confirmado");
    await earnCoins(State.role, 1, "aceitou um convite");
  } else if (decision === "decline") {
    await db.updateEncounterStatus(entry.id, "recusado");
    // recusar "devolve" a moeda pra quem convidou — quem recusou fica devendo, tenta cobrar dela
    await db.addCoinTransaction(State.coupleId, entry.created_by, 1, "convite recusado: reembolso");
    const exempt = await isRechargeExemptForDate(entry.start_date, State.role);
    if (!exempt) await spendCoinIfAvailable(State.role, 1, "recusou um convite");
  } else if (decision === "cancel") {
    await db.updateEncounterStatus(entry.id, "recusado");
    // cancelar o próprio convite antes de resposta devolve a moeda de quem mandou
    await db.addCoinTransaction(State.coupleId, State.role, 1, "cancelou o próprio convite: reembolso");
  }
}

// conta a sequência de dias seguidos registrando humor (terminando hoje) a partir do histórico já carregado
function countMoodStreakFromHistory(history, role) {
  const mine = new Set(history.filter((h) => h.role === role).map((h) => h.day));
  return countConsecutiveDays(mine);
}

// verifica sequência de dias seguidos registrando humor; premia a cada múltiplo de 7
async function maybeAwardMoodStreak() {
  const since = toISODate(addDays(new Date(), -60));
  const history = await db.getMoodHistory(State.coupleId, since);
  const streak = countMoodStreakFromHistory(history, State.role);
  if (streak === 0 || streak % 7 !== 0) return 0;

  const reason = `sequência de humor: ${streak} dias`;
  const recent = await db.listCoinHistory(State.coupleId, 15);
  const alreadyAwarded = recent.some((r) => r.role === State.role && r.reason.startsWith(reason) && r.created_at.slice(0, 10) === todayISO());
  if (alreadyAwarded) return 0;

  await earnCoins(State.role, 5, reason);
  return streak;
}

function openSweetNoteModal(alreadyEarnedToday) {
  openModal(`
    <h3 class="modal-title">💌 Recadinho fofo</h3>
    <p class="card-sub">${alreadyEarnedToday ? "Você já ganhou a moeda de hoje, mas manda quantos quiser." : "O primeiro recadinho do dia já dá 1 moeda pra você."}</p>
    <textarea id="sweet-note-text" rows="3" placeholder="tô pensando em você..."></textarea>
    <button class="btn btn-primary btn-block" style="margin-top:16px;" id="btn-send-sweet-note">Mandar</button>
  `);
  $("#btn-send-sweet-note").addEventListener("click", async () => {
    const message = $("#sweet-note-text").value.trim();
    if (!message) { alert("Escreve alguma coisa fofa primeiro :)"); return; }
    setBusy("#btn-send-sweet-note", true);
    try {
      await db.sendSweetNote(State.coupleId, State.role, message);
      if (!alreadyEarnedToday) await earnCoins(State.role, 1, "mandou uma mensagem fofa");
      closeModal();
      await renderHome();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#btn-send-sweet-note", false);
    }
  });
}

function openSaudadeModal() {
  const minDate = todayISO();
  openModal(`
    <h3 class="modal-title">🥺 Sinal de saudade</h3>
    <p class="card-sub">Escolhe um dia pra tentar se ver. Isso não mexe na meta do mês, é só um pedido especial pra ${ROLE_LABEL[otherRole()]} aprovar. Se ela recusar, a moeda volta pra você.</p>
    <label class="field-label">Que dia?</label>
    <input type="date" id="saudade-date" min="${minDate}" value="${minDate}" />
    <label class="field-label">Mensagem (opcional)</label>
    <textarea id="saudade-msg" rows="2" placeholder="tô com saudade, será que dá pra gente se ver?"></textarea>
    <button class="btn btn-warm btn-block" style="margin-top:16px;" id="send-saudade">Enviar sinal (💰 -1)</button>
  `);
  $("#send-saudade").addEventListener("click", async () => {
    setBusy("#send-saudade", true);
    const dateVal = $("#saudade-date").value;
    const msg = $("#saudade-msg").value.trim();
    try {
      await db.addCoinTransaction(State.coupleId, State.role, -1, "sinal de saudade");
      await db.createEncounter({
        coupleId: State.coupleId,
        startDate: parseISODate(dateVal),
        title: `🥺 Sinal de saudade${msg ? ": " + msg : ""}`,
        kind: "convite",
        createdBy: State.role,
        status: "pendente",
      });
      closeModal();
      renderActiveTab();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#send-saudade", false);
    }
  });
}

// ================= CALENDÁRIO =================

async function renderCalendar() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const mk = monthKey(State.calendarMonth);
  const moodSince = toISODate(addDays(new Date(), -60));
  const [plan, encounters, weekend, moodHistory] = await Promise.all([
    db.ensureMonthPlan(State.coupleId, mk),
    db.listEncountersForMonth(State.coupleId, mk),
    db.getWeekendRecharge(State.coupleId, mk),
    db.getMoodHistory(State.coupleId, moodSince),
  ]);
  State.calendarPlan = plan;
  State.calendarEncounters = encounters;
  State.calendarWeekend = weekend;

  const target = plan.base_target + plan.carry_in;
  const planejadosCount = encounters.filter((e) => e.kind === "planejado").length;
  const happened = encounters.filter((e) => e.kind === "planejado" && e.status === "aconteceu").length;

  const myMoodStreak = countMoodStreakFromHistory(moodHistory, State.role);
  const myMoodDays = moodHistory.filter((h) => h.role === State.role).map((h) => h.day).sort();
  const lastMoodDay = myMoodDays[myMoodDays.length - 1];
  const daysSinceMood = lastMoodDay ? Math.round((parseISODate(todayISO()) - parseISODate(lastMoodDay)) / 86400000) : null;
  const moodStreakText = myMoodStreak > 1
    ? `🔥 ${myMoodStreak} dias seguidos atualizando seu humor diário`
    : lastMoodDay === todayISO()
    ? "💛 Você já atualizou seu humor diário hoje"
    : daysSinceMood != null
    ? `💛 Você atualizou seu humor diário pela última vez há ${daysSinceMood} dia${daysSinceMood === 1 ? "" : "s"}`
    : "💛 Ainda não tem humor diário registrado por aqui";

  view.innerHTML = `
    <div class="month-nav">
      <button id="prev-month">‹</button>
      <h2>${monthLabel(mk)}</h2>
      <button id="next-month">›</button>
    </div>

    <div class="card" style="text-align:center; background:var(--accent-soft);">
      <div style="font-size:15px; font-weight:800; color:var(--accent-strong);">${moodStreakText}</div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center;">
        <div>
          <div class="card-title" style="font-size:15px;">${happened}/${target} encontros aconteceram</div>
          <div class="card-sub" style="margin-bottom:0;">${planejadosCount} de ${target} já definidos nesse mês</div>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-add-planejado">+ Encontro</button>
      </div>
    </div>

    <div class="card">
      <div class="weekday-row"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div>
      <div class="day-grid" id="day-grid"></div>
      <div class="legend">
        <span>💗 combinado</span><span>✅ aconteceu</span><span>📅 aceito</span><span>🫂 saudade</span><span>✉️ convite</span><span>🔋 recarregando</span>
      </div>
    </div>

    <div id="day-detail"></div>
  `;

  buildDayGrid();

  $("#prev-month").addEventListener("click", () => { State.calendarMonth = addMonths(State.calendarMonth, -1); renderCalendar(); });
  $("#next-month").addEventListener("click", () => { State.calendarMonth = addMonths(State.calendarMonth, 1); renderCalendar(); });
  $("#btn-add-planejado").addEventListener("click", () => openAddEncounterModal("planejado"));
}

function buildDayGrid() {
  const grid = $("#day-grid");
  const month = State.calendarMonth;
  const total = daysInMonth(month);
  const firstDow = mondayIndex(startOfMonth(month)); // 0=segunda
  const leading = (firstDow + 1) % 7; // deslocamento pra grade começando no domingo
  let html = "";
  for (let i = 0; i < leading; i++) html += `<div class="day-cell empty"></div>`;
  for (let day = 1; day <= total; day++) {
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    const iso = toISODate(date);
    const entries = entriesOnDay(date);
    const isToday = isSameDate(date, new Date());
    const friday = fridayOfWeekend(date);
    const weekendActive = friday && State.calendarWeekend.some((w) => w.week_start === toISODate(friday) && w.active);
    const dots = entries.slice(0, 3).map(iconFor).join("");
    html += `
      <button class="day-cell ${isToday ? "today" : ""}" data-date="${iso}">
        <span class="num">${day}</span>
        <span class="dots">${dots}${weekendActive ? "🔋" : ""}</span>
      </button>
    `;
  }
  grid.innerHTML = html;
  grid.querySelectorAll(".day-cell:not(.empty)").forEach((cell) => {
    cell.addEventListener("click", () => showDayDetail(cell.dataset.date));
  });
}

function entriesOnDay(date) {
  return State.calendarEncounters.filter((e) => {
    const s = parseISODate(e.start_date);
    const en = e.end_date ? parseISODate(e.end_date) : s;
    return date >= s && date <= en;
  });
}

function showDayDetail(iso) {
  document.querySelectorAll(".day-cell").forEach((c) => c.classList.toggle("selected", c.dataset.date === iso));
  const date = parseISODate(iso);
  const entries = entriesOnDay(date);
  const friday = fridayOfWeekend(date);
  const weekendRow = friday ? State.calendarWeekend.filter((w) => w.week_start === toISODate(friday)) : [];
  const myWeekendOn = weekendRow.some((w) => w.role === State.role && w.active);

  const entriesHTML = entries.length ? entries.map((e) => entryItemHTML(e)).join("") : `
    <div class="empty-state"><span class="emoji">🗓️</span>Nada marcado nesse dia ainda.</div>
  `;

  $("#day-detail").innerHTML = `
    <div class="card">
      <div class="card-title">${humanDateLong(date)}</div>
      <div class="stack" id="entries-list">${entriesHTML}</div>
      <div class="row" style="margin-top:14px;">
        <button class="btn btn-secondary" id="btn-add-saudade-day">🫂 Encontro de saudade</button>
        ${friday ? `<button class="btn ${myWeekendOn ? "btn-danger" : "btn-secondary"}" id="btn-toggle-weekend-day">${myWeekendOn ? "🔋 Cancelar recarga" : "🔋 Recarregar esse fds"}</button>` : ""}
      </div>
    </div>
  `;

  $("#btn-add-saudade-day").addEventListener("click", () => openAddEncounterModal("saudade", date));
  $("#btn-toggle-weekend-day")?.addEventListener("click", async () => {
    await db.setWeekendRecharge(State.coupleId, toISODate(friday), State.role, !myWeekendOn);
    await renderCalendar();
    showDayDetail(iso);
  });

  wireEntryActions();
}

function entryItemHTML(e) {
  const mine = e.created_by === State.role;
  let actions = "";
  if (e.kind === "planejado" && e.status !== "aconteceu" && e.status !== "nao_aconteceu") {
    actions = `
      <button class="btn btn-success btn-sm" data-act="happened" data-id="${e.id}">Aconteceu ✅</button>
      <button class="btn btn-ghost btn-sm" data-act="missed" data-id="${e.id}">Não rolou</button>
    `;
  } else if (e.kind === "saudade" && e.status !== "aconteceu" && e.status !== "nao_aconteceu") {
    actions = `<button class="btn btn-success btn-sm" data-act="happened" data-id="${e.id}">Aconteceu</button>`;
  } else if (e.kind === "convite" && e.status === "confirmado") {
    actions = `
      <button class="btn btn-success btn-sm" data-act="happened" data-id="${e.id}">Aconteceu ✅</button>
      <button class="btn btn-ghost btn-sm" data-act="missed" data-id="${e.id}">Não rolou</button>
    `;
  } else if (e.kind === "convite" && e.status === "pendente") {
    actions = mine
      ? `<span class="pill pill-muted">Esperando resposta de ${ROLE_LABEL[otherRole()]}</span> <button class="btn btn-ghost btn-sm" data-act="cancel" data-id="${e.id}">Cancelar</button>`
      : `
        <button class="btn btn-success btn-sm" data-act="accept" data-id="${e.id}">Aceitar 💰+1</button>
        <button class="btn btn-danger btn-sm" data-act="decline" data-id="${e.id}">Recusar</button>
        <div class="hint-text" style="flex-basis:100%; margin-top:4px;">recusar devolve a moeda pra ${ROLE_LABEL[e.created_by]} e custa 1💰 sua (de graça se for na sua semana de recarregar)</div>
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
    </div>
  `;
}

function statusLabel(e) {
  const map = {
    agendado: "combinado", confirmado: "confirmado", aconteceu: "aconteceu",
    nao_aconteceu: "não aconteceu", pendente: "pendente", recusado: "recusado",
  };
  return map[e.status] || e.status;
}

function wireEntryActions() {
  $("#entries-list").querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      btn.disabled = true;
      try {
        if (act === "happened") {
          await db.updateEncounterStatus(id, "aconteceu");
          const entry = State.calendarEncounters.find((e) => e.id === id);
          if (entry?.kind === "planejado") {
            await earnCoins("gabriel", 1, "encontro combinado aconteceu");
            await earnCoins("tata", 1, "encontro combinado aconteceu");
          }
        } else if (act === "missed") {
          await db.updateEncounterStatus(id, "nao_aconteceu");
        } else if (act === "cancel" || act === "decline" || act === "accept") {
          const entry = State.calendarEncounters.find((e) => e.id === id);
          await respondToConvite(entry, act);
        }
        await renderCalendar();
        const selected = document.querySelector(".day-cell.selected");
        if (selected) showDayDetail(selected.dataset.date);
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

function openAddEncounterModal(kind, presetDate) {
  const dateVal = presetDate ? toISODate(presetDate) : toISODate(new Date());
  openModal(`
    <h3 class="modal-title">${kind === "planejado" ? "💗 Novo encontro combinado" : "🫂 Novo encontro de saudade"}</h3>
    <label class="field-label">Título</label>
    <input type="text" id="new-title" placeholder="${kind === "planejado" ? "ex: fim de semana em casa" : "ex: cafézinho rápido"}" />
    <label class="field-label">Data de início</label>
    <input type="date" id="new-start" value="${dateVal}" />
    <label class="field-label">Data final (se durar mais de um dia)</label>
    <input type="date" id="new-end" value="" />
    <button class="btn btn-primary btn-block" style="margin-top:16px;" id="save-encounter">Salvar</button>
  `);
  $("#save-encounter").addEventListener("click", async () => {
    setBusy("#save-encounter", true);
    const title = $("#new-title").value.trim();
    const start = parseISODate($("#new-start").value);
    const endVal = $("#new-end").value;
    try {
      const status = kind === "saudade" && start <= startOfDay(new Date()) ? "aconteceu" : "agendado";
      await db.createEncounter({
        coupleId: State.coupleId, startDate: start, endDate: endVal ? parseISODate(endVal) : null,
        title, kind, createdBy: State.role, status,
      });
      closeModal();
      await renderCalendar();
      showDayDetail(toISODate(start));
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#save-encounter", false);
    }
  });
}

// ================= HUMOR =================

async function renderMood() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const today = todayISO();
  const todays = await db.getMoodsForDay(State.coupleId, today);
  const mine = todays.find((m) => m.role === State.role);
  const theirs = todays.find((m) => m.role !== State.role);

  const since = toISODate(addDays(new Date(), -60));
  const history = await db.getMoodHistory(State.coupleId, since);
  const myMoodStreak = countMoodStreakFromHistory(history, State.role);

  const weekIndex = weekIndexSince(State.coupleCreatedAt);
  const question = questionForWeek(weekIndex);
  const weeklyAnswers = await db.getWeeklyAnswers(State.coupleId, weekIndex);
  const myAnswer = weeklyAnswers.find((a) => a.role === State.role);
  const theirAnswer = weeklyAnswers.find((a) => a.role !== State.role);

  view.innerHTML = `
    <div class="card">
      <div class="card-title">Como você tá hoje?</div>
      ${myMoodStreak > 1 ? `<p class="hint-text" style="margin:2px 0 12px;">🔥 ${myMoodStreak} dias seguidos registrando seu humor</p>` : ""}
      <div class="mood-grid" id="mood-grid">
        ${MOODS.map((m) => `
          <button class="mood-btn ${mine?.mood === m.id ? "selected" : ""}" data-mood="${m.id}">
            <span class="emoji">${m.emoji}</span><span class="label">${m.label}</span>
          </button>
        `).join("")}
      </div>

      <div class="section-title">Quer conversar?</div>
      <div class="talk-options" id="talk-options">
        ${TALK_OPTIONS.map((t) => `
          <div class="talk-option ${mine?.wants_to_talk === t.id ? "selected" : ""}" data-talk="${t.id}">
            <span>${t.emoji}</span><span>${t.label}</span>
          </div>
        `).join("")}
      </div>

      <label class="field-label">Um recadinho (opcional)</label>
      <textarea id="mood-note" rows="2" placeholder="algo que quer contar pra ele/ela...">${mine?.note || ""}</textarea>

      <button class="btn btn-primary btn-block" style="margin-top:16px;" id="save-mood">Salvar humor de hoje</button>
    </div>

    <div class="section-title">Humor de ${ROLE_LABEL[otherRole()]} hoje</div>
    <div class="card">
      ${theirs ? `
        <div class="partner-mood-card">
          <span class="emoji-big">${MOOD_BY_ID[theirs.mood]?.emoji || "❔"}</span>
          <div>
            <div class="card-title" style="font-size:15px;">${MOOD_BY_ID[theirs.mood]?.label || theirs.mood}</div>
            <div class="card-sub" style="margin-bottom:0;">${TALK_BY_ID[theirs.wants_to_talk]?.emoji || ""} ${TALK_BY_ID[theirs.wants_to_talk]?.label || ""}</div>
            ${theirs.note ? `<div class="entry-meta" style="margin-top:6px;">"${escapeHTML(theirs.note)}"</div>` : ""}
          </div>
        </div>
      ` : `<div class="empty-state"><span class="emoji">🤔</span>${ROLE_LABEL[otherRole()]} ainda não registrou o humor de hoje.</div>`}
    </div>

    <div class="section-title">Últimos 7 dias</div>
    <div class="card">
      ${historyStripHTML(history)}
    </div>

    <div class="section-title">💭 Pergunta da semana</div>
    <div class="card">
      <div class="card-sub" style="font-size:15px; color:var(--text); font-weight:700;">${question}</div>
      <textarea id="weekly-answer" rows="3" style="margin-top:10px;" placeholder="escreve sua resposta...">${myAnswer?.answer || ""}</textarea>
      <button class="btn btn-primary btn-block" style="margin-top:12px;" id="save-weekly">${myAnswer ? "Atualizar resposta" : "Responder (💰+1)"}</button>
      ${theirAnswer ? `
        <div class="entry-item" style="margin-top:14px;">
          <div class="entry-icon">💬</div>
          <div class="entry-body">
            <div class="entry-title">Resposta de ${ROLE_LABEL[otherRole()]}</div>
            <div class="entry-meta" style="margin-top:4px;">"${escapeHTML(theirAnswer.answer)}"</div>
          </div>
        </div>
      ` : `<p class="hint-text" style="margin-top:12px;">${ROLE_LABEL[otherRole()]} ainda não respondeu essa semana.</p>`}
    </div>
    <p class="hint-text" style="text-align:center; margin-top:-8px;">🔮 Semana que vem: "${questionForWeek(weekIndex + 1)}"</p>
  `;

  let selectedMood = mine?.mood || null;
  let selectedTalk = mine?.wants_to_talk || "talvez";

  $("#mood-grid").querySelectorAll(".mood-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMood = btn.dataset.mood;
      $("#mood-grid").querySelectorAll(".mood-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });
  $("#talk-options").querySelectorAll(".talk-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      selectedTalk = opt.dataset.talk;
      $("#talk-options").querySelectorAll(".talk-option").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
  });
  $("#save-mood").addEventListener("click", async () => {
    if (!selectedMood) { alert("Escolhe um humor primeiro :)"); return; }
    setBusy("#save-mood", true);
    try {
      const isFirstToday = !mine;
      await db.upsertMood(State.coupleId, today, State.role, selectedMood, selectedTalk, $("#mood-note").value.trim());
      if (isFirstToday) await earnCoins(State.role, 1, "registrou o humor do dia");
      const streak = await maybeAwardMoodStreak();
      if (streak) alert(`🎉 ${streak} dias seguidos registrando o humor! +5 moedas de bônus.`);
      await renderMood();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#save-mood", false);
    }
  });

  $("#save-weekly").addEventListener("click", async () => {
    const answer = $("#weekly-answer").value.trim();
    if (!answer) { alert("Escreve uma resposta primeiro :)"); return; }
    setBusy("#save-weekly", true);
    try {
      const saved = await db.saveWeeklyAnswer(State.coupleId, weekIndex, State.role, answer);
      if (saved.isNew) {
        await earnCoins(State.role, 1, "respondeu a pergunta da semana");
        alert("💭 Resposta salva! +1 moeda pra você.");
      }
      await renderMood();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#save-weekly", false);
    }
  });
}

function historyStripHTML(history) {
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(new Date(), -i));
  const rows = ["gabriel", "tata"].map((role) => {
    const cells = days.map((d) => {
      const iso = toISODate(d);
      const entry = history.find((h) => h.day === iso && h.role === role);
      return `<div class="history-day"><span class="dot">${entry ? MOOD_BY_ID[entry.mood]?.emoji || "•" : "·"}</span>${weekdayAbbrev(d)}</div>`;
    }).join("");
    return `<div class="card-sub" style="margin:0 0 4px; font-weight:800; color:var(--text);">${ROLE_LABEL[role]}</div><div class="history-strip">${cells}</div>`;
  });
  return rows.join("<div style='height:14px;'></div>");
}

function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ================= CONVITES =================

async function renderInvites() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const [all, coins] = await Promise.all([db.listAllInvites(State.coupleId), db.getCoinBalances(State.coupleId)]);
  const pendingForMe = all.filter((e) => e.status === "pendente" && e.created_by !== State.role);
  const sentByMe = all.filter((e) => e.created_by === State.role);
  const history = all.filter((e) => e.status !== "pendente" && e.created_by !== State.role);
  const myCoins = coins[State.role] || 0;

  view.innerHTML = `
    ${pendingForMe.length ? `
      <div class="section-title">Esperando sua resposta</div>
      <div class="card"><div class="stack" id="pending-list">${pendingForMe.map(entryItemHTML).join("")}</div></div>
    ` : ""}

    <div class="section-title">Novo convite</div>
    <div class="card">
      <label class="field-label">Título (ex: jantar às 20h no Fogo de Chão)</label>
      <input type="text" id="invite-title" placeholder="pra onde vamos?" />
      <label class="field-label">Data</label>
      <input type="date" id="invite-date" value="${todayISO()}" />
      <div class="row" style="align-items:center; margin-top:14px;">
        <span class="pill pill-coin">💰 você tem ${myCoins}</span>
        <button class="btn btn-primary" id="send-invite" ${myCoins < 1 ? "disabled" : ""}>Enviar convite (💰 -1)</button>
      </div>
      <p class="hint-text" style="margin-top:8px;">Se ela recusar, a moeda volta pra você.</p>
    </div>

    <div class="section-title">Enviados por você</div>
    <div class="card">
      ${sentByMe.length ? `<div class="stack" id="sent-list">${sentByMe.map(entryItemHTML).join("")}</div>` : `<div class="empty-state"><span class="emoji">✉️</span>Nenhum convite enviado ainda.</div>`}
    </div>

    ${history.length ? `
      <div class="section-title">Histórico de ${ROLE_LABEL[otherRole()]}</div>
      <div class="card"><div class="stack">${history.map(entryItemHTML).join("")}</div></div>
    ` : ""}
  `;

  $("#send-invite").addEventListener("click", async () => {
    const title = $("#invite-title").value.trim();
    if (!title) { alert("Escreve um título pro convite :)"); return; }
    setBusy("#send-invite", true);
    try {
      await db.addCoinTransaction(State.coupleId, State.role, -1, "enviou um convite");
      await db.createEncounter({
        coupleId: State.coupleId, startDate: parseISODate($("#invite-date").value),
        title, kind: "convite", createdBy: State.role, status: "pendente",
      });
      await renderInvites();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#send-invite", false);
    }
  });

  document.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      btn.disabled = true;
      try {
        if (act === "accept" || act === "decline" || act === "cancel") {
          const entry = all.find((e) => e.id === id);
          await respondToConvite(entry, act);
        } else if (act === "happened") {
          await db.updateEncounterStatus(id, "aconteceu");
        } else if (act === "missed") {
          await db.updateEncounterStatus(id, "nao_aconteceu");
        }
        await renderInvites();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

// ================= LOJINHA =================

async function renderShop() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const [coins, redemptions] = await Promise.all([
    db.getCoinBalances(State.coupleId),
    db.listShopRedemptions(State.coupleId),
  ]);
  const myCoins = coins[State.role] || 0;
  const pending = redemptions.filter((r) => r.status === "pendente");
  const fulfilled = redemptions.filter((r) => r.status === "cumprido");

  function redemptionItemHTML(r) {
    const perk = PERK_BY_ID[r.perk_id];
    return `
      <div class="entry-item">
        <div class="entry-icon">${perk?.emoji || "🎁"}</div>
        <div class="entry-body">
          <div class="entry-title">${r.title}</div>
          <div class="entry-meta">resgatado por ${ROLE_LABEL[r.role]} · ${r.cost}💰</div>
          ${r.status === "pendente" ? `<div class="entry-actions"><button class="btn btn-success btn-sm" data-act="fulfill" data-id="${r.id}">Marcar como cumprido ✅</button></div>` : `<div class="entry-meta">cumprido ✅</div>`}
        </div>
      </div>
    `;
  }

  view.innerHTML = `
    <div class="card">
      <div class="card-title" style="font-size:15px;">Sua carteira</div>
      <div class="row" style="margin-top:8px;">
        <span class="pill pill-coin">💰 você tem ${myCoins}</span>
        <span class="pill pill-muted">${ROLE_LABEL[otherRole()]}: ${coins[otherRole()] || 0}💰</span>
      </div>
    </div>

    <div class="section-title">Trocar moedas por</div>
    <div class="stack">
      ${PERKS.map((p) => `
        <div class="card">
          <div class="row" style="align-items:flex-start;">
            <div style="flex:0 0 auto; font-size:30px;">${p.emoji}</div>
            <div style="flex:1;">
              <div class="card-title" style="font-size:15px;">${p.title}</div>
              <div class="card-sub">${p.desc}</div>
            </div>
          </div>
          <button class="btn ${myCoins >= p.cost ? "btn-warm" : "btn-secondary"} btn-block" data-act="redeem" data-perk="${p.id}" ${myCoins < p.cost ? "disabled" : ""}>Resgatar (💰 ${p.cost})</button>
        </div>
      `).join("")}
    </div>

    ${pending.length ? `
      <div class="section-title">Pendentes</div>
      <div class="card"><div class="stack">${pending.map(redemptionItemHTML).join("")}</div></div>
    ` : ""}

    ${fulfilled.length ? `
      <div class="section-title">Histórico</div>
      <div class="card"><div class="stack">${fulfilled.map(redemptionItemHTML).join("")}</div></div>
    ` : ""}
  `;

  view.querySelectorAll("[data-act='redeem']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const perk = PERK_BY_ID[btn.dataset.perk];
      if (!confirm(`Resgatar "${perk.title}" por ${perk.cost} moedas?`)) return;
      btn.disabled = true;
      try {
        await db.redeemPerk(State.coupleId, State.role, perk);
        await renderShop();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
  view.querySelectorAll("[data-act='fulfill']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await db.markRedemptionFulfilled(btn.dataset.id);
        await renderShop();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

// ================= PERFIL =================

async function renderProfile() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const moodSince = toISODate(addDays(new Date(), -60));
  const [coins, history, couple, loginStreakInfo, moodHistory] = await Promise.all([
    db.getCoinBalances(State.coupleId),
    db.listCoinHistory(State.coupleId, 12),
    supabase.from("couples").select("code").eq("id", State.coupleId).single(),
    computeLoginStreak(),
    db.getMoodHistory(State.coupleId, moodSince),
  ]);
  const loginStreak = loginStreakInfo.streak;
  const moodStreak = countMoodStreakFromHistory(moodHistory, State.role);
  const pushPerm = permissionState();
  const alreadySubscribed = await isSubscribed();

  view.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center;">
        <div class="avatar" style="width:56px;height:56px;font-size:22px;">${ROLE_EMOJI[State.role]}</div>
        <div>
          <div class="card-title">${State.profile.display_name}</div>
          <div class="card-sub" style="margin-bottom:0;">você é ${ROLE_LABEL[State.role]} · par de ${State.partner ? State.partner.display_name : "..."}</div>
        </div>
      </div>
    </div>

    <div class="section-title">Sequências 🔥</div>
    <div class="card">
      <div class="row">
        <span class="pill">🔥 Uso do app: ${loginStreak} dia${loginStreak === 1 ? "" : "s"}</span>
        <span class="pill">🥰 Humor: ${moodStreak} dia${moodStreak === 1 ? "" : "s"}</span>
      </div>
      <p class="hint-text" style="margin-top:10px;">Só passa a contar como sequência a partir de 2 dias seguidos. Abrir o app ou registrar o humor hoje garante o dia de amanhã.</p>
    </div>

    <div class="card">
      <div class="card-title" style="font-size:15px;">Código do casal</div>
      <div class="card-sub">Use em outro celular pra entrar como ${ROLE_LABEL[otherRole()]} (ou reinstalar).</div>
      <div class="onboarding-code" style="font-size:24px; padding:12px;">${couple.data?.code || "----"}</div>
    </div>

    <div class="section-title">Notificações 🔔</div>
    <div class="card">
      ${needsHomeScreenFirst() ? `
        <p class="card-sub">No iPhone, notificação só funciona depois de adicionar o Saudômetro à tela de início.</p>
        <p class="hint-text">Toca no ícone de compartilhar do Safari (⬆️) → "Adicionar à Tela de Início" → abre o app por esse ícone novo, aí sim ativa as notificações por aqui.</p>
      ` : pushPerm === "unsupported" ? `
        <p class="hint-text">Esse navegador não suporta notificações. Tenta pelo Chrome ou pelo app já adicionado à tela inicial.</p>
      ` : alreadySubscribed ? `
        <p class="card-sub" style="margin-bottom:0;">✅ Ativadas nesse dispositivo. Você recebe aviso quando ${ROLE_LABEL[otherRole()]} atualizar o humor, mandar convite ou responder a pergunta da semana.</p>
        <button class="btn btn-ghost btn-block" style="margin-top:12px;" id="btn-disable-push">Desativar nesse dispositivo</button>
      ` : `
        <p class="card-sub">Receba um aviso no celular quando ${ROLE_LABEL[otherRole()]} atualizar o humor, mandar um convite ou responder a pergunta da semana.</p>
        <button class="btn btn-primary btn-block" id="btn-enable-push">🔔 Ativar notificações</button>
        ${pushPerm === "denied" ? `<p class="error-text" style="margin-top:8px;">Você bloqueou notificações antes. Precisa liberar de novo nas configurações do navegador/celular.</p>` : ""}
      `}
    </div>

    <div class="section-title">Moedas 💰</div>
    <div class="card">
      <div class="row">
        <span class="pill pill-coin">🦁 Gabriel: ${coins.gabriel || 0}</span>
        <span class="pill pill-coin">🦋 Tata: ${coins.tata || 0}</span>
      </div>
      <div class="stack" style="margin-top:12px; font-size:13px; color:var(--text-muted);">
        <div>🟢 <strong style="color:var(--text);">Ganha:</strong> encontro combinado do mês acontece (+1 pra cada um) · registrar o humor do dia (+1, uma vez por dia) · sequência de 7 dias de humor (+5 de bônus) · mandar uma mensagem fofa (+1, uma vez por dia) · responder a pergunta da semana (+1) · aceitar um convite (+1) · 15 dias seguidos usando o app (+10, uma vez) · 30 dias seguidos (+25, uma vez) · convite que você mandou foi recusado, a moeda volta (+1)</div>
        <div>🔴 <strong style="color:var(--text);">Gasta:</strong> mandar qualquer convite, de saudade ou combinado na hora (-1) · recusar um convite de alguém (-1, de graça se for na sua semana de recarregar) · usar o freeze pra proteger a sequência de dias (-1)</div>
        <div>🍀 De vez em quando (1 em cada 10), uma recompensa vem em dobro — é o "dia da sorte".</div>
        <div>Todo mundo começa com 25 moedas. Recusar nunca fica bloqueado por falta de moeda. É só um joguinho por cima, ninguém é obrigado a nada.</div>
      </div>
    </div>

    <div class="section-title">Histórico de moedas</div>
    <div class="card">
      ${history.length ? `<div class="stack">${history.map((h) => `
        <div class="entry-item">
          <div class="entry-icon">${h.delta > 0 ? "➕" : "➖"}</div>
          <div class="entry-body">
            <div class="entry-title">${ROLE_LABEL[h.role]} ${h.delta > 0 ? "ganhou" : "gastou"} ${Math.abs(h.delta)}</div>
            <div class="entry-meta">${h.reason}</div>
          </div>
        </div>
      `).join("")}</div>` : `<div class="empty-state"><span class="emoji">💰</span>Nada ainda.</div>`}
    </div>
  `;

  $("#btn-enable-push")?.addEventListener("click", () => {
    openModal(`
      <h3 class="modal-title">🔔 Ativar notificações</h3>
      <p class="card-sub">O seu celular vai pedir uma permissão agora — é só aceitar (geralmente aparece "Permitir"). Depois disso, você recebe aviso quando ${ROLE_LABEL[otherRole()]} atualizar o humor, mandar um convite ou responder a pergunta da semana.</p>
      <button class="btn btn-primary btn-block" style="margin-top:16px;" id="btn-confirm-push">Continuar</button>
    `);
    $("#btn-confirm-push").addEventListener("click", async () => {
      setBusy("#btn-confirm-push", true);
      try {
        await subscribeToPush(State.coupleId, State.role);
        closeModal();
        await renderProfile();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        closeModal();
      }
    });
  });
  $("#btn-disable-push")?.addEventListener("click", async () => {
    setBusy("#btn-disable-push", true);
    try {
      await unsubscribeFromPush();
      await renderProfile();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#btn-disable-push", false);
    }
  });
}

// ---------------- start ----------------

initTheme();
boot();
