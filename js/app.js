import { initTheme } from "./theme.js";
import { icon } from "./icons.js";
import { compressImage } from "./photo.js";
import { initErrorReporting, isAccessDenied } from "./errors.js";
import { installGuideHTML, isInstalled, canPromptInstall, promptInstall, shouldShowInstallHint, dismissInstallHint } from "./install.js";
import { supabase, isConfigured } from "./supabaseClient.js";
import * as friends from "./friends.js";
import { unseenChangelogFor, markChangelogSeen } from "./changelog.js";
import { FRIEND_PERKS, FRIEND_PERK_BY_ID, FRIEND_PERK_CATEGORIES } from "./friendsPerks.js";
import * as db from "./db.js";
import { MOODS, MOOD_BY_ID, TALK_OPTIONS, TALK_BY_ID } from "./moods.js";
import { weekIndexSince, questionForWeek } from "./questions.js";
import { dayIndexSince, challengeForDay } from "./challenges.js";
import { pushSupported, permissionState, isSubscribed, subscribeToPush, unsubscribeFromPush, needsHomeScreenFirst } from "./push.js";
import { PERKS, PERK_BY_ID, customToPerk, suggestedReward } from "./perks.js";
import { emptyGrid, markCell, revealCell, countFound, CELL_EMPTY, CELL_MARK, CELL_CAT } from "./games/starBattle.js";
import { STAR_BATTLE_LEVELS } from "./games/starBattleLevels.js";
import { cycleInfo, cycleRingSVG, cycleLegendHTML, cycleTilesHTML, cycleHelpHTML, cyclePhaseName, cycleTip, cyclePhaseOnDate, averageCycleLength, CYCLE_COLORS, CYCLE_DISCLAIMER } from "./cycle.js";
import { pickSaudadeNudge } from "./nudges.js";
import { nameOf, genderOf, emojiOf, gen, genMixed, cleanName, setPeopleSettings, defaultEmojis, legacyPeople, feat, goalTarget, HOME_WIDGETS, homeOrder, homeWidgetOn, togetherSince, coinRule, luckyOn, perkHidden, COIN_DEFAULTS } from "./people.js";
import {
  toISODate, monthKey, parseISODate, addDays, addMonths, startOfMonth,
  daysInMonth, mondayIndex, mondayOfWeek, fridayOfWeekend, fridayOfWeekContaining, humanDateLong,
  humanDateShort, weekdayAbbrev, monthLabel, isSameDate, todayISO, genCoupleCode,
} from "./util.js";

// nomes e emojis vêm da configuração de cada casal (casal sem configuração = Gabriel/Tata como sempre)
const ROLE_LABEL = new Proxy({}, { get: (_, role) => nameOf(role) });
const ROLE_EMOJI = new Proxy({}, { get: (_, role) => emojiOf(role) });
const NEEDS_CARE_MOODS = new Set(["saudade", "cansada", "estressada", "mal", "triste", "ansiosa", "brava", "assustada", "ciumenta"]);

const State = {
  userId: null,
  profile: null,
  partner: null,
  coupleId: null,
  role: null,
  activeTab: "home",
  notesView: "hub",
  calendarMonth: startOfMonth(new Date()),
  calendarEncounters: [],
  calendarPlan: null,
  calendarWeekend: [],
  coupleCreatedAt: null,
  settings: null,
  unsubscribe: null,
  friendGroups: [],
  friendGroup: null,
  friendsTab: "home",
  friendsCalendarMonth: startOfMonth(new Date()),
  friendsCalendarEvents: [],
  friendsSelectedDay: null,
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

// ---------------- reações (um toque no humor ou no recadinho do par) ----------

const REACTION_EMOJIS = ["❤️", "🤗", "😘", "🥹", "💪"];

function reactionBarHTML(kind, targetId, reactions) {
  const mine = reactions.find((r) => r.target_id === targetId && r.role === State.role)?.emoji;
  return `<div class="react-bar" data-kind="${kind}" data-target="${targetId}">${REACTION_EMOJIS.map((e) =>
    `<button type="button" class="react-btn ${mine === e ? "selected" : ""}" data-emoji="${e}" aria-pressed="${mine === e}" aria-label="Reagir com ${e}">${e}</button>`).join("")}</div>`;
}

// o que o par reagiu ao MEU item (some se ele não reagiu)
function reactionGotHTML(targetId, reactions, what) {
  const r = reactions.find((x) => x.target_id === targetId && x.role !== State.role);
  return r ? `<div class="react-got"><span class="react-got-emoji">${r.emoji}</span> ${escapeHTML(ROLE_LABEL[otherRole()])} reagiu ${what}</div>` : "";
}

function wireReactions(root = view) {
  root.querySelectorAll(".react-bar").forEach((bar) => {
    bar.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const btn = ev.target.closest(".react-btn");
      if (!btn) return;
      const { kind, target } = bar.dataset;
      const wasOn = btn.classList.contains("selected");
      bar.querySelectorAll(".react-btn").forEach((b) => { b.classList.remove("selected"); b.setAttribute("aria-pressed", "false"); });
      if (!wasOn) { btn.classList.add("selected"); btn.setAttribute("aria-pressed", "true"); }
      try {
        if (wasOn) await db.removeReaction(kind, target, State.role);
        else await db.setReaction(State.coupleId, kind, target, State.role, btn.dataset.emoji);
      } catch (e) {
        alert("Não deu pra enviar agora. Tenta de novo.");
        renderActiveTab();
      }
    });
  });
}

function openInstallGuide() {
  openModal(installGuideHTML());
  $("#install-now")?.addEventListener("click", async () => { if (await promptInstall()) closeModal(); });
  $("#install-dismiss")?.addEventListener("click", () => { dismissInstallHint(); closeModal(); renderActiveTab(); });
}

// ---------------- boot ----------------

function watchForAppUpdates() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

function showBootError(e) {
  $("#screen-onboarding").style.display = "flex";
  $("#screen-onboarding").innerHTML = `
    <div class="logo">💗</div>
    <h1>Saudômetro</h1>
    <p class="tagline">Não deu pra conectar agora. Confere a internet e tenta de novo.</p>
    <button class="btn btn-primary btn-block" id="btn-retry">Tentar de novo</button>
  `;
  $("#btn-retry").addEventListener("click", () => location.reload());
  window.addEventListener("online", () => location.reload(), { once: true }); // a internet voltou: tenta sozinho
}

async function boot() {
  watchForAppUpdates();
  if (!isConfigured) {
    $("#screen-setup").style.display = "flex";
    return;
  }
  let session;
  try {
    session = await db.getExistingSession();
  } catch (e) {
    showBootError(e);
    return;
  }
  // ninguém logado ainda: de agora em diante o Google vem antes de qualquer escolha.
  // Quem já estava numa sessão de antes (casal do jeito anônimo antigo) não passa por aqui —
  // a sessão salva já resolve e cai direto no app, sem precisar fazer nada.
  if (!session) {
    renderGoogleGate();
    return;
  }
  State.userId = session.user.id;
  const [profile, myFriendGroups] = await Promise.all([
    db.getMyProfile(State.userId),
    friends.listMyFriendGroups().catch(() => []),
  ]);
  State.friendGroups = myFriendGroups;

  // 2+ contas (casal + turma, ou várias turmas): a pessoa escolhe qual quer usar agora
  if ((profile ? 1 : 0) + myFriendGroups.length > 1) {
    renderAccountSwitcher(profile, myFriendGroups);
    return;
  }
  if (profile) {
    await enterApp(profile);
  } else if (myFriendGroups.length === 1) {
    await enterFriendsMode(myFriendGroups[0]);
  } else {
    renderOnboardingChoices();
  }
}

// porta de entrada obrigatória pra quem ainda não tem sessão nenhuma: o Google vem antes
// de qualquer escolha (criar casal, código ou turma de amigos).
function renderGoogleGate() {
  $("#screen-onboarding").style.display = "flex";
  $("#screen-onboarding").innerHTML = `
    <div class="logo" id="logo-egg" style="cursor:default;">💗</div>
    <h1>Saudômetro</h1>
    <p class="tagline">o encontrômetro do casal (e, se quiser, da turma de amigos também). Entra com sua conta Google pra começar.</p>
    <div class="stack">
      <button class="btn btn-primary btn-block" id="btn-google-gate">Continuar com o Google</button>
      <p class="error-text" id="onboarding-error"></p>
    </div>
    <p class="hint-text" style="text-align:center; font-size:11.5px; margin:16px 8px 0;"><a href="privacidade.html" target="_blank" rel="noopener" style="color:inherit;">Política de privacidade</a></p>
    <p class="hint-text" id="egg-text" style="text-align:center; font-size:11.5px; font-style:italic; margin:14px 8px 0; display:none;">Um app feito com amor: o Gabriel quis entender melhor a Tata, e criou um jeito de matar a saudade e falar de sentimentos. Que ele ajude você e quem você ama também.</p>
    <p class="hint-text" style="text-align:center; font-size:10.5px; opacity:.55; margin:10px 8px 0;">👆 toque no coração aí em cima</p>
  `;
  $("#btn-google-gate").addEventListener("click", async () => {
    setBusy("#btn-google-gate", true);
    try {
      await db.signInWithGoogle(); // navega pro Google; a volta cai direto aqui de novo, já logado
    } catch (e) {
      $("#onboarding-error").textContent = "Não deu pra abrir o login do Google: " + (e.message || e);
      setBusy("#btn-google-gate", false);
    }
  });
  $("#logo-egg").addEventListener("click", () => {
    const t = $("#egg-text");
    t.style.display = t.style.display === "none" ? "block" : "none";
  });
}

// quando a pessoa tem mais de 1 conta (casal e/ou várias turmas de amigos): escolhe qual usar agora.
// A troca não pede login de novo — é a mesma conta Google por baixo, só muda a tela.
function renderAccountSwitcher(profile, groups) {
  $("#screen-onboarding").style.display = "flex";
  $("#screen-onboarding").innerHTML = `
    <div class="logo" style="font-size:40px;">💗</div>
    <h1 style="font-size:22px;">Como você quer entrar?</h1>
    <p class="tagline" style="font-size:13px;">Você tem mais de uma conta neste Saudômetro. As moedas e os dados de cada uma são separados.</p>
    <div class="stack" id="switch-choices">
      ${profile ? `<button class="btn btn-primary btn-block" data-switch="couple">💗 Casal</button>` : ""}
      ${groups.map((g) => {
        const pal = GROUP_PALETTES[g.colorKey] || GROUP_PALETTES.azul;
        const v = isDarkMode() ? pal.dark : pal.light;
        return `<button class="btn btn-block" style="background:${v.soft}; color:${v.strong}; display:flex; align-items:center; gap:10px; text-align:left;" data-switch="friends" data-id="${g.id}">
          <span style="font-size:20px;">${escapeHTML(g.emoji || "👥")}</span>
          <span style="flex:1;">${escapeHTML(g.name)}</span>
          <span style="font-size:12px; font-weight:700; opacity:.75;">${g.memberCount || 1} pessoa${g.memberCount === 1 ? "" : "s"}</span>
        </button>`;
      }).join("")}
    </div>
  `;
  $("#switch-choices").querySelectorAll("[data-switch]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      if (btn.dataset.switch === "couple") {
        await enterApp(profile);
      } else {
        const g = groups.find((x) => x.id === btn.dataset.id);
        await enterFriendsMode(g);
      }
    });
  });
}

// casal com configuração usa o nome dela; casal antigo continua com o nome do perfil, como sempre foi
function myDisplayName() {
  return State.settings?.names?.[State.role] ? nameOf(State.role) : State.profile?.display_name || ROLE_LABEL[State.role];
}
function partnerDisplayName() {
  return State.settings?.names?.[otherRole()] ? nameOf(otherRole()) : State.partner?.display_name || ROLE_LABEL[otherRole()];
}

async function enterApp(profile) {
  State.profile = profile;
  State.coupleId = profile.couple_id;
  State.role = profile.role;
  State.settings = await db.getCoupleSettings(State.coupleId).catch(() => null);
  setPeopleSettings(State.settings);
  State.partner = await db.getPartnerProfile(State.coupleId, State.role);
  const coupleMeta = await db.getCoupleMeta(State.coupleId);
  State.coupleCreatedAt = coupleMeta.created_at;

  $("#screen-onboarding").style.display = "none";
  $("#screen-app").style.display = "flex";

  setAvatarBadge("#avatar-badge", myDisplayName(), State.profile?.avatar_url);
  $("#avatar-badge").style.cursor = "pointer";
  $("#avatar-badge").onclick = () => openEditProfileModal("casal");
  const hour = new Date().getHours();
  $("#greeting-eyebrow").textContent = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  $("#greeting-name").textContent = myDisplayName();

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  if (State.unsubscribe) State.unsubscribe();
  State.unsubscribe = db.subscribeCoupleChanges(
    State.coupleId,
    (p) => {
      if (p?.table === "reactions" && p.new?.role === State.role) return; // já está na tela
      renderActiveTab();
      updateNotesNavBadge();
    },
    async () => {
      try {
        State.settings = await db.getCoupleSettings(State.coupleId);
        setPeopleSettings(State.settings);
        applyNavVisibility();
        renderActiveTab();
      } catch (e) { /* mantém a configuração atual */ }
    }
  );

  applyNavVisibility();
  applyInitialRoute();
  updateStreakBadge();
  updateNotesNavBadge();
  if (feat("shop")) checkPendingDebts();
  // em sequência (não em paralelo): cada um espera o anterior ser dispensado, senão um aviso
  // mais lento (ex.: o de ligar a conta Google, que depende de uma chamada assíncrona) pode
  // sobrescrever o modal de um aviso anterior antes da pessoa conseguir ver ou reagir a ele
  await maybeShowTour();
  await maybeShowGoogleLinkNudge();
  await maybeShowChangelog("casal");
}

// avisa assim que abre o app se o par te resgatou algo na lojinha que você ainda não cumpriu
async function checkPendingDebts() {
  try {
    const redemptions = await db.listShopRedemptions(State.coupleId, 30);
    const owedByMe = redemptions.filter((r) => r.status === "pendente" && r.role !== State.role);
    if (!owedByMe.length) return;
    openModal(`
      <h3 class="modal-title">🎁 Você está devendo!</h3>
      <p class="card-sub">${ROLE_LABEL[otherRole()]} está esperando você cumprir:</p>
      <div class="stack">
        ${owedByMe.map((r) => {
          const perk = PERK_BY_ID[r.perk_id];
          return `
            <div class="entry-item">
              <div class="entry-icon">${perk?.emoji || "🎁"}</div>
              <div class="entry-body"><div class="entry-title">${escapeHTML(gen(r.title, genderOf(r.role)))}</div></div>
            </div>
          `;
        }).join("")}
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:16px;" id="btn-goto-shop-debt">Ver na lojinha</button>
    `);
    $("#btn-goto-shop-debt")?.addEventListener("click", () => { closeModal(); setActiveTab("shop"); });
  } catch (e) { /* aviso é só um bônus, falha calada */ }
}

// abre direto na aba/tela certa quando o app é aberto por um link de notificação
// (ex: "?tab=notes&view=wishes"), e depois limpa a url pra não reaplicar num refresh
function applyInitialRoute() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab") || "home";
  const view = params.get("view");
  State.activeTab = tab;
  State.notesView = tab === "notes" && view ? view : "hub";
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  renderActiveTab();
  if (window.location.search) history.replaceState(null, "", window.location.pathname);
}

// selo discreto no ícone de Recados quando tem convite esperando resposta
// ou desejo resgatado já revelado — já que essas coisas não têm mais aba própria
async function updateNotesNavBadge() {
  const dot = document.getElementById("notes-nav-dot");
  if (!dot) return;
  try {
    const [invites, redemptions] = await Promise.all([
      db.listAllInvites(State.coupleId),
      db.listWishRedemptions(State.coupleId),
    ]);
    const todayStr = todayISO();
    const pendingInvites = invites.filter((e) => e.status === "pendente" && e.created_by !== State.role).length;
    const readyRedemptions = redemptions.filter((r) => r.redeemed_by === State.role && r.reveal_on <= todayStr && !r.fulfilled).length;
    dot.hidden = pendingInvites + readyRedemptions === 0;
  } catch (e) { /* selo é só um indicador visual, falha calada */ }
}

// dá moeda com 10% de chance de vir em dobro ("dia da sorte")
const coinsOn = () => feat("shop");
const coinWord = (n) => `${n} ${n === 1 ? "moeda" : "moedas"}`;
const earnTag = (k) => (coinsOn() && coinRule(k) > 0 ? ` (💰+${coinRule(k)})` : "");
const costTag = (k) => (coinsOn() && coinRule(k) > 0 ? ` (💰 -${coinRule(k)})` : "");
const partnerThey = () => gen("ela(e)", genderOf(otherRole()));
const cn = (text) => (coinsOn() ? text : "");
async function addCoins(role, delta, reason) {
  if (coinsOn() && delta !== 0) await db.addCoinTransaction(State.coupleId, role, delta, reason);
}

async function earnCoins(role, amount, reason) {
  if (!coinsOn() || amount <= 0) return 0;
  const lucky = luckyOn() && Math.random() < 0.1;
  const finalAmount = lucky ? amount * 2 : amount;
  await addCoins(role, finalAmount, lucky ? `${reason} (🍀 dia da sorte, dobrado!)` : reason);
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
  if (!feat("streaks")) {
    const b = document.getElementById("streak-badge");
    if (b) b.hidden = true;
    return;
  }
  const { streak, validDays } = await computeLoginStreak();

  const badge = document.getElementById("streak-badge");
  if (badge) {
    if (streak > 1) {
      badge.hidden = false;
      badge.innerHTML = `${icon("flame", { size: 14 })}${streak}`;
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
  const amount = streak === 15 ? coinRule("login15") : coinRule("login30");
  await earnCoins(State.role, amount, reason);
  alert(`🔥 ${streak} dias seguidos usando o app!${amount > 0 ? cn(` +${amount} moedas de bônus.`) : ""}`);
}

function offerStreakFreeze(missedDayISO) {
  if (!coinsOn()) return;
  const key = "freezeOffered:" + missedDayISO + ":" + State.role;
  if (sessionStorage.getItem(key)) return;
  try { sessionStorage.setItem(key, "1"); } catch (e) { /* ok */ }

  openModal(`
    <h3 class="modal-title">❄️ Quase perdeu a sequência!</h3>
    <p class="card-sub">Parece que ontem vocês não abriram o app. Quer gastar ${coinWord(coinRule("freeze"))} pra proteger sua sequência de dias?</p>
    <div class="row" style="margin-top:16px;">
      <button class="btn btn-ghost" id="btn-skip-freeze">Deixa quebrar</button>
      <button class="btn btn-primary" id="btn-do-freeze">Usar ${coinWord(coinRule("freeze"))} 💰</button>
    </div>
  `);
  $("#btn-skip-freeze").addEventListener("click", closeModal);
  $("#btn-do-freeze").addEventListener("click", async () => {
    setBusy("#btn-do-freeze", true);
    try {
      const balances = await db.getCoinBalances(State.coupleId);
      if ((balances[State.role] || 0) < coinRule("freeze")) {
        alert("Você não tem moeda suficiente pra isso ainda.");
        closeModal();
        return;
      }
      await addCoins(State.role, -coinRule("freeze"), "usou freeze de sequência");
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
  if (tab === "notes") State.notesView = "hub";
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  renderActiveTab();
}

let kissTimerInterval = null;
function clearKissTimer() {
  if (kissTimerInterval) { clearInterval(kissTimerInterval); kissTimerInterval = null; }
}

function renderActiveTab() {
  if (State.activeTab === "shop" && !feat("shop")) State.activeTab = "home";
  if (!State.coupleId) return;
  clearKissTimer();
  const map = { home: renderHome, calendar: renderCalendar, mood: renderMood, notes: renderNotes, shop: renderShop, profile: renderProfile };
  Promise.resolve((map[State.activeTab] || renderHome)()).catch(handleRenderError);
}

// se o banco recusou porque o casal não existe mais (foi apagado com o app aberto), volta pro início em vez de travar
async function handleRenderError(e) {
  if (isAccessDenied(e)) {
    let profile = null;
    try { profile = await db.getMyProfile(State.userId); } catch (e2) { /* sem rede: não é esse caso */ }
    if (!profile && State.userId) { returnToOnboarding(); return; }
  }
  throw e; // outro tipo de erro: segue pro registro de erros
}

function returnToOnboarding() {
  if (State.unsubscribe) State.unsubscribe();
  State.unsubscribe = null;
  State.coupleId = null;
  State.profile = null;
  State.partner = null;
  setPeopleSettings(null);
  clearKissTimer();
  closeModal();
  $("#screen-app").style.display = "none";
  renderOnboardingChoices();
  $("#screen-onboarding").insertAdjacentHTML("afterbegin", `<p class="card-sub" style="text-align:center; margin:0 0 12px;">Não encontramos mais o casal desta conta (ele pode ter sido apagado). Dá pra criar um novo ou entrar com um código.</p>`);
}

// ================= ONBOARDING =================

// depois do Google (ou pra quem já estava numa sessão de antes): escolher casal ou turma de amigos
function renderOnboardingChoices() {
  $("#screen-onboarding").style.display = "flex";
  $("#screen-onboarding").innerHTML = `
    <div class="logo" id="logo-egg" style="cursor:default;">💗</div>
    <h1>Saudômetro</h1>
    <p class="tagline">o encontrômetro do casal. Combinem os encontros do mês, guardem o humor do dia e mandem sinais de saudade um pro outro.</p>
    <div class="stack" id="onboarding-choices">
      <button class="btn btn-primary btn-block" id="btn-create">Criar nosso casal</button>
      <button class="btn btn-secondary btn-block" id="btn-join">Já tenho um código</button>
      <button class="btn btn-block" id="btn-friends-mode" style="margin-top:14px; background:var(--friends-accent-soft); color:var(--friends-accent-strong); font-size:13.5px; padding:10px;">👥 Usar com amigos</button>
    </div>
    <div id="onboarding-flow"></div>
    <p class="hint-text" style="text-align:center; font-size:11.5px; margin:16px 8px 0;"><a href="privacidade.html" target="_blank" rel="noopener" style="color:inherit;">Política de privacidade</a></p>
    <p class="hint-text" id="egg-text" style="text-align:center; font-size:11.5px; font-style:italic; margin:14px 8px 0; display:none;">Um app feito com amor: o Gabriel quis entender melhor a Tata, e criou um jeito de matar a saudade e falar de sentimentos. Que ele ajude você e quem você ama também.</p>
    <p class="hint-text" style="text-align:center; font-size:10.5px; opacity:.55; margin:10px 8px 0;">👆 toque no coração aí em cima</p>
  `;
  $("#btn-create").addEventListener("click", startCreateFlow);
  $("#btn-join").addEventListener("click", startJoinFlow);
  $("#btn-friends-mode").addEventListener("click", friendsChoiceStep);
  // easter egg: tocar no coração mostra a frase de como o app nasceu
  $("#logo-egg").addEventListener("click", () => {
    const t = $("#egg-text");
    t.style.display = t.style.display === "none" ? "block" : "none";
  });
}

function genderPickHTML(key, val) {
  return `<div class="row" style="gap:8px; margin-top:8px;" data-gp="${key}">
    ${[["mulher", "Mulher"], ["homem", "Homem"]].map(([v, l]) => `<button type="button" class="btn ${val === v ? "btn-primary" : "btn-secondary"} btn-sm" style="flex:1;" data-g="${v}">${l}</button>`).join("")}
  </div>`;
}

function wireGenderPick(root, onPick) {
  root.querySelectorAll("[data-gp]").forEach((row) => {
    row.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => {
      onPick(row.dataset.gp, b.dataset.g);
      row.querySelectorAll("[data-g]").forEach((x) => { x.className = `btn ${x.dataset.g === b.dataset.g ? "btn-primary" : "btn-secondary"} btn-sm`; });
    }));
  });
}

function startCreateFlow() {
  $("#onboarding-choices").style.display = "none";
  createNamesStep({ p: [{ n: "", g: "" }, { n: "", g: "" }], me: null, code: genCoupleCode() });
}

function createNamesStep(st) {
  $("#onboarding-flow").innerHTML = `
    <div class="stack">
      <p class="field-label">Como vocês se chamam?</p>
      <p class="hint-text" style="margin:-4px 0 6px;">O app usa o nome e o gênero pra escrever os textos do jeito certo pra cada um.</p>
      ${[0, 1].map((i) => `
        <div class="card" style="padding:12px;">
          <label class="field-label">Pessoa ${i + 1}</label>
          <input type="text" data-pn="${i}" maxlength="24" value="${escapeHTML(st.p[i].n)}" placeholder="nome" />
          ${genderPickHTML(i, st.p[i].g)}
        </div>`).join("")}
      <button class="btn btn-primary btn-block" id="names-next">Continuar</button>
      <p class="error-text" id="onboarding-error"></p>
    </div>
  `;
  const flow = $("#onboarding-flow");
  wireGenderPick(flow, (k, v) => { st.p[+k].g = v; });
  flow.querySelectorAll("[data-pn]").forEach((i) => i.addEventListener("input", () => { st.p[+i.dataset.pn].n = i.value; }));
  $("#names-next").addEventListener("click", () => {
    const err = (m) => { $("#onboarding-error").textContent = m; };
    const names = st.p.map((x) => cleanName(x.n));
    for (let i = 0; i < 2; i++) {
      if (!names[i]) return err(`Escreva o nome da pessoa ${i + 1}.`);
      if (!st.p[i].g) return err(`Escolha o gênero de ${names[i]}.`);
    }
    if (names[0].toLowerCase() === names[1].toLowerCase()) return err("Os dois nomes precisam ser diferentes.");
    st.p.forEach((x, i) => { x.n = names[i]; });
    createWhoStep(st);
  });
}

function createWhoStep(st) {
  const emo = defaultEmojis(st.p[0].g, st.p[1].g);
  $("#onboarding-flow").innerHTML = `
    <div class="stack">
      <p class="field-label">Quem é você?</p>
      <div class="role-pick" id="role-pick">
        ${[0, 1].map((i) => `
          <button class="role-btn ${st.me === i ? "selected" : ""}" data-idx="${i}">
            <span class="role-emoji">${emo[i]}</span>
            <span>${escapeHTML(st.p[i].n)}</span>
          </button>`).join("")}
      </div>
      <button class="btn btn-primary btn-block" id="who-next">Continuar</button>
      <button class="btn btn-ghost btn-block" id="who-back">Voltar</button>
      <p class="error-text" id="onboarding-error"></p>
    </div>
  `;
  const wrap = $("#role-pick");
  wrap.querySelectorAll(".role-btn").forEach((btn) => btn.addEventListener("click", () => {
    st.me = +btn.dataset.idx;
    wrap.querySelectorAll(".role-btn").forEach((b) => b.classList.toggle("selected", b === btn));
  }));
  $("#who-back").addEventListener("click", () => createNamesStep(st));
  $("#who-next").addEventListener("click", () => {
    if (st.me === null) { $("#onboarding-error").textContent = "Toque no seu nome."; return; }
    createCodeStep(st);
  });
}

function createCodeStep(st) {
  const partner = st.p[1 - st.me].n;
  $("#onboarding-flow").innerHTML = `
    <div class="stack">
      <label class="field-label">Código do casal (pode trocar por uma frase de vocês dois, com pelo menos 8 caracteres)</label>
      <input type="text" id="couple-code" value="${escapeHTML(st.code)}" maxlength="40" style="text-align:center; font-family:'Baloo 2'; font-size:20px; letter-spacing:0.04em;" />
      <p class="hint-text">Guarde ou mande pra ${escapeHTML(partner)}, vai precisar dele pra entrar no app pelo outro celular. Ele é a chave do casal: quanto mais difícil de adivinhar, mais protegido. Evite palavras simples como o nome de vocês.</p>
      <button class="btn btn-primary btn-block" id="confirm-create">Criar e entrar</button>
      <button class="btn btn-ghost btn-block" id="code-back">Voltar</button>
      <p class="error-text" id="onboarding-error"></p>
    </div>
  `;
  $("#code-back").addEventListener("click", () => createWhoStep(st));
  $("#confirm-create").addEventListener("click", async () => {
    const code = $("#couple-code").value.trim().toUpperCase();
    st.code = code;
    $("#onboarding-error").textContent = "";
    if (code.replace(/s/g, "").length < 8) { $("#onboarding-error").textContent = "O código precisa ter pelo menos 8 caracteres."; return; }
    const slots = ["gabriel", "tata"];
    const emo = defaultEmojis(st.p[0].g, st.p[1].g);
    const names = { gabriel: st.p[0].n, tata: st.p[1].n };
    const genders = { gabriel: st.p[0].g, tata: st.p[1].g };
    const emojis = { gabriel: emo[0], tata: emo[1] };
    const role = slots[st.me];
    setBusy("#confirm-create", true);
    try {
      const couple = await db.createCouple(code, names, genders, emojis);
      const profile = await db.joinCouple({ code, role, displayName: names[role] });
      await db.addCoinTransaction(couple.id, role, 25, "saldo inicial");
      await enterApp(profile);
    } catch (e) {
      $("#onboarding-error").textContent = e.code === "23505"
        ? "Esse código já existe, tenta outro."
        : String(e.message || "").includes("curto")
        ? "O código precisa ter pelo menos 8 caracteres."
        : "Não deu pra criar agora: " + (e.message || e);
      setBusy("#confirm-create", false);
    }
  });
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
      const couple = await db.findCouplePreview(code);
      if (!couple) {
        $("#onboarding-error").textContent = "Não achei esse código. Confere com quem te mandou :)";
        setBusy("#btn-check-code", false);
        return;
      }
      const roster = couple.roster || {};
      renderJoinStep2(couple, new Set(Object.keys(roster)), roster);
    } catch (e) {
      $("#onboarding-error").textContent = "Deu ruim: " + (e.message || e);
      setBusy("#btn-check-code", false);
    }
  });
}

function renderJoinStep2(couple, taken, displayNames = {}) {
  const base = legacyPeople();
  const hasNames = (k) => !!cleanName(couple.names?.[k]);
  // nome de cada vaga: o salvo no casal; senão o de quem já entrou; vaga livre de casal antigo fica sem nome
  const nameFor = (k) => cleanName(couple.names?.[k]) || (taken.has(k) ? cleanName(displayNames[k]) || base.names[k] : "");
  const genderFor = (k) => (couple.genders?.[k] === "mulher" || couple.genders?.[k] === "homem" ? couple.genders[k] : taken.has(k) || hasNames(k) ? base.genders[k] : null);
  const emojiFor = (k) => couple.emojis?.[k] || base.emojis[k];
  const eff = {
    names: { gabriel: nameFor("gabriel"), tata: nameFor("tata") },
    genders: { gabriel: genderFor("gabriel"), tata: genderFor("tata") },
    emojis: { gabriel: emojiFor("gabriel"), tata: emojiFor("tata") },
  };
  let role = null, gender = null;

  $("#join-step2").innerHTML = `
    <p class="field-label">Quem é você?</p>
    <div class="role-pick" id="role-pick">
      ${["gabriel", "tata"].map((r) => `
        <button class="role-btn" data-role="${r}">
          <span class="role-emoji">${escapeHTML(eff.emojis[r])}</span>
          <span>${eff.names[r] ? escapeHTML(eff.names[r]) : "Sou eu (vaga livre)"}${taken.has(r) ? " (já em uso)" : ""}</span>
        </button>`).join("")}
    </div>
    <div id="join-me" style="display:none;">
      <label class="field-label">Seu nome (pode corrigir)</label>
      <input type="text" id="display-name" maxlength="24" placeholder="seu nome" />
      <div id="join-gender"></div>
    </div>
    <button class="btn btn-primary btn-block" id="confirm-join" disabled style="margin-top:14px;">Entrar</button>
  `;
  const wrap = $("#role-pick");
  wrap.querySelectorAll(".role-btn").forEach((btn) => btn.addEventListener("click", () => {
    role = btn.dataset.role;
    gender = eff.genders[role];
    wrap.querySelectorAll(".role-btn").forEach((b) => b.classList.toggle("selected", b === btn));
    $("#join-me").style.display = "block";
    $("#display-name").value = eff.names[role];
    $("#join-gender").innerHTML = genderPickHTML("me", gender);
    wireGenderPick($("#join-gender"), (_, v) => { gender = v; });
    $("#confirm-join").disabled = false;
  }));
  $("#confirm-join").addEventListener("click", async () => {
    const name = cleanName($("#display-name").value) || eff.names[role];
    const err = (m) => { $("#onboarding-error").textContent = m; };
    if (!name) return err("Escreva seu nome.");
    if (!gender) return err("Escolha se você é mulher ou homem.");
    setBusy("#confirm-join", true);
    try {
      const profile = await db.joinCouple({ code: couple.code, role, displayName: name });
      if (profile.isNew) await db.addCoinTransaction(couple.id, role, 25, "saldo inicial");
      // só grava a configuração se a pessoa corrigiu algo (casal antigo continua sem configuração)
      if (name !== eff.names[role] || gender !== eff.genders[role]) {
        // só grava o que alguém realmente escolheu: vaga livre fica sem nome (nunca o padrão Gabriel/Tata)
        const keep = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v));
        await db.saveCoupleSettings(couple.id, {
          names: keep({ ...eff.names, [role]: name }),
          genders: keep({ ...eff.genders, [role]: gender }),
          emojis: eff.emojis,
        });
      }
      await enterApp(profile);
    } catch (e) {
      $("#onboarding-error").textContent = "Não deu pra entrar: " + (e.message || e);
      setBusy("#confirm-join", false);
    }
  });
}

function setBusy(sel, busy) {
  const btn = $(sel);
  if (btn) btn.disabled = busy;
}

// ================= MODO AMIGOS: entrada =================

// só é chamado depois do Google gate (renderGoogleGate), então já tem sessão de verdade aqui
function friendsChoiceStep() {
  $("#onboarding-choices").style.display = "none";
  $("#onboarding-flow").innerHTML = `
    <div class="stack">
      <button class="btn btn-block" id="friends-create-btn" style="background:var(--friends-accent); color:var(--on-friends-accent);">Criar uma turma</button>
      <button class="btn btn-secondary btn-block" id="friends-join-btn">Já tenho um código de turma</button>
      <button class="btn btn-ghost btn-block" id="friends-back-btn">Voltar</button>
      <p class="error-text" id="onboarding-error"></p>
    </div>
  `;
  $("#friends-create-btn").addEventListener("click", friendsCreateStep);
  $("#friends-join-btn").addEventListener("click", friendsJoinStep);
  $("#friends-back-btn").addEventListener("click", renderOnboardingChoices);
}

function friendsCreateStep() {
  let colorKey = "azul";
  $("#onboarding-flow").innerHTML = `
    <div class="stack">
      <label class="field-label">Nome da turma</label>
      <input type="text" id="friends-group-name" maxlength="30" placeholder="ex: a turma do futebol" />
      <label class="field-label">Emoji da turma</label>
      <input type="text" id="friends-group-emoji" maxlength="4" value="👥" style="text-align:center; width:60px; font-size:22px;" />
      <label class="field-label">Cor da turma</label>
      ${colorPickerHTML("friends", colorKey)}
      <label class="field-label">Seu nome</label>
      <input type="text" id="friends-my-name" maxlength="24" placeholder="seu nome" />
      <button class="btn btn-block" id="friends-confirm-create" style="background:var(--friends-accent); color:var(--on-friends-accent);">Criar turma</button>
      <button class="btn btn-ghost btn-block" id="friends-back-btn">Voltar</button>
      <p class="error-text" id="onboarding-error"></p>
    </div>
  `;
  $("#friends-color-row").querySelectorAll("[data-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      colorKey = btn.dataset.color;
      $("#friends-color-row").querySelectorAll("[data-color]").forEach((b) => { b.style.borderColor = b.dataset.color === colorKey ? "var(--text)" : "transparent"; });
    });
  });
  $("#friends-back-btn").addEventListener("click", friendsChoiceStep);
  $("#friends-confirm-create").addEventListener("click", async () => {
    const groupName = $("#friends-group-name").value.trim();
    const emoji = $("#friends-group-emoji").value.trim() || "👥";
    const myName = cleanName($("#friends-my-name").value);
    const err = (m) => { $("#onboarding-error").textContent = m; };
    if (!myName) return err("Escreva seu nome.");
    setBusy("#friends-confirm-create", true);
    try {
      const created = await friends.createFriendGroup(groupName, myName, emoji, colorKey);
      await enterFriendsMode(created);
    } catch (e) {
      err(e.message === "nome_invalido" ? "Escreva seu nome." : "Não deu pra criar a turma: " + (e.message || e));
      setBusy("#friends-confirm-create", false);
    }
  });
}

function friendsJoinStep() {
  $("#onboarding-flow").innerHTML = `
    <div class="stack">
      <label class="field-label">Código da turma</label>
      <input type="text" id="friends-join-code" placeholder="ex: AB12CD34" style="text-transform:uppercase; text-align:center; letter-spacing:0.04em; font-family:'Baloo 2'; font-size:20px;" maxlength="40" />
      <label class="field-label">Seu nome</label>
      <input type="text" id="friends-my-name" maxlength="24" placeholder="seu nome" />
      <button class="btn btn-block" id="friends-confirm-join" style="background:var(--friends-accent); color:var(--on-friends-accent);">Entrar na turma</button>
      <button class="btn btn-ghost btn-block" id="friends-back-btn">Voltar</button>
      <p class="error-text" id="onboarding-error"></p>
    </div>
  `;
  $("#friends-back-btn").addEventListener("click", friendsChoiceStep);
  $("#friends-confirm-join").addEventListener("click", async () => {
    const code = $("#friends-join-code").value.trim().toUpperCase();
    const myName = cleanName($("#friends-my-name").value);
    const err = (m) => { $("#onboarding-error").textContent = m; };
    if (code.length < 3) return err("Digite o código completo.");
    if (!myName) return err("Escreva seu nome.");
    setBusy("#friends-confirm-join", true);
    try {
      const joined = await friends.joinFriendGroup(code, myName);
      await enterFriendsMode(joined);
    } catch (e) {
      err(
        e.message === "codigo_invalido" ? "Não achei essa turma. Confere o código." :
        e.message === "grupo_cheio" ? "Essa turma já está cheia." :
        e.message === "nome_invalido" ? "Escreva seu nome." :
        "Não deu pra entrar: " + (e.message || e)
      );
      setBusy("#friends-confirm-join", false);
    }
  });
}

// versão em modal do criar/entrar em turma, pra quem já está dentro do app (casal) e
// quer entrar no Modo Amigos pelo Perfil, sem passar pela tela de onboarding.
function openFriendsGroupModal() {
  openModal(`
    <h3 class="modal-title">👥 Modo Amigos</h3>
    <div class="stack">
      <button class="btn btn-block" id="fm-create" style="background:var(--friends-accent); color:var(--on-friends-accent);">Criar uma turma</button>
      <button class="btn btn-secondary btn-block" id="fm-join">Já tenho um código de turma</button>
    </div>
  `);
  $("#fm-create").addEventListener("click", friendsModalCreateStep);
  $("#fm-join").addEventListener("click", friendsModalJoinStep);
}

function friendsModalCreateStep() {
  let colorKey = "azul";
  openModal(`
    <h3 class="modal-title">👥 Criar turma</h3>
    <div class="stack">
      <label class="field-label">Nome da turma</label>
      <input type="text" id="fm-group-name" maxlength="30" placeholder="ex: a turma do futebol" />
      <label class="field-label">Emoji da turma</label>
      <input type="text" id="fm-group-emoji" maxlength="4" value="👥" style="text-align:center; width:60px; font-size:22px;" />
      <label class="field-label">Cor da turma</label>
      ${colorPickerHTML("fm", colorKey)}
      <label class="field-label">Seu nome</label>
      <input type="text" id="fm-my-name" maxlength="24" placeholder="seu nome" value="${escapeHTML(myDisplayName() || "")}" />
      <button class="btn btn-block" id="fm-confirm-create" style="background:var(--friends-accent); color:var(--on-friends-accent);">Criar turma</button>
      <p class="error-text" id="fm-error"></p>
    </div>
  `);
  $("#fm-color-row").querySelectorAll("[data-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      colorKey = btn.dataset.color;
      $("#fm-color-row").querySelectorAll("[data-color]").forEach((b) => { b.style.borderColor = b.dataset.color === colorKey ? "var(--text)" : "transparent"; });
    });
  });
  $("#fm-confirm-create").addEventListener("click", async () => {
    const groupName = $("#fm-group-name").value.trim();
    const emoji = $("#fm-group-emoji").value.trim() || "👥";
    const myName = cleanName($("#fm-my-name").value);
    const err = (m) => { $("#fm-error").textContent = m; };
    if (!myName) return err("Escreva seu nome.");
    setBusy("#fm-confirm-create", true);
    try {
      const created = await friends.createFriendGroup(groupName, myName, emoji, colorKey);
      closeModal();
      await enterFriendsMode(created);
    } catch (e) {
      err(e.message === "nome_invalido" ? "Escreva seu nome." : "Não deu pra criar a turma: " + (e.message || e));
      setBusy("#fm-confirm-create", false);
    }
  });
}

function friendsModalJoinStep() {
  openModal(`
    <h3 class="modal-title">👥 Entrar numa turma</h3>
    <div class="stack">
      <label class="field-label">Código da turma</label>
      <input type="text" id="fm-join-code" placeholder="ex: AB12CD34" style="text-transform:uppercase; text-align:center; letter-spacing:0.04em; font-family:'Baloo 2'; font-size:20px;" maxlength="40" />
      <label class="field-label">Seu nome</label>
      <input type="text" id="fm-my-name" maxlength="24" placeholder="seu nome" value="${escapeHTML(myDisplayName() || "")}" />
      <button class="btn btn-block" id="fm-confirm-join" style="background:var(--friends-accent); color:var(--on-friends-accent);">Entrar na turma</button>
      <p class="error-text" id="fm-error"></p>
    </div>
  `);
  $("#fm-confirm-join").addEventListener("click", async () => {
    const code = $("#fm-join-code").value.trim().toUpperCase();
    const myName = cleanName($("#fm-my-name").value);
    const err = (m) => { $("#fm-error").textContent = m; };
    if (code.length < 3) return err("Digite o código completo.");
    if (!myName) return err("Escreva seu nome.");
    setBusy("#fm-confirm-join", true);
    try {
      const joined = await friends.joinFriendGroup(code, myName);
      closeModal();
      await enterFriendsMode(joined);
    } catch (e) {
      err(
        e.message === "codigo_invalido" ? "Não achei essa turma. Confere o código." :
        e.message === "grupo_cheio" ? "Essa turma já está cheia." :
        e.message === "nome_invalido" ? "Escreva seu nome." :
        "Não deu pra entrar: " + (e.message || e)
      );
      setBusy("#fm-confirm-join", false);
    }
  });
}

// paleta de cada turma: 5 opções fixas (não é cor livre) pra manter contraste bom nos dois
// temas e não colidir com o rosa do casal. Valores conferidos por script (WCAG AA, ≥4.5:1
// em todo par texto/fundo usado no app).
const GROUP_PALETTES = {
  azul: {
    label: "Azul", swatch: "#3D66C9",
    light: { accent: "#3D66C9", strong: "#2c4991", soft: "#e8edf9", on: "#ffffff" },
    dark: { accent: "#8ea6e0", strong: "#8ea6e0", soft: "#111d38", on: "#ffffff" },
  },
  verde: {
    label: "Verde", swatch: "#1F7A4C",
    light: { accent: "#1F7A4C", strong: "#165837", soft: "#e4efea", on: "#ffffff" },
    dark: { accent: "#7db297", strong: "#7db297", soft: "#092215", on: "#ffffff" },
  },
  roxo: {
    label: "Roxo", swatch: "#7259CC",
    light: { accent: "#7259CC", strong: "#524093", soft: "#eeebf9", on: "#ffffff" },
    dark: { accent: "#ad9fe1", strong: "#ad9fe1", soft: "#201939", on: "#ffffff" },
  },
  ambar: {
    label: "Âmbar", swatch: "#B35F0F",
    light: { accent: "#B35F0F", strong: "#81440b", soft: "#f6ece2", on: "#ffffff" },
    dark: { accent: "#d3a274", strong: "#d3a274", soft: "#321b04", on: "#ffffff" },
  },
  ceu: {
    label: "Céu", swatch: "#1D7BA3",
    light: { accent: "#1D7BA3", strong: "#155975", soft: "#e4eff4", on: "#ffffff" },
    dark: { accent: "#7cb2ca", strong: "#7cb2ca", soft: "#08222e", on: "#ffffff" },
  },
};

function isDarkMode() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// aplica a cor escolhida pela turma nas variáveis --friends-accent* — todo o resto do Modo
// Amigos já usa essas variáveis, então isso muda a cor em tudo automaticamente
function applyGroupColors(colorKey) {
  const palette = GROUP_PALETTES[colorKey] || GROUP_PALETTES.azul;
  const v = isDarkMode() ? palette.dark : palette.light;
  // no documentElement (não só em #screen-friends), senão o modal (que fica fora da árvore
  // de #screen-friends no HTML) não pega a cor da turma e cai na cor padrão
  const el = document.documentElement;
  el.style.setProperty("--friends-accent", v.accent);
  el.style.setProperty("--friends-accent-strong", v.strong);
  el.style.setProperty("--friends-accent-soft", v.soft);
  el.style.setProperty("--on-friends-accent", v.on);
}

function colorPickerHTML(idPrefix, selected) {
  return `<div class="row" style="gap:8px;" id="${idPrefix}-color-row">
    ${Object.entries(GROUP_PALETTES).map(([key, p]) => `<button type="button" data-color="${key}" title="${p.label}" style="width:34px; height:34px; border-radius:50%; background:${p.swatch}; border:3px solid ${key === selected ? "var(--text)" : "transparent"}; flex:none; cursor:pointer;"></button>`).join("")}
  </div>`;
}

// mesmos ícones do casal (Lucide), só muda a cor — nada de emoji na navegação
const FRIENDS_TABS = [
  { tab: "home", icon: "home", label: "Hoje" },
  { tab: "roles", icon: "calendar", label: "Rolês" },
  { tab: "mood", icon: "heart", label: "Humor" },
  { tab: "notes", icon: "mail", label: "Experiências" },
  { tab: "shop", icon: "shopping-bag", label: "Prêmios" },
  { tab: "group", icon: "settings", label: "Turma" },
];

async function enterFriendsMode(group) {
  if (State.unsubscribe) { State.unsubscribe(); State.unsubscribe = null; } // saindo do casal (se estava nele): para de ouvir as mudanças dele
  State.friendGroup = group;
  State.friendsTab = "home";
  $("#screen-onboarding").style.display = "none";
  $("#screen-app").style.display = "none";
  $("#screen-friends").style.display = "flex";
  applyGroupColors(group.colorKey);
  $("#screen-friends").innerHTML = `
    <header class="topbar" style="background:var(--friends-accent-soft);">
      <div>
        <div class="greeting-eyebrow">Turma</div>
        <h1>${escapeHTML(group.emoji || "👥")} ${escapeHTML(group.name || "Minha turma")}</h1>
      </div>
      <div class="topbar-actions">
        <span class="streak-badge" id="friends-streak-badge" title="Ofensiva da turma" hidden></span>
        <button class="theme-toggle" id="friends-switch-btn" title="Trocar de conta">🔀</button>
        <div class="avatar" id="friends-avatar-badge" style="cursor:pointer; background:var(--friends-accent-soft); color:var(--friends-accent-strong);">?</div>
      </div>
    </header>
    <main id="friends-view" style="flex:1; padding:20px 16px; overflow:auto;"></main>
    <nav class="bottom-nav">
      ${FRIENDS_TABS.map((t) => `<button class="nav-btn" data-friends-tab="${t.tab}"><span class="nav-icon">${icon(t.icon, { size: 22 })}</span><span class="nav-label">${t.label}</span></button>`).join("")}
    </nav>
  `;
  setAvatarBadge("#friends-avatar-badge", group.myDisplayName, null);
  $("#friends-avatar-badge").onclick = () => openEditProfileModal("amigos");
  friends.listGroupMembers(group.id).then((members) => {
    const me = members.find((m) => m.user_id === State.userId);
    if (me) setAvatarBadge("#friends-avatar-badge", me.display_name, me.avatar_url);
  }).catch(() => {});
  $("#friends-switch-btn")?.addEventListener("click", async () => {
    $("#screen-friends").style.display = "none";
    State.profile = await db.getMyProfile(State.userId).catch(() => null);
    State.friendGroups = await friends.listMyFriendGroups().catch(() => []);
    renderAccountSwitcher(State.profile, State.friendGroups);
  });
  document.querySelectorAll("[data-friends-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setFriendsTab(btn.dataset.friendsTab));
  });
  setFriendsTab("home");
  updateFriendsStreakBadge();
  maybeShowChangelog("amigos");
}

function setFriendsTab(tab) {
  State.friendsTab = tab;
  document.querySelectorAll("[data-friends-tab]").forEach((b) => {
    b.style.color = b.dataset.friendsTab === tab ? "var(--friends-accent-strong)" : "";
  });
  renderFriendsActiveTab();
}

// sequência de dias em que a turma teve atividade — conta com "congelador" grátis: até 1 dia
// de folga a cada 7 dias válidos não quebra a sequência (perda suave, sem cobrar moeda pra
// proteger, diferente do casal — ver estudo sobre gamificação ética).
function computeFriendsStreak(validDaysSet) {
  let streak = 0;
  let sinceFreePass = 99;
  let cursor = startOfDay(new Date());
  for (let i = 0; i < 400; i++) {
    const iso = toISODate(cursor);
    const isToday = isSameDate(cursor, new Date());
    if (validDaysSet.has(iso)) {
      streak++;
      sinceFreePass++;
    } else if (isToday) {
      // hoje sem atividade ainda não quebra nada, só não soma ainda
    } else if (sinceFreePass >= 7) {
      sinceFreePass = 0; // congelador grátis desse "período" de 7 dias
    } else {
      break;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

async function updateFriendsStreakBadge() {
  const todayIso = todayISO();
  await friends.recordGroupActivityToday(State.friendGroup.id, todayIso).catch(() => {});
  const sinceISO = toISODate(addDays(new Date(), -60));
  const days = await friends.listStreakDays(State.friendGroup.id, sinceISO).catch(() => []);
  const streak = computeFriendsStreak(new Set(days));
  const badge = document.getElementById("friends-streak-badge");
  if (badge) {
    if (streak > 1) {
      badge.hidden = false;
      badge.innerHTML = `${icon("flame", { size: 14 })}${streak}`;
    } else {
      badge.hidden = true;
    }
  }
  await maybeAwardFriendsStreakMilestone(streak);
}

const FRIENDS_STREAK_MILESTONES = { 15: 20, 30: 40 };

async function maybeAwardFriendsStreakMilestone(streak) {
  const amount = FRIENDS_STREAK_MILESTONES[streak];
  if (!amount) return;
  const reason = `sequência da turma: ${streak} dias`;
  const recent = await friends.listCoinHistory(State.friendGroup.id, 200).catch(() => []);
  if (recent.some((r) => r.reason === reason)) return; // já premiado esse marco
  await friends.addCoinBonus(State.friendGroup.id, State.userId, amount, reason).catch(() => {});
}

function renderFriendsActiveTab() {
  const map = {
    home: renderFriendsHome,
    roles: renderFriendsRoles,
    mood: renderFriendsMood,
    notes: renderFriendsExperiencias,
    shop: renderFriendsShop,
    group: renderFriendsGroup,
  };
  Promise.resolve((map[State.friendsTab] || renderFriendsHome)()).catch((e) => alert("Deu ruim: " + (e.message || e)));
}

// Experiências tem duas visões: o feed de fotos (estilo Instagram, padrão) e os achados
// (filme/série/jogo/playlist já existentes) — um toggle no topo alterna entre as duas.
// feed de fotos e achados (filme/série/jogo/playlist) misturados numa lista só, mais nova
// primeiro, cada um com uma etiqueta pequena dizendo se é "Feed" ou "Achado" (referência:
// scroll único estilo Instagram, em vez de duas abas separadas)
async function renderFriendsExperiencias() {
  const view = $("#friends-view");
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const [members, posts, finds] = await Promise.all([
    friends.listGroupMembers(State.friendGroup.id),
    friends.listFeedPosts(State.friendGroup.id),
    friends.listFinds(State.friendGroup.id),
  ]);
  const byId = Object.fromEntries(members.map((m) => [m.user_id, m.display_name]));
  const items = [
    ...posts.map((p) => ({ type: "feed", createdAt: p.created_at, data: p })),
    ...finds.map((f) => ({ type: "achado", createdAt: f.created_at, data: f })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  view.innerHTML = `
    <div class="row" style="gap:8px; margin-bottom:14px;">
      <button class="btn btn-sm" style="flex:1; background:var(--friends-accent); color:var(--on-friends-accent);" id="friends-new-post-btn">+ Postar uma foto</button>
      <button class="btn btn-sm" style="flex:1; background:var(--friends-accent-soft); color:var(--friends-accent-strong);" id="friends-new-find-btn">+ Achado</button>
    </div>
    ${items.length ? items.map((it) => it.type === "feed" ? feedCardHTML(it.data, byId) : findCardHTML(it.data, byId)).join("") : `
      <div class="card" style="text-align:center; padding:28px 20px;">
        <div style="font-size:30px;">📷</div>
        <p class="card-sub" style="margin-bottom:0;">Nada por aqui ainda. Manda a primeira foto ou indica um filme, jogo ou playlist pra turma.</p>
      </div>`}
  `;
  $("#friends-new-post-btn").addEventListener("click", openNewFeedPostModal);
  $("#friends-new-find-btn").addEventListener("click", openNewFindModal);

  view.querySelectorAll(".feed-card-photo").forEach((el) => {
    const post = posts.find((p) => p.id === el.dataset.postId);
    friends.feedPhotoUrl(post.photo_path).then((url) => { el.style.backgroundImage = `url(${url})`; }).catch(() => {});
  });
  view.querySelectorAll("[data-open-post]").forEach((el) => {
    const post = posts.find((p) => p.id === el.dataset.openPost);
    el.addEventListener("click", () => openFeedPostDetail(post, byId));
  });
  view.querySelectorAll(".find-photo").forEach((el) => {
    friends.feedPhotoUrl(el.dataset.photoPath).then((url) => { el.style.backgroundImage = `url(${url})`; }).catch(() => {});
  });

  view.querySelectorAll("[data-react]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      view.querySelectorAll("[data-react]").forEach((b) => { b.disabled = true; });
      try {
        // tocar de novo na reação já ativa remove ela; senão troca pra essa
        if (btn.dataset.wasActive === "1") await friends.clearMyFindReaction(btn.dataset.findId, State.userId);
        else await friends.setMyFindReaction(btn.dataset.findId, State.userId, btn.dataset.react);
        await renderFriendsExperiencias();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        await renderFriendsExperiencias();
      }
    });
  });
  view.querySelectorAll("[data-delete-find]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Apagar esse achado?")) return;
      btn.disabled = true;
      try {
        await friends.deleteFind(btn.dataset.deleteFind, btn.dataset.photoPath || null);
        await renderFriendsExperiencias();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
  view.querySelectorAll("[data-toggle-comments]").forEach((btn) => {
    btn.addEventListener("click", () => toggleFindComments(btn.dataset.toggleComments, byId));
  });
}

function renderFriendsPlaceholder(icon, title, text) {
  $("#friends-view").innerHTML = `
    <div class="card" style="text-align:center; padding:32px 20px;">
      <div style="font-size:34px;">${icon}</div>
      <div class="card-title" style="margin-top:8px;">${escapeHTML(title)}</div>
      <p class="card-sub" style="margin-bottom:0;">${escapeHTML(text)}</p>
    </div>
  `;
}

// moods do casal que não fazem sentido pra uma turma de amigos (tom romântico) ficam de fora aqui
const FRIENDS_MOODS = MOODS.filter((m) => !["apaixonada", "safadinha", "carinhosa"].includes(m.id));

function daysUntil(dateISO) {
  return Math.round((parseISODate(dateISO) - startOfDay(new Date())) / 86400000);
}

function eventDateLine(ev) {
  return humanDateLong(parseISODate(ev.start_date)) + (ev.start_time ? `, ${ev.start_time.slice(0, 5)}` : "");
}

function rsvpAvatarsHTML(rsvps, byId) {
  const confirmed = (rsvps || []).filter((r) => r.status === "sim");
  const shown = confirmed.slice(0, 3);
  const extra = confirmed.length - shown.length;
  const chip = (label, i) => `<span style="width:26px; height:26px; border-radius:50%; background:rgba(255,255,255,.9); color:var(--friends-accent-strong); font-family:'Baloo 2'; font-weight:700; font-size:11px; display:flex; align-items:center; justify-content:center; border:2px solid rgba(255,255,255,.5); ${i > 0 ? "margin-left:-10px;" : ""}">${escapeHTML(label)}</span>`;
  if (!confirmed.length) return `<p style="font-size:12.5px; opacity:.85; margin:0;">Ninguém confirmou ainda.</p>`;
  return `<div style="display:flex; gap:0;">
    ${shown.map((r, i) => chip((byId[r.user_id] || "?")[0].toUpperCase(), i)).join("")}
    ${extra > 0 ? chip(`+${extra}`, 1) : ""}
  </div>`;
}

function nextRoleHeroHTML(event, byId) {
  const days = daysUntil(event.start_date);
  const dayLabel = days <= 0 ? "hoje" : days === 1 ? "amanhã" : `${days} dias`;
  return `
    <div class="card" style="background:linear-gradient(135deg, var(--friends-accent-strong), var(--friends-accent)); color:var(--on-friends-accent); cursor:pointer;" id="friends-home-role-card">
      <div style="font-size:12.5px; font-weight:800; letter-spacing:.04em; text-transform:uppercase;">Próximo rolê</div>
      <div style="font-family:'Baloo 2'; font-weight:800; font-size:${days <= 1 ? "26px" : "34px"}; margin:2px 0;">${days <= 1 ? dayLabel : `${days} <span style="font-family:'Nunito'; font-weight:700; font-size:15px;">dias</span>`}</div>
      <div style="font-size:14px; font-weight:700; margin-bottom:2px;">${escapeHTML(event.title)}</div>
      <div style="font-size:12.5px; opacity:.9; margin-bottom:10px;">${escapeHTML(eventDateLine(event))}</div>
      ${rsvpAvatarsHTML(event.friend_event_rsvps, byId)}
    </div>`;
}

function emptyRoleHeroHTML() {
  return `
    <div class="card" style="text-align:center; padding:28px 20px; cursor:pointer;" id="friends-home-role-card">
      <div style="font-size:30px;">👥</div>
      <div class="card-title" style="margin-top:6px;">Nenhum rolê marcado</div>
      <p class="card-sub" style="margin-bottom:0;">Toque pra marcar o próximo encontro da turma.</p>
    </div>`;
}

async function renderFriendsHome() {
  const view = $("#friends-view");
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const today = todayISO();
  const [members, todaysMoods, balance, nextEvents] = await Promise.all([
    friends.listGroupMembers(State.friendGroup.id),
    friends.getMoodsForDay(State.friendGroup.id, today).catch(() => []),
    friends.getGroupCoinBalance(State.friendGroup.id).catch(() => 0),
    friends.listUpcomingEvents(State.friendGroup.id, today, 1).catch(() => []),
  ]);
  const moodByUser = Object.fromEntries(todaysMoods.map((m) => [m.user_id, m.mood]));
  const myMood = moodByUser[State.userId];
  const byId = Object.fromEntries(members.map((m) => [m.user_id, m.display_name]));

  view.innerHTML = `
    ${nextEvents[0] ? nextRoleHeroHTML(nextEvents[0], byId) : emptyRoleHeroHTML()}

    <div class="card" style="margin-top:14px; cursor:pointer;" id="friends-home-mood-card">
      <div class="card-title" style="font-size:15px;">Como a turma tá hoje</div>
      <div class="row" style="gap:8px; margin-top:10px; flex-wrap:wrap;">
        ${members.map((m) => {
          const mood = moodByUser[m.user_id];
          const info = mood ? MOOD_BY_ID[mood] : null;
          return `
            <div style="flex:1; min-width:64px; text-align:center; background:var(--friends-accent-soft); border-radius:14px; padding:10px 6px;">
              <div style="font-size:24px;">${info ? info.emoji : "🤔"}</div>
              <div style="font-size:11px; font-weight:800; margin-top:2px;">${m.user_id === State.userId ? "Você" : escapeHTML(m.display_name)}</div>
            </div>`;
        }).join("")}
      </div>
      <p class="hint-text" style="margin-top:10px; margin-bottom:0;">${myMood ? "Toque pra ver ou mudar seu humor de hoje." : "Toque pra contar como você tá hoje."}</p>
    </div>

    <div class="card" style="margin-top:14px; position:relative; padding-top:26px;">
      <span style="position:absolute; top:-14px; left:16px; background:var(--friends-accent-strong); color:var(--on-friends-accent); font-size:11.5px; font-weight:800; padding:6px 12px; border-radius:999px;">Desafio da semana</span>
      <p class="card-sub" style="margin-bottom:0;">Em breve: um desafio novo toda semana pra turma participar junto.</p>
    </div>

    <div class="row" style="gap:12px; margin-top:14px;">
      <div class="card" style="flex:1; text-align:center; padding:16px 10px;">
        <div style="font-family:'Baloo 2'; font-weight:800; font-size:22px; color:var(--friends-accent-strong);">${balance}</div>
        <div class="hint-text" style="margin:0;">moedas da turma</div>
      </div>
      <div class="card" style="flex:1; text-align:center; padding:16px 10px;">
        <div style="font-family:'Baloo 2'; font-weight:800; font-size:22px; color:var(--friends-accent-strong);">${members.length}</div>
        <div class="hint-text" style="margin:0;">na turma</div>
      </div>
    </div>
  `;
  $("#friends-home-mood-card")?.addEventListener("click", () => setFriendsTab("mood"));
  $("#friends-home-role-card")?.addEventListener("click", () => setFriendsTab("roles"));
}

async function renderFriendsMood() {
  const view = $("#friends-view");
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const today = todayISO();
  const [members, todaysMoods] = await Promise.all([
    friends.listGroupMembers(State.friendGroup.id),
    friends.getMoodsForDay(State.friendGroup.id, today).catch(() => []),
  ]);
  const moodByUser = Object.fromEntries(todaysMoods.map((m) => [m.user_id, m.mood]));
  const myMood = moodByUser[State.userId];

  view.innerHTML = `
    <div class="section-title">Humor de hoje</div>
    <div class="card">
      <div class="stack">
        ${members.map((m) => {
          const mood = moodByUser[m.user_id];
          const info = mood ? MOOD_BY_ID[mood] : null;
          const needsCare = mood && m.user_id !== State.userId && NEEDS_CARE_MOODS.has(mood);
          return `
            <div class="entry-item">
              <div class="entry-icon">${info ? info.emoji : "🤔"}</div>
              <div class="entry-body">
                <div class="entry-title">${m.user_id === State.userId ? "Você" : escapeHTML(m.display_name)}</div>
                <div class="entry-meta">${info ? escapeHTML(gen(info.label, "homem")) : "ainda não registrou"}</div>
              </div>
              ${needsCare ? `<button class="btn btn-ghost btn-sm" data-nudge="${m.user_id}" data-nudge-name="${escapeHTML(m.display_name)}">👋 Mandar um alô</button>` : ""}
            </div>`;
        }).join("")}
      </div>
    </div>
    <button class="btn btn-block" style="margin-top:14px; background:var(--friends-accent); color:var(--on-friends-accent);" id="friends-set-mood-btn">${myMood ? "Mudar meu humor de hoje" : "Contar como você tá hoje"}</button>
  `;
  $("#friends-set-mood-btn").addEventListener("click", () => openFriendsMoodPicker(myMood));
  view.querySelectorAll("[data-nudge]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await friends.createFind(State.friendGroup.id, State.userId, "recado", `👋 pra ${btn.dataset.nudgeName}`, "", "Alguém da turma tá pensando em você hoje.");
        btn.textContent = "Enviado 💙";
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

function openFriendsMoodPicker(current) {
  openModal(`
    <h3 class="modal-title">🙂 Como você tá hoje?</h3>
    <div class="mood-grid">
      ${FRIENDS_MOODS.map((m) => `<button class="mood-btn" ${m.id === current ? `style="border-color:var(--friends-accent); background:var(--friends-accent-soft);"` : ""} data-mood="${m.id}"><span class="emoji">${m.emoji}</span><span class="label">${escapeHTML(gen(m.label, "homem"))}</span></button>`).join("")}
    </div>
  `);
  $("#modal-sheet").querySelectorAll("[data-mood]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await friends.setMyMood(State.friendGroup.id, todayISO(), State.userId, btn.dataset.mood);
        closeModal();
        await renderFriendsMood();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

// ================= EXPERIÊNCIAS (achados: filme/série/jogo/playlist/recado) =================
// no espírito do Letterboxd/Goodreads: prateleira de gosto compartilhado, não um chat.
// Reação leve (quero ver / já vi / recomendo) fica antes do comentário, que é sempre opcional.

const FRIEND_FIND_KINDS = {
  filme: { emoji: "🎬", label: "Filme" },
  serie: { emoji: "📺", label: "Série" },
  jogo: { emoji: "🎮", label: "Jogo" },
  playlist: { emoji: "🎵", label: "Playlist" },
  recado: { emoji: "💬", label: "Recado" },
};

const FRIEND_FIND_REACTIONS = {
  quero: { emoji: "👀", label: "Quero ver" },
  ja_vi: { emoji: "✅", label: "Já vi" },
  recomendo: { emoji: "🔥", label: "Recomendo" },
};

function findCardHTML(f, byId) {
  const kind = FRIEND_FIND_KINDS[f.kind] || FRIEND_FIND_KINDS.recado;
  const reactions = f.friend_find_reactions || [];
  const mine = reactions.find((r) => r.user_id === State.userId)?.reaction;
  const counts = {};
  reactions.forEach((r) => { counts[r.reaction] = (counts[r.reaction] || 0) + 1; });
  return `
    <div class="card" style="margin-bottom:12px;">
      ${f.photo_path ? `<div class="find-photo" data-photo-path="${escapeHTML(f.photo_path)}" style="aspect-ratio:1; border-radius:12px; background:var(--surface-alt) center/cover; margin-bottom:10px;"></div>` : ""}
      <span style="display:inline-block; background:var(--friends-accent-soft); color:var(--friends-accent-strong); font-size:10px; font-weight:800; padding:2px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:.03em; margin-bottom:6px;">🎬 Achado</span>
      <div class="row" style="align-items:flex-start;">
        <span style="font-size:24px;">${kind.emoji}</span>
        <div style="flex:1;">
          <div class="card-title" style="font-size:15px; margin-bottom:2px;">${escapeHTML(f.title)}</div>
          <div class="hint-text" style="margin:0;">${kind.label} · ${f.user_id === State.userId ? "Você" : escapeHTML(byId[f.user_id] || "alguém")}</div>
          ${f.link ? `<a href="${escapeHTML(f.link)}" target="_blank" rel="noopener" style="font-size:13px; word-break:break-all;">${escapeHTML(f.link)}</a>` : ""}
          ${f.note ? `<p class="card-sub" style="margin:6px 0 0;">${escapeHTML(f.note)}</p>` : ""}
        </div>
        ${f.user_id === State.userId ? `<button class="btn btn-ghost btn-sm" style="padding:4px 8px;" data-delete-find="${f.id}" data-photo-path="${escapeHTML(f.photo_path || "")}">Apagar</button>` : ""}
      </div>
      <div class="row" style="gap:8px; margin-top:10px;">
        ${Object.entries(FRIEND_FIND_REACTIONS).map(([id, r]) => {
          const active = mine === id;
          const n = counts[id] || 0;
          return `<button class="btn btn-sm" style="flex:1; ${active ? "background:var(--friends-accent); color:var(--on-friends-accent);" : "background:var(--friends-accent-soft); color:var(--friends-accent-strong);"}" data-react="${id}" data-find-id="${f.id}" data-was-active="${active ? "1" : "0"}">${r.emoji} ${r.label}${n ? ` · ${n}` : ""}</button>`;
        }).join("")}
      </div>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px; width:100%;" data-toggle-comments="${f.id}">💬 Comentários</button>
      <div id="find-comments-${f.id}" style="display:none; margin-top:8px;"></div>
    </div>`;
}

function commentRowHTML(c, byId) {
  return `<div style="background:var(--friends-accent-soft); color:var(--friends-accent-strong); border-radius:10px; padding:8px 10px;">
    <div style="font-size:12px; font-weight:800;">${c.user_id === State.userId ? "Você" : escapeHTML(byId[c.user_id] || "alguém")}</div>
    <div style="font-size:13.5px;">${escapeHTML(c.text)}</div>
  </div>`;
}

async function toggleFindComments(findId, byId) {
  const panel = $(`#find-comments-${findId}`);
  if (!panel) return;
  if (panel.style.display !== "none") { panel.style.display = "none"; return; }
  panel.style.display = "block";
  panel.innerHTML = `<div class="hint-text">Carregando...</div>`;
  const comments = await friends.listFindComments(findId).catch(() => []);
  panel.innerHTML = `
    <div class="stack" style="gap:6px;">${comments.map((c) => commentRowHTML(c, byId)).join("") || '<p class="hint-text" style="margin:0;">Nenhum comentário ainda.</p>'}</div>
    <div class="row" style="gap:8px; margin-top:8px;">
      <input type="text" id="fc-input-${findId}" maxlength="300" placeholder="Escreva um comentário..." style="flex:1;" />
      <button class="btn btn-sm" style="background:var(--friends-accent); color:var(--on-friends-accent);" id="fc-send-${findId}">Enviar</button>
    </div>
  `;
  $(`#fc-send-${findId}`).addEventListener("click", async () => {
    const input = $(`#fc-input-${findId}`);
    const text = input.value.trim();
    if (!text) return;
    setBusy(`#fc-send-${findId}`, true);
    try {
      await friends.addFindComment(findId, State.userId, text);
      await toggleFindComments(findId, byId); // fecha
      await toggleFindComments(findId, byId); // reabre já com o comentário novo
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy(`#fc-send-${findId}`, false);
    }
  });
}

// ================= FEED DE FOTOS (Experiências) =================
// tipo Instagram, mas privado da turma: um grupo nunca vê o feed de outro. Post pode ser
// "fofoca" (destaque colorido + hashtag) e pode ser temporário (some da vista de todo mundo
// depois de alguns minutos) ou permanente. Aparece misturado com os achados numa lista só,
// mais nova primeiro (ver renderFriendsExperiencias).

function feedCardHTML(p, byId) {
  const authorName = p.user_id === State.userId ? "Você" : escapeHTML(byId[p.user_id] || "alguém");
  const likeCount = (p.friend_feed_likes || []).length;
  const commentCount = (p.friend_feed_comments || []).length;
  return `
    <div class="card" style="margin-bottom:12px; padding:0; overflow:hidden; cursor:pointer;" data-open-post="${p.id}">
      <div class="feed-card-photo" data-post-id="${p.id}" style="aspect-ratio:1; background:var(--surface-alt) center/cover; position:relative;">
        <span style="position:absolute; top:8px; left:8px; background:${p.is_fofoca ? "var(--friends-accent)" : "rgba(0,0,0,.5)"}; color:#fff; font-size:10px; font-weight:800; padding:3px 9px; border-radius:999px; text-transform:uppercase; letter-spacing:.03em;">${p.is_fofoca ? `🔥 ${escapeHTML(p.hashtag || "fofoca")}` : "📷 Feed"}</span>
      </div>
      <div style="padding:10px 12px;">
        <div style="font-size:12.5px; font-weight:800;">${authorName}</div>
        ${p.caption ? `<div style="font-size:13.5px; margin-top:2px;">${escapeHTML(p.caption)}</div>` : ""}
        <div class="hint-text" style="margin-top:6px;">${likeCount ? `💗 ${likeCount}` : "🤍"}${commentCount ? ` · 💬 ${commentCount}` : ""}</div>
      </div>
    </div>`;
}

function openNewFeedPostModal() {
  openModal(`
    <h3 class="modal-title">📷 Postar uma foto</h3>
    <div class="stack">
      <input type="file" id="fp-file" accept="image/*" style="display:none;" />
      <div id="fp-picker" style="border:2px dashed var(--friends-accent-soft); border-radius:14px; padding:28px 10px; text-align:center; cursor:pointer;">
        <div style="font-size:30px;">📷</div>
        <div class="hint-text" style="margin-top:4px;">Toque pra tirar ou escolher uma foto</div>
      </div>
      <div id="fp-preview" style="display:none; margin:10px 0; cursor:pointer;"><img id="fp-preview-img" style="width:100%; border-radius:12px; max-height:220px; object-fit:cover;" alt="" /><div class="hint-text" style="text-align:center; margin-top:4px;">Toque pra trocar a foto</div></div>
      <label class="field-label">Legenda (opcional)</label>
      <input type="text" id="fp-caption" maxlength="120" placeholder="o que tá rolando" />
      <div class="row" style="align-items:center; gap:8px; margin-top:8px;">
        <input type="checkbox" id="fp-fofoca" style="width:auto;" />
        <label for="fp-fofoca" style="margin:0; font-size:13.5px; font-weight:700;">🔥 É uma fofoca?</label>
      </div>
      <input type="text" id="fp-hashtag" maxlength="30" placeholder="hashtag da fofoca" style="display:none; margin-top:8px;" />
      <label class="field-label" style="margin-top:10px;">Quanto tempo fica no ar?</label>
      <div class="row" style="gap:8px;" id="fp-duration-row">
        <button type="button" class="btn btn-sm" style="flex:1; background:var(--friends-accent-soft); color:var(--friends-accent-strong);" data-duration="permanent">Pra sempre</button>
        <button type="button" class="btn btn-sm" style="flex:1;" data-duration="temp">Só 2 minutos</button>
      </div>
      <button class="btn btn-block" style="margin-top:14px; background:var(--friends-accent); color:var(--on-friends-accent);" id="fp-confirm">Postar</button>
      <p class="error-text" id="fp-error"></p>
    </div>
  `);
  let selectedBlob = null;
  let duration = "permanent";
  $("#fp-picker").addEventListener("click", () => $("#fp-file").click());
  $("#fp-preview").addEventListener("click", () => $("#fp-file").click());
  $("#fp-file").addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      selectedBlob = await compressImage(file, 1080);
      $("#fp-preview-img").src = URL.createObjectURL(selectedBlob);
      $("#fp-picker").style.display = "none";
      $("#fp-preview").style.display = "";
    } catch (e) {
      $("#fp-error").textContent = "Não deu pra usar essa foto: " + (e.message || e);
    }
  });
  $("#fp-fofoca").addEventListener("change", (ev) => {
    $("#fp-hashtag").style.display = ev.target.checked ? "" : "none";
  });
  $("#fp-duration-row").querySelectorAll("[data-duration]").forEach((b) => {
    b.addEventListener("click", () => {
      duration = b.dataset.duration;
      $("#fp-duration-row").querySelectorAll("[data-duration]").forEach((x) => {
        const active = x.dataset.duration === duration;
        x.style.background = active ? "var(--friends-accent-soft)" : "";
        x.style.color = active ? "var(--friends-accent-strong)" : "";
      });
    });
  });
  $("#fp-confirm").addEventListener("click", async () => {
    const err = (m) => { $("#fp-error").textContent = m; };
    if (!selectedBlob) return err("Escolhe uma foto primeiro.");
    const isFofoca = $("#fp-fofoca").checked;
    const hashtag = $("#fp-hashtag").value.trim();
    if (isFofoca && !hashtag) return err("Coloca uma hashtag pra fofoca.");
    setBusy("#fp-confirm", true);
    try {
      const expiresAt = duration === "temp" ? new Date(Date.now() + 2 * 60 * 1000).toISOString() : null;
      await friends.createFeedPost(State.friendGroup.id, State.userId, selectedBlob, $("#fp-caption").value.trim(), isFofoca, isFofoca ? hashtag : null, expiresAt);
      closeModal();
      await renderFriendsExperiencias();
    } catch (e) {
      err("Não deu: " + (e.message || e));
      setBusy("#fp-confirm", false);
    }
  });
}

async function openFeedPostDetail(post, byId) {
  const authorName = post.user_id === State.userId ? "Você" : (byId[post.user_id] || "alguém");
  const likes = post.friend_feed_likes || [];
  const iLiked = likes.some((l) => l.user_id === State.userId);
  openModal(`
    <h3 class="modal-title" style="margin-bottom:6px;">${post.is_fofoca ? `🔥 ${escapeHTML(post.hashtag || "fofoca")}` : "📷 Foto"}</h3>
    <div style="border-radius:14px; overflow:hidden; background:var(--surface-alt); aspect-ratio:1; margin-bottom:10px;">
      <img id="fpd-img" style="width:100%; height:100%; object-fit:cover;" alt="" />
    </div>
    <p style="font-size:13px; font-weight:800; margin:0 0 2px;">${escapeHTML(authorName)}</p>
    ${post.caption ? `<p class="card-sub" style="margin:0 0 10px;">${escapeHTML(post.caption)}</p>` : ""}
    <div class="row" style="gap:8px;">
      <button class="btn btn-sm" style="flex:1; ${iLiked ? "background:var(--friends-accent); color:var(--on-friends-accent);" : "background:var(--friends-accent-soft); color:var(--friends-accent-strong);"}" id="fpd-like">${iLiked ? `💗 Curtido${likes.length ? ` · ${likes.length}` : ""}` : `🤍 Curtir${likes.length ? ` · ${likes.length}` : ""}`}</button>
      ${post.user_id === State.userId ? `<button class="btn btn-ghost btn-sm" id="fpd-delete">Apagar</button>` : ""}
    </div>
    <div id="fpd-comments" style="margin-top:14px;"></div>
  `);
  friends.feedPhotoUrl(post.photo_path).then((url) => { $("#fpd-img").src = url; }).catch(() => {});
  $("#fpd-like").addEventListener("click", async () => {
    $("#fpd-like").disabled = true;
    try {
      if (iLiked) await friends.unlikeFeedPost(post.id, State.userId);
      else await friends.likeFeedPost(post.id, State.userId);
      closeModal();
      await renderFriendsExperiencias();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
    }
  });
  $("#fpd-delete")?.addEventListener("click", async () => {
    if (!confirm("Apagar essa foto?")) return;
    try {
      await friends.deleteFeedPost(post.id, post.photo_path);
      closeModal();
      await renderFriendsExperiencias();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
    }
  });
  const comments = await friends.listFeedComments(post.id).catch(() => []);
  $("#fpd-comments").innerHTML = `
    <p class="field-label">Comentários</p>
    <div class="stack" style="gap:6px;">${comments.map((c) => commentRowHTML(c, byId)).join("") || '<p class="hint-text" style="margin:0;">Seja o primeiro a comentar.</p>'}</div>
    <div class="row" style="gap:8px; margin-top:8px;">
      <input type="text" id="fpd-comment-input" maxlength="300" placeholder="Escreva um comentário" style="flex:1;" />
      <button class="btn btn-sm" style="background:var(--friends-accent); color:var(--on-friends-accent);" id="fpd-comment-send">Enviar</button>
    </div>
  `;
  $("#fpd-comment-send").addEventListener("click", async () => {
    const input = $("#fpd-comment-input");
    const text = input.value.trim();
    if (!text) return;
    setBusy("#fpd-comment-send", true);
    try {
      await friends.addFeedComment(post.id, State.userId, text);
      const fresh = await friends.listFeedComments(post.id);
      $("#fpd-comments .stack").innerHTML = fresh.map((c) => commentRowHTML(c, byId)).join("");
      input.value = "";
    } catch (e) {
      alert("Não deu: " + (e.message || e));
    } finally {
      setBusy("#fpd-comment-send", false);
    }
  });
}

function openNewFindModal() {
  openModal(`
    <h3 class="modal-title">🎬 Compartilhar um achado</h3>
    <div class="stack">
      <label class="field-label">O que é?</label>
      <div class="row" style="gap:6px; flex-wrap:wrap;" id="ff-kind-row">
        ${Object.entries(FRIEND_FIND_KINDS).map(([id, k], i) => `<button type="button" class="btn ${i === 0 ? "" : "btn-ghost"} btn-sm" style="flex:1; min-width:70px; ${i === 0 ? "background:var(--friends-accent-soft); color:var(--friends-accent-strong);" : ""}" data-kind="${id}">${k.emoji} ${k.label}</button>`).join("")}
      </div>
      <label class="field-label">Título</label>
      <input type="text" id="ff-title" maxlength="80" placeholder="ex: Sinta a Música, playlist de sexta..." />
      <label class="field-label">Link (opcional)</label>
      <input type="text" id="ff-link" maxlength="300" placeholder="cola o link do Spotify, IMDb..." />
      <label class="field-label">Comentário (opcional)</label>
      <textarea id="ff-note" maxlength="200" rows="2" placeholder="por que a turma tem que ver/ouvir isso"></textarea>
      <label class="field-label">Foto (opcional)</label>
      <input type="file" id="ff-file" accept="image/*" style="display:none;" />
      <div id="ff-picker" style="border:2px dashed var(--friends-accent-soft); border-radius:14px; padding:20px 10px; text-align:center; cursor:pointer;">
        <div style="font-size:24px;">📷</div>
        <div class="hint-text" style="margin-top:2px;">Toque pra tirar ou escolher uma foto</div>
      </div>
      <div id="ff-preview" style="display:none; margin:6px 0; cursor:pointer;"><img id="ff-preview-img" style="width:100%; border-radius:12px; max-height:180px; object-fit:cover;" alt="" /></div>
      <button class="btn btn-block" style="margin-top:6px; background:var(--friends-accent); color:var(--on-friends-accent);" id="ff-confirm">Compartilhar</button>
      <p class="error-text" id="ff-error"></p>
    </div>
  `);
  let kind = "filme";
  let selectedBlob = null;
  $("#ff-kind-row").querySelectorAll("[data-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      kind = btn.dataset.kind;
      $("#ff-kind-row").querySelectorAll("[data-kind]").forEach((b) => {
        b.className = `btn ${b.dataset.kind === kind ? "" : "btn-ghost"} btn-sm`;
        b.style.cssText = `flex:1; min-width:70px; ${b.dataset.kind === kind ? "background:var(--friends-accent-soft); color:var(--friends-accent-strong);" : ""}`;
      });
    });
  });
  $("#ff-picker").addEventListener("click", () => $("#ff-file").click());
  $("#ff-preview").addEventListener("click", () => $("#ff-file").click());
  $("#ff-file").addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      selectedBlob = await compressImage(file, 1080);
      $("#ff-preview-img").src = URL.createObjectURL(selectedBlob);
      $("#ff-picker").style.display = "none";
      $("#ff-preview").style.display = "";
    } catch (e) {
      $("#ff-error").textContent = "Não deu pra usar essa foto: " + (e.message || e);
    }
  });
  $("#ff-confirm").addEventListener("click", async () => {
    const title = $("#ff-title").value.trim();
    const link = $("#ff-link").value.trim();
    const note = $("#ff-note").value.trim();
    const err = (m) => { $("#ff-error").textContent = m; };
    if (!title) return err("Escreve um título.");
    setBusy("#ff-confirm", true);
    try {
      await friends.createFind(State.friendGroup.id, State.userId, kind, title, link, note, selectedBlob);
      closeModal();
      await renderFriendsExperiencias();
    } catch (e) {
      err("Não deu: " + (e.message || e));
      setBusy("#ff-confirm", false);
    }
  });
}

function rsvpButtonHTML(eventId, status, label, mine) {
  const active = mine === status;
  return `<button class="btn btn-sm" style="flex:1; ${active ? "background:var(--friends-accent); color:var(--on-friends-accent);" : "background:var(--friends-accent-soft); color:var(--friends-accent-strong);"}" data-rsvp="${status}" data-event-id="${eventId}">${label}</button>`;
}

const FRIEND_EVENT_CATEGORIES = {
  amigos: { emoji: "👥", label: "Rolê" },
  trabalho: { emoji: "💼", label: "Trabalho" },
  outro: { emoji: "📌", label: "Outro" },
};

function friendsEntriesOnDay(dateISO) {
  return (State.friendsCalendarEvents || []).filter((e) => e.start_date === dateISO);
}

function friendEventDetailItemHTML(ev, byId) {
  const cat = FRIEND_EVENT_CATEGORIES[ev.category] || FRIEND_EVENT_CATEGORIES.outro;
  const rsvps = ev.friend_event_rsvps || [];
  const mine = rsvps.find((r) => r.user_id === State.userId)?.status;
  // quem confirmou primeiro aparece primeiro — reforça o "efeito bola de neve" de ver gente confirmando
  const going = rsvps.filter((r) => r.status === "sim").sort((a, b) => (a.updated_at || "").localeCompare(b.updated_at || ""));
  const goingNames = going.map((r) => (r.user_id === State.userId ? "Você" : byId[r.user_id] || "alguém")).join(", ");
  const invitedIds = ev.invited_user_ids;
  const isLimited = Array.isArray(invitedIds) && invitedIds.length > 0;
  const imInvited = isLimited && invitedIds.includes(State.userId);
  const invitedNames = isLimited ? invitedIds.map((uid) => (uid === State.userId ? "Você" : byId[uid] || "alguém")).join(", ") : "";
  return `
    <div class="entry-item" style="flex-direction:column; align-items:stretch;">
      ${imInvited ? `<span style="align-self:flex-start; background:var(--friends-accent); color:var(--on-friends-accent); font-size:11px; font-weight:800; padding:3px 9px; border-radius:999px; margin-bottom:6px;">🔖 Você foi chamado(a) especialmente</span>` : ""}
      <div class="row" style="align-items:flex-start;">
        <div class="entry-icon">${cat.emoji}</div>
        <div class="entry-body">
          <div class="entry-title">${escapeHTML(ev.title)}</div>
          <div class="entry-meta">${cat.label}${ev.start_time ? ` · ${ev.start_time.slice(0, 5)}` : ""}</div>
          ${ev.details ? `<div class="hint-text" style="margin-top:4px;">${escapeHTML(ev.details)}</div>` : ""}
          ${isLimited ? `<div class="hint-text" style="margin-top:4px;">Chamados: ${escapeHTML(invitedNames)}</div>` : ""}
        </div>
        ${ev.created_by === State.userId ? `<button class="btn btn-ghost btn-sm" style="padding:4px 8px;" data-delete-event="${ev.id}">Cancelar</button>` : ""}
      </div>
      <p class="hint-text" style="margin:6px 0 0;">${going.length ? `${going.length} confirmado${going.length === 1 ? "" : "s"}: ${escapeHTML(goingNames)}` : "Ninguém confirmou ainda."}</p>
      <div class="row" style="gap:8px; margin-top:8px;">
        ${rsvpButtonHTML(ev.id, "sim", "Vou", mine)}
        ${rsvpButtonHTML(ev.id, "talvez", "Talvez", mine)}
        ${rsvpButtonHTML(ev.id, "nao", "Não vou", mine)}
      </div>
    </div>`;
}

function buildFriendsDayGrid(byId) {
  const grid = $("#friends-day-grid");
  const month = State.friendsCalendarMonth;
  const total = daysInMonth(month);
  const firstDow = mondayIndex(startOfMonth(month));
  const leading = (firstDow + 1) % 7;
  let html = "";
  for (let i = 0; i < leading; i++) html += `<div class="day-cell empty"></div>`;
  for (let day = 1; day <= total; day++) {
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    const iso = toISODate(date);
    const entries = friendsEntriesOnDay(iso);
    const isToday = isSameDate(date, new Date());
    const isSelected = iso === State.friendsSelectedDay;
    const dots = entries.slice(0, 3).map((e) => (FRIEND_EVENT_CATEGORIES[e.category] || FRIEND_EVENT_CATEGORIES.outro).emoji).join("");
    const style = [isToday ? "outline:2px solid var(--friends-accent); outline-offset:-2px;" : "", isSelected ? "background:var(--friends-accent-soft);" : ""].join(" ");
    html += `<button class="day-cell" style="${style}" data-date="${iso}"><span class="num">${day}</span><span class="dots">${dots}</span></button>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll(".day-cell:not(.empty)").forEach((cell) => {
    cell.addEventListener("click", () => showFriendsDayDetail(cell.dataset.date, byId));
  });
}

function showFriendsDayDetail(iso, byId) {
  State.friendsSelectedDay = iso;
  document.querySelectorAll("#friends-day-grid .day-cell").forEach((c) => {
    c.style.background = c.dataset.date === iso ? "var(--friends-accent-soft)" : "";
  });
  const entries = friendsEntriesOnDay(iso);
  const entriesHTML = entries.length ? entries.map((e) => friendEventDetailItemHTML(e, byId)).join("") : `
    <div class="empty-state"><span class="emoji">🗓️</span>Nada marcado nesse dia ainda.</div>
  `;
  $("#friends-day-detail").innerHTML = `
    <div class="card">
      <div class="card-title">${humanDateLong(parseISODate(iso))}</div>
      <div class="stack" id="friends-entries-list">${entriesHTML}</div>
      <button class="btn btn-block" style="margin-top:14px; background:var(--friends-accent); color:var(--on-friends-accent);" id="friends-add-event-day-btn">+ Marcar um rolê</button>
    </div>
  `;
  $("#friends-add-event-day-btn").addEventListener("click", () => openNewEventModal(iso, byId));
  wireFriendsEventDetailActions(byId);
}

function wireFriendsEventDetailActions(byId) {
  const container = $("#friends-day-detail");
  container.querySelectorAll("[data-rsvp]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      container.querySelectorAll("[data-rsvp], [data-delete-event]").forEach((b) => { b.disabled = true; });
      try {
        await friends.setMyRsvp(btn.dataset.eventId, State.userId, btn.dataset.rsvp);
        await reloadFriendsCalendar(byId);
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        await reloadFriendsCalendar(byId);
      }
    });
  });
  container.querySelectorAll("[data-delete-event]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Cancelar esse rolê?")) return;
      btn.disabled = true;
      try {
        await friends.deleteEvent(btn.dataset.deleteEvent);
        await reloadFriendsCalendar(byId);
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

async function reloadFriendsCalendar(byId) {
  const month = State.friendsCalendarMonth;
  const monthStart = toISODate(startOfMonth(month));
  const monthEnd = toISODate(startOfMonth(addMonths(month, 1)));
  State.friendsCalendarEvents = await friends.listEventsForMonth(State.friendGroup.id, monthStart, monthEnd);
  buildFriendsDayGrid(byId);
  if (State.friendsSelectedDay) showFriendsDayDetail(State.friendsSelectedDay, byId);
}

async function renderFriendsRoles() {
  const view = $("#friends-view");
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const month = State.friendsCalendarMonth;
  const monthStart = toISODate(startOfMonth(month));
  const monthEnd = toISODate(startOfMonth(addMonths(month, 1)));
  const [members, events] = await Promise.all([
    friends.listGroupMembers(State.friendGroup.id),
    friends.listEventsForMonth(State.friendGroup.id, monthStart, monthEnd),
  ]);
  State.friendsCalendarEvents = events;
  const byId = Object.fromEntries(members.map((m) => [m.user_id, m.display_name]));

  view.innerHTML = `
    <div class="month-nav">
      <button id="friends-prev-month">${icon("chevron-left", { size: 18 })}</button>
      <h2>${monthLabel(monthKey(month))}</h2>
      <button id="friends-next-month">${icon("chevron-right", { size: 18 })}</button>
    </div>
    <div class="card">
      <div class="weekday-row"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div>
      <div class="day-grid" id="friends-day-grid"></div>
      <div class="legend">
        <span>👥 rolê</span><span>💼 trabalho</span><span>📌 outro</span>
      </div>
    </div>
    <div id="friends-day-detail"></div>
  `;
  buildFriendsDayGrid(byId);
  if (State.friendsSelectedDay) showFriendsDayDetail(State.friendsSelectedDay, byId);
  $("#friends-prev-month").addEventListener("click", () => {
    State.friendsCalendarMonth = addMonths(State.friendsCalendarMonth, -1);
    State.friendsSelectedDay = null;
    renderFriendsRoles();
  });
  $("#friends-next-month").addEventListener("click", () => {
    State.friendsCalendarMonth = addMonths(State.friendsCalendarMonth, 1);
    State.friendsSelectedDay = null;
    renderFriendsRoles();
  });
  maybeShowInvitePopup(events);
}

const INVITE_SEEN_KEY = "friendsInvitesSeen";

function getSeenInviteIds() {
  try { return new Set(JSON.parse(localStorage.getItem(INVITE_SEEN_KEY) || "[]")); } catch (e) { return new Set(); }
}

function markInvitesSeen(ids) {
  try {
    const seen = getSeenInviteIds();
    ids.forEach((id) => seen.add(id));
    localStorage.setItem(INVITE_SEEN_KEY, JSON.stringify([...seen]));
  } catch (e) { /* sem storage: só volta a aparecer */ }
}

// pop-up assim que entra na aba Rolês, se tiver algum rolê marcado especialmente pra você
// que ainda não viu — em vez de só um selo escondido dentro do dia
function maybeShowInvitePopup(events) {
  const seen = getSeenInviteIds();
  const todayIso = todayISO();
  const mine = (events || []).filter((e) =>
    Array.isArray(e.invited_user_ids) && e.invited_user_ids.includes(State.userId) &&
    e.start_date >= todayIso && !seen.has(e.id)
  );
  if (!mine.length) return;
  openModal(`
    <h3 class="modal-title">🔖 Você foi chamado(a)!</h3>
    <div class="stack">
      ${mine.map((e) => `<div class="card" style="padding:12px;"><div style="font-weight:800;">${escapeHTML(e.title)}</div><div class="hint-text" style="margin:0;">${escapeHTML(eventDateLine(e))}</div></div>`).join("")}
    </div>
    <button class="btn btn-block" style="margin-top:14px; background:var(--friends-accent); color:var(--on-friends-accent);" id="invite-popup-ok">Combinado</button>
  `);
  $("#invite-popup-ok").addEventListener("click", () => {
    markInvitesSeen(mine.map((e) => e.id));
    closeModal();
  });
}

function openNewEventModal(dateISO, byId) {
  const date = dateISO || todayISO();
  openModal(`
    <h3 class="modal-title">📅 Marcar um rolê</h3>
    <div class="stack">
      <label class="field-label">O que vai rolar?</label>
      <input type="text" id="fe-title" maxlength="60" placeholder="ex: churrasco na casa do Duda" />
      <label class="field-label">Categoria</label>
      <div class="row" style="gap:8px;" id="fe-category-row">
        ${Object.entries(FRIEND_EVENT_CATEGORIES).map(([id, c], i) => `<button type="button" class="btn ${i === 0 ? "" : "btn-ghost"} btn-sm" style="flex:1; ${i === 0 ? "background:var(--friends-accent-soft); color:var(--friends-accent-strong);" : ""}" data-category="${id}">${c.emoji} ${c.label}</button>`).join("")}
      </div>
      <label class="field-label">Quando?</label>
      <input type="date" id="fe-date" min="${todayISO()}" value="${date}" />
      <label class="field-label">Hora (opcional)</label>
      <input type="time" id="fe-time" />
      <label class="field-label">Detalhes (opcional)</label>
      <textarea id="fe-details" maxlength="200" rows="2" placeholder="endereço, o que levar..."></textarea>
      <label class="field-label">Quem você quer chamar?</label>
      <p class="hint-text" style="margin:-2px 0 6px;">O rolê fica visível pra turma toda de qualquer jeito, isso só destaca pra quem foi chamado.</p>
      <div class="row" style="gap:6px; flex-wrap:wrap;" id="fe-invite-row">
        ${Object.entries(byId || {}).map(([uid, name]) => `<button type="button" class="btn btn-sm" style="background:var(--friends-accent-soft); color:var(--friends-accent-strong);" data-invite="${uid}">${escapeHTML(uid === State.userId ? "Você" : name)}</button>`).join("")}
      </div>
      <button class="btn btn-block" style="margin-top:6px; background:var(--friends-accent); color:var(--on-friends-accent);" id="fe-confirm">Marcar</button>
      <p class="error-text" id="fe-error"></p>
    </div>
  `);
  let category = "amigos";
  const allUserIds = Object.keys(byId || {});
  const invited = new Set(allUserIds); // começa com todo mundo marcado
  $("#fe-invite-row").querySelectorAll("[data-invite]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = btn.dataset.invite;
      if (invited.has(uid)) invited.delete(uid); else invited.add(uid);
      btn.style.background = invited.has(uid) ? "var(--friends-accent-soft)" : "";
      btn.style.color = invited.has(uid) ? "var(--friends-accent-strong)" : "";
      btn.style.opacity = invited.has(uid) ? "1" : ".5";
    });
  });
  $("#fe-category-row").querySelectorAll("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      category = btn.dataset.category;
      $("#fe-category-row").querySelectorAll("[data-category]").forEach((b) => {
        b.className = `btn ${b.dataset.category === category ? "" : "btn-ghost"} btn-sm`;
        b.style.cssText = `flex:1; ${b.dataset.category === category ? "background:var(--friends-accent-soft); color:var(--friends-accent-strong);" : ""}`;
      });
    });
  });
  $("#fe-confirm").addEventListener("click", async () => {
    const title = $("#fe-title").value.trim();
    const fdate = $("#fe-date").value;
    const time = $("#fe-time").value;
    const details = $("#fe-details").value.trim();
    const err = (m) => { $("#fe-error").textContent = m; };
    if (!title) return err("Escreve o que vai rolar.");
    if (!fdate) return err("Escolhe a data.");
    if (!invited.size) return err("Chama pelo menos uma pessoa.");
    setBusy("#fe-confirm", true);
    try {
      // todo mundo marcado = mesma coisa que não restringir (lista vazia/nula)
      const invitedIds = invited.size === allUserIds.length ? null : [...invited];
      const created = await friends.createEvent(State.friendGroup.id, State.userId, title, fdate, time || null, category, details, invitedIds);
      await friends.setMyRsvp(created.id, State.userId, "sim").catch(() => {});
      closeModal();
      State.friendsSelectedDay = fdate;
      if (monthKey(State.friendsCalendarMonth) !== fdate.slice(0, 7)) State.friendsCalendarMonth = startOfMonth(parseISODate(fdate));
      await renderFriendsRoles();
    } catch (e) {
      err("Não deu: " + (e.message || e));
      setBusy("#fe-confirm", false);
    }
  });
}

function perkCardHTML(p) {
  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="row" style="align-items:flex-start; gap:10px;">
        <span style="font-size:26px;">${p.emoji}</span>
        <div style="flex:1;">
          <div style="font-weight:800; font-size:14.5px;">${escapeHTML(p.title)}</div>
          <div class="hint-text" style="margin:0;">${escapeHTML(p.sub || p.description || "")}</div>
        </div>
        ${p.created_by === State.userId ? `<button class="btn btn-ghost btn-sm" style="padding:4px 8px;" data-delete-perk="${p.id}">Apagar</button>` : ""}
      </div>
      <button class="btn btn-block" style="margin-top:10px; background:var(--friends-accent-soft); color:var(--friends-accent-strong);" data-redeem="${p.id}">Resgatar (💰 ${p.cost})</button>
    </div>`;
}

async function renderFriendsShop() {
  const view = $("#friends-view");
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const [balance, redemptions, customPerks] = await Promise.all([
    friends.getGroupCoinBalance(State.friendGroup.id).catch(() => 0),
    friends.listGroupRedemptions(State.friendGroup.id).catch(() => []),
    friends.listCustomPerks(State.friendGroup.id).catch(() => []),
  ]);
  const pending = redemptions.filter((r) => r.status === "pendente");
  const allPerks = { ...FRIEND_PERK_BY_ID, ...Object.fromEntries(customPerks.map((p) => [p.id, p])) };

  view.innerHTML = `
    <div class="card" style="display:flex; align-items:center; gap:10px;">
      <span class="icon-badge" style="background:var(--friends-accent-soft); color:var(--friends-accent-strong);">💰</span>
      <div>
        <div style="font-family:'Baloo 2'; font-weight:800; font-size:18px; color:var(--friends-accent-strong);">${balance} moedas</div>
        <div class="hint-text" style="margin:0;">no cofre da turma</div>
      </div>
    </div>

    <div class="section-title">🎮 Games</div>
    <div class="card" id="btn-open-star-battle-friends" style="cursor:pointer;">
      <div class="row" style="align-items:center; gap:10px;">
        <img src="icons/capivarinhas.jpg" alt="Capivarinhas" style="width:48px; height:48px; border-radius:12px; object-fit:cover; flex:none;" />
        <div style="flex:1;">
          <div class="card-title" style="font-size:15px; margin-bottom:0;">Capivarinhas</div>
          <div class="hint-text" style="margin:0;">Quebra-cabeça de lógica · ganha moeda pra turma a cada fase</div>
        </div>
      </div>
    </div>

    ${Object.entries(FRIEND_PERK_CATEGORIES).map(([catId, cat]) => `
      <div class="section-title">${cat.emoji} ${cat.label}</div>
      ${FRIEND_PERKS.filter((p) => p.category === catId).map(perkCardHTML).join("")}
    `).join("")}

    <div class="section-title">🙋 Criados pela turma</div>
    ${customPerks.map(perkCardHTML).join("")}
    <button class="btn btn-block" style="margin-bottom:12px; background:var(--friends-accent); color:var(--on-friends-accent);" id="friends-new-perk-btn">+ Criar prêmio pra turma</button>

    ${pending.length ? `
      <div class="section-title">Pendentes</div>
      <div class="card">
        <div class="stack">
          ${pending.map((r) => `
            <div class="entry-item">
              <div class="entry-icon">${allPerks[r.perk_id]?.emoji || "🎁"}</div>
              <div class="entry-body">
                <div class="entry-title">${escapeHTML(r.title)}</div>
                <div class="entry-meta">${r.user_id === State.userId ? "Resgatado por você" : "Resgatado por alguém da turma"}</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-fulfill="${r.id}">Marcar cumprido</button>
            </div>
          `).join("")}
        </div>
      </div>
    ` : ""}
  `;
  $("#btn-open-star-battle-friends").addEventListener("click", () => renderStarBattleGame("amigos"));
  $("#friends-new-perk-btn").addEventListener("click", openNewCustomPerkModal);
  view.querySelectorAll("[data-redeem]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const perk = allPerks[btn.dataset.redeem];
      if (!confirm(`Resgatar "${perk.title}" por ${perk.cost} moedas do cofre da turma?`)) return;
      btn.disabled = true;
      try {
        await friends.redeemGroupPerk(State.friendGroup.id, State.userId, perk);
        await renderFriendsShop();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
  view.querySelectorAll("[data-delete-perk]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Apagar esse prêmio da turma?")) return;
      btn.disabled = true;
      try {
        await friends.deleteCustomPerk(btn.dataset.deletePerk);
        await renderFriendsShop();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
  view.querySelectorAll("[data-fulfill]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await friends.markGroupRedemptionFulfilled(btn.dataset.fulfill);
        await renderFriendsShop();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

function openNewCustomPerkModal() {
  openModal(`
    <h3 class="modal-title">🎁 Criar prêmio pra turma</h3>
    <div class="stack">
      <label class="field-label">Emoji</label>
      <input type="text" id="fp-emoji" maxlength="4" value="🎁" style="text-align:center; width:60px; font-size:22px;" />
      <label class="field-label">Título</label>
      <input type="text" id="fp-title" maxlength="50" placeholder="ex: Escolhe a música do carro" />
      <label class="field-label">Descrição (opcional)</label>
      <input type="text" id="fp-desc" maxlength="80" placeholder="uma linha explicando" />
      <label class="field-label">Custo em moedas</label>
      <input type="number" id="fp-cost" min="1" max="500" value="10" />
      <button class="btn btn-block" style="margin-top:6px; background:var(--friends-accent); color:var(--on-friends-accent);" id="fp-confirm">Criar</button>
      <p class="error-text" id="fp-error"></p>
    </div>
  `);
  $("#fp-confirm").addEventListener("click", async () => {
    const emoji = $("#fp-emoji").value.trim() || "🎁";
    const title = $("#fp-title").value.trim();
    const desc = $("#fp-desc").value.trim();
    const cost = parseInt($("#fp-cost").value, 10);
    const err = (m) => { $("#fp-error").textContent = m; };
    if (!title) return err("Escreve um título.");
    if (!cost || cost < 1) return err("O custo precisa ser pelo menos 1 moeda.");
    setBusy("#fp-confirm", true);
    try {
      await friends.createCustomPerk(State.friendGroup.id, State.userId, emoji, title, desc, cost);
      closeModal();
      await renderFriendsShop();
    } catch (e) {
      err("Não deu: " + (e.message || e));
      setBusy("#fp-confirm", false);
    }
  });
}

function kickVoteRowHTML(v, byId) {
  const ballots = v.friend_kick_ballots || [];
  const mine = ballots.find((b) => b.user_id === State.userId);
  const yes = ballots.filter((b) => b.vote).length;
  const targetName = byId[v.target_user_id] || "alguém";
  return `
    <div class="entry-item" style="flex-direction:column; align-items:stretch;">
      <div class="entry-title">Remover ${escapeHTML(targetName)}?</div>
      <div class="entry-meta">${yes} voto${yes === 1 ? "" : "s"} a favor até agora</div>
      ${mine ? `<p class="hint-text" style="margin:6px 0 0;">Você votou: ${mine.vote ? "a favor" : "contra"}.</p>` : `
        <div class="row" style="gap:8px; margin-top:8px;">
          <button class="btn btn-sm" style="flex:1; background:var(--friends-accent-soft); color:var(--friends-accent-strong);" data-kick-vote="${v.id}" data-vote="true">A favor</button>
          <button class="btn btn-sm" style="flex:1; background:var(--surface-alt);" data-kick-vote="${v.id}" data-vote="false">Contra</button>
        </div>`}
    </div>`;
}

// depois de sair (por vontade própria) ou excluir a turma: sai da tela de amigos e cai no
// lugar certo (casal, outra turma, ou a tela de escolher conta, se sobrar mais de uma opção)
async function afterLeavingFriendGroup() {
  $("#screen-friends").style.display = "none";
  State.profile = await db.getMyProfile(State.userId).catch(() => null);
  State.friendGroups = await friends.listMyFriendGroups().catch(() => []);
  if (State.profile && !State.friendGroups.length) await enterApp(State.profile);
  else if (State.friendGroups.length === 1 && !State.profile) await enterFriendsMode(State.friendGroups[0]);
  else renderAccountSwitcher(State.profile, State.friendGroups);
}

async function renderFriendsGroup() {
  const view = $("#friends-view");
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const [members, kickVotes] = await Promise.all([
    friends.listGroupMembers(State.friendGroup.id).catch(() => []),
    friends.listActiveKickVotes(State.friendGroup.id).catch(() => []),
  ]);
  const byId = Object.fromEntries(members.map((m) => [m.user_id, m.display_name]));
  const votedTargets = new Set(kickVotes.map((v) => v.target_user_id));

  view.innerHTML = `
    <div class="card" style="border-color:var(--friends-accent-soft);">
      <div class="row" style="align-items:center;">
        <div style="flex:1;">
          <p class="field-label" style="color:var(--friends-accent-strong); margin-bottom:2px;">Turma</p>
          <div style="font-size:20px; font-weight:800;">${escapeHTML(State.friendGroup.emoji || "👥")} ${escapeHTML(State.friendGroup.name || "Minha turma")}</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="friends-edit-group-btn">Editar</button>
      </div>
    </div>
    <div class="card" style="margin-top:14px; border-color:var(--friends-accent-soft);">
      <p class="field-label" style="color:var(--friends-accent-strong);">Código da turma</p>
      <p style="font-family:'Baloo 2'; font-size:22px; letter-spacing:0.04em;">${escapeHTML(State.friendGroup.code || "")}</p>
      <p class="hint-text">Compartilhe esse código pra mais gente entrar na turma.</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:8px;" id="friends-regen-code-btn">Trocar código</button>
    </div>
    ${kickVotes.length ? `
      <div class="section-title">Votações em andamento</div>
      <div class="card"><div class="stack">${kickVotes.map((v) => kickVoteRowHTML(v, byId)).join("")}</div></div>
    ` : ""}
    <div class="card" style="margin-top:14px;">
      <p class="field-label">Quem está na turma (${members.length})</p>
      <div class="stack">
        ${members.map((m) => `
          <div class="entry-item">
            ${avatarHTML(m.display_name, m.avatar_url, "width:34px; height:34px; font-size:14px; background:var(--friends-accent-soft); color:var(--friends-accent-strong);")}
            <div class="entry-body"><div class="entry-title">${m.user_id === State.userId ? "Você" : escapeHTML(m.display_name)}</div></div>
            ${m.user_id !== State.userId && !votedTargets.has(m.user_id) ? `<button class="btn btn-ghost btn-sm" data-propose-kick="${m.user_id}">Propor remover</button>` : ""}
          </div>`).join("") || '<p class="hint-text">Só você, por enquanto.</p>'}
      </div>
    </div>
    <div class="card" style="margin-top:14px;">
      <p class="field-label">Zona de risco</p>
      <p class="hint-text">Sair da turma tira só você. Os dados dela continuam existindo pros outros.</p>
      <button class="btn btn-ghost btn-block" id="friends-leave-group-btn">Sair da turma</button>
      <p class="hint-text" style="margin-top:12px;">Excluir a turma apaga tudo (rolês, humor, achados, prêmios e o cofre) pra sempre, pra todo mundo.</p>
      <button class="btn btn-ghost btn-block" style="color:var(--danger-text);" id="friends-delete-group-btn">Excluir turma</button>
    </div>
  `;
  $("#friends-edit-group-btn").addEventListener("click", openEditGroupModal);
  $("#friends-regen-code-btn").addEventListener("click", async () => {
    if (!confirm("Trocar o código? Quem tiver o código antigo não vai mais conseguir entrar com ele.")) return;
    setBusy("#friends-regen-code-btn", true);
    try {
      const newCode = await friends.regenerateFriendGroupCode(State.friendGroup.id);
      State.friendGroup = { ...State.friendGroup, code: newCode };
      await renderFriendsGroup();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#friends-regen-code-btn", false);
    }
  });
  $("#friends-delete-group-btn").addEventListener("click", async () => {
    if (!confirm(`Excluir "${State.friendGroup.name}" pra sempre? Essa ação não pode ser desfeita.`)) return;
    if (!confirm("Tem certeza mesmo? Todo mundo da turma perde acesso aos dados dela.")) return;
    setBusy("#friends-delete-group-btn", true);
    try {
      await friends.deleteFriendGroup(State.friendGroup.id);
      await afterLeavingFriendGroup();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#friends-delete-group-btn", false);
    }
  });
  $("#friends-leave-group-btn").addEventListener("click", async () => {
    if (!confirm(`Sair de "${State.friendGroup.name}"? Você deixa de ver os dados dela, mas ela continua existindo pros outros.`)) return;
    setBusy("#friends-leave-group-btn", true);
    try {
      await friends.leaveFriendGroup(State.friendGroup.id);
      await afterLeavingFriendGroup();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#friends-leave-group-btn", false);
    }
  });
  view.querySelectorAll("[data-propose-kick]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Propor remover ${byId[btn.dataset.proposeKick] || "essa pessoa"} da turma? A turma toda vai poder votar.`)) return;
      btn.disabled = true;
      try {
        await friends.proposeKickVote(State.friendGroup.id, btn.dataset.proposeKick);
        await renderFriendsGroup();
      } catch (e) {
        alert("Não deu: " + (e.message === "ja_tem_votacao_ativa" ? "Já tem uma votação em andamento pra essa pessoa." : (e.message || e)));
        btn.disabled = false;
      }
    });
  });
  view.querySelectorAll("[data-kick-vote]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      view.querySelectorAll("[data-kick-vote]").forEach((b) => { b.disabled = true; });
      try {
        const result = await friends.castKickBallot(btn.dataset.kickVote, btn.dataset.vote === "true");
        if (result.removed) alert("A votação passou, a pessoa foi removida da turma.");
        await renderFriendsGroup();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        await renderFriendsGroup();
      }
    });
  });
}

function openEditGroupModal() {
  const group = State.friendGroup;
  let colorKey = group.colorKey || "azul";
  openModal(`
    <h3 class="modal-title">✏️ Editar turma</h3>
    <div class="stack">
      <label class="field-label">Nome da turma</label>
      <input type="text" id="eg-name" maxlength="30" value="${escapeHTML(group.name || "")}" />
      <label class="field-label">Emoji da turma</label>
      <input type="text" id="eg-emoji" maxlength="4" value="${escapeHTML(group.emoji || "👥")}" style="text-align:center; width:60px; font-size:22px;" />
      <label class="field-label">Cor da turma</label>
      ${colorPickerHTML("eg", colorKey)}
      <button class="btn btn-block" style="margin-top:6px; background:var(--friends-accent); color:var(--on-friends-accent);" id="eg-confirm">Salvar</button>
      <p class="error-text" id="eg-error"></p>
    </div>
  `);
  $("#eg-color-row").querySelectorAll("[data-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      colorKey = btn.dataset.color;
      $("#eg-color-row").querySelectorAll("[data-color]").forEach((b) => { b.style.borderColor = b.dataset.color === colorKey ? "var(--text)" : "transparent"; });
    });
  });
  $("#eg-confirm").addEventListener("click", async () => {
    const name = $("#eg-name").value.trim();
    const emoji = $("#eg-emoji").value.trim() || "👥";
    const err = (m) => { $("#eg-error").textContent = m; };
    if (!name) return err("Escreve um nome pra turma.");
    setBusy("#eg-confirm", true);
    try {
      await friends.updateFriendGroup(group.id, { name, emoji, colorKey });
      State.friendGroup = { ...group, name, emoji, colorKey };
      applyGroupColors(colorKey);
      closeModal();
      $("#screen-friends h1").textContent = `${emoji} ${name}`;
      await renderFriendsGroup();
    } catch (e) {
      err("Não deu: " + (e.message || e));
      setBusy("#eg-confirm", false);
    }
  });
}

// ================= HOME =================

function todayMoodCardHTML(recentMoods, todayStr) {
  const tile = (role) => {
    const m = recentMoods.find((x) => x.role === role && x.day === todayStr);
    const label = m ? gen(MOOD_BY_ID[m.mood]?.label || m.mood, genderOf(role)) : "ainda não registrou";
    return `
      <div style="flex:1; text-align:center; background:var(--surface-alt); border-radius:14px; padding:12px 8px;">
        <div style="font-size:30px;">${m ? MOOD_BY_ID[m.mood]?.emoji || "❔" : "🤔"}</div>
        <div style="font-weight:800; font-size:13px;">${role === State.role ? "Você" : ROLE_LABEL[role]}</div>
        <div class="hint-text" style="margin:0;">${label}</div>
      </div>`;
  };
  const mine = recentMoods.some((x) => x.role === State.role && x.day === todayStr);
  return `
    <div class="card" id="today-mood-card" style="cursor:pointer;">
      <div class="card-title" style="font-size:15px;">🥰 Humor de hoje</div>
      <div class="row" style="gap:10px; margin-top:10px;">${tile(State.role)}${tile(otherRole())}</div>
      <p class="hint-text" style="margin:10px 0 0; text-align:center;">Toque pra ${mine ? "ver os detalhes" : "registrar o seu"}</p>
    </div>`;
}

// checklist do dia na Home: só o que a própria pessoa já fez hoje (não expõe o do par)
function checklistCardHTML(done) {
  const items = [
    { tab: "mood", tabIcon: "heart", label: "Registrar seu humor", done: done.mood },
    { tab: "notes", tabIcon: "mail", label: "Mandar um recadinho", done: done.note },
  ];
  if (done.daily !== null) items.push({ tab: "notes", tabIcon: "target", label: "Responder o desafio do dia", done: done.daily });
  const doneCount = items.filter((i) => i.done).length;
  return `
    <div class="card">
      <div class="card-title" style="font-size:15px;">Hoje você já:</div>
      <div class="hint-text" style="margin:-2px 0 10px;">${doneCount} de ${items.length}</div>
      <div class="stack" style="gap:8px;">
        ${items.map((i) => `
          <button type="button" class="checklist-row" data-tab="${i.tab}">
            <span class="icon-badge ${i.done ? "done" : ""}">${icon(i.tabIcon, { size: 18 })}</span>
            <span class="checklist-label">${i.label}</span>
            <span class="checklist-status">${i.done ? icon("check", { size: 16 }) : ""}</span>
          </button>
        `).join("")}
      </div>
    </div>`;
}

async function renderHome() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const mk = monthKey(new Date());
  const [plan, encounters, stats, recentMoods] = await Promise.all([
    db.ensureMonthPlan(State.coupleId, mk, goalTarget()),
    db.listEncountersForMonth(State.coupleId, mk),
    db.getCoupleStats(State.coupleId),
    db.getMoodHistory(State.coupleId, toISODate(addDays(new Date(), -2))),
  ]);
  const todayStr = todayISO();

  // só busca se o casal tiver o checklist ligado (evita 2 consultas extras à toa pros outros casais)
  let checklistNotes = null, checklistDaily = null;
  if (homeWidgetOn("checklist")) {
    [checklistNotes, checklistDaily] = await Promise.all([
      db.listRecentSweetNotes(State.coupleId, 5),
      feat("daily") ? db.getChallengeAnswersForDay(State.coupleId, todayStr) : Promise.resolve([]),
    ]);
  }

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
  const partnerNeedsCare = NEEDS_CARE_MOODS.has(partnerRecentMood?.mood) || NEEDS_CARE_MOODS.has(partnerRecentMood?.mood_partner);
  const daysSinceKiss = stats?.last_kiss_at ? Math.floor((Date.now() - new Date(stats.last_kiss_at).getTime()) / 86400000) : null;
  const nudgeText = !feat("miss") ? null : pickSaudadeNudge({
    role: State.role,
    todayISO: todayStr,
    partnerName: ROLE_LABEL[otherRole()],
    partnerGender: genderOf(otherRole()),
    partnerNeedsCare,
    daysSinceKiss: feat("kiss") ? daysSinceKiss : null,
    weekHasSomething: feat("goal") || feat("next") ? weekHasSomething : true,
  });

  // depois das 20h, se ainda não registrou o humor de hoje, lembra antes que o dia acabe
  const iLoggedMoodToday = recentMoods.some((m) => m.role === State.role && m.day === todayStr);
  const showMoodReminder = new Date().getHours() >= 20 && !iLoggedMoodToday;

  // cada card da tela inicial; a ordem e quais aparecem vêm da configuração do casal
  const nextSpecial = homeWidgetOn("special") ? await findNextSpecialDate() : null;
  const html = {};
  html.kiss = feat("kiss") ? `    <div class="card" id="kiss-card" style="cursor:pointer; text-align:center;">
      <div class="card-title" style="font-size:15px;">⏱️ Sem se beijar</div>
      ${stats?.last_kiss_at ? `
        <div class="flip-clock" id="kiss-counter">
          <div class="flip-unit"><span class="flip-value" data-unit="d">00</span><span class="flip-label">dias</span></div>
          <div class="flip-unit"><span class="flip-value" data-unit="h">00</span><span class="flip-label">hrs</span></div>
          <div class="flip-unit"><span class="flip-value" data-unit="m">00</span><span class="flip-label">min</span></div>
          <div class="flip-unit"><span class="flip-value" data-unit="s">00</span><span class="flip-label">seg</span></div>
        </div>
      ` : `<div class="card-sub" style="margin:10px 0;">-</div>`}
      <p class="hint-text">Toca aqui pra ${stats?.last_kiss_at ? "atualizar" : "registrar"} a hora do último beijo</p>
    </div>` : "";
  html.goal = feat("goal") ? `    <div class="card">
      <div class="card-title">${monthLabel(mk)}</div>
      <div class="card-sub">Meta desse mês: <strong>${target} encontro${target === 1 ? "" : "s"}</strong>${plan.carry_in > 0 ? ` (${plan.carry_in} vindo${plan.carry_in > 1 ? "s" : ""} do mês passado)` : ""}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="row" style="margin-top:10px; align-items:center;">
        <div class="progress-dots">${progressDots(happened, target)}</div>
        <div style="text-align:right; flex:0 0 auto;"><span class="pill pill-success">${happened}/${target}</span></div>
      </div>
      ${planejados.length < target ? `<button class="btn btn-secondary btn-block" style="margin-top:14px;" id="btn-goto-define">Definir encontros do mês</button>` : ""}
    </div>` : "";
  html.next = feat("next") ? (upcoming ? `    <div class="card card-hero">
      <div class="card-hero-eyebrow">Próximo encontro</div>
      ${(() => {
        const days = Math.round((startOfDay(parseISODate(upcoming.start_date)) - startOfDay(new Date())) / 86400000);
        return days >= 0
          ? `<div class="card-hero-number">${days} <span>${days === 1 ? "dia" : "dias"}</span></div>`
          : `<div class="card-hero-number" style="font-size:22px;">${escapeHTML(upcoming.title) || defaultTitle(upcoming)}</div>`;
      })()}
      <div class="card-hero-sub">${humanDateLong(parseISODate(upcoming.start_date))}${upcoming.title ? ` · ${escapeHTML(upcoming.title)}` : ""}</div>
    </div>` : `    <div class="card">
      <div class="card-title">Próximo encontro</div>
      <p class="center-note" style="padding:6px 0;">Nada marcado ainda. Que tal combinar um? 💕</p>
    </div>`) : "";
  html.recharge = feat("recharge") ? `    <div class="card" id="weekend-card" style="cursor:pointer;">
      <div class="switch-row">
        <div>
          <div class="card-title" style="font-size:15px;">🔋 Fim de semana de recarregar</div>
          <div class="card-sub" style="margin-bottom:0;">${humanDateShort(nextWeekendFriday)} a ${humanDateShort(addDays(nextWeekendFriday, 2))}. ${myWeekendOn ? gen("Você está reclusa(o) recarregando", genderOf(State.role)) : "Tudo normal pra você"}${partnerWeekendOn ? `. ${ROLE_LABEL[State.partner?.role]} também recarregando` : ""}.</div>
        </div>
        <span class="switch ${myWeekendOn ? "on" : ""}" style="pointer-events:none;"></span>
      </div>
      <p class="hint-text" style="margin-top:8px;">Toca aqui pra escolher outro fim de semana</p>
    </div>` : "";
  html.mood = todayMoodCardHTML(recentMoods, todayStr);
  html.together = togetherCardHTML();
  html.special = specialCardHTML(nextSpecial);
  html.checklist = checklistNotes ? checklistCardHTML({
    mood: recentMoods.some((m) => m.role === State.role && m.day === todayStr),
    note: checklistNotes.some((n) => n.role === State.role && n.created_at.slice(0, 10) === todayStr),
    daily: feat("daily") ? checklistDaily.some((a) => a.role === State.role) : null,
  }) : "";
  // sem nenhum card ligado, ainda mostra como os dois estão hoje
  const widgetIds = homeOrder().filter(homeWidgetOn);

  view.innerHTML = `
    ${showMoodReminder ? `
      <div class="banner banner-warm" id="mood-reminder-banner" style="cursor:pointer;">
        <div class="banner-icon">🌙</div>
        <div class="banner-text"><strong>O dia tá quase acabando!</strong>Você ainda não registrou seu humor de hoje. Não esquece 💗</div>
      </div>
    ` : ""}
    ${shouldShowInstallHint() ? `
      <div class="banner banner-warm" id="install-banner" style="cursor:pointer;">
        <div class="banner-icon">📲</div>
        <div class="banner-text"><strong>Instale o app no celular</strong>Vira um ícone na tela inicial e abre em tela cheia. Toque pra ver como.</div>
      </div>
    ` : ""}
    ${nudgeText ? `
      <div class="banner banner-warm">
        <div class="banner-icon">🥹</div>
        <div class="banner-text">${nudgeText}</div>
      </div>
    ` : ""}

${widgetIds.map((id) => html[id] || "").join("")}

    ${widgetIds.length ? "" : todayMoodCardHTML(recentMoods, todayStr)}
  `;

  $("#btn-goto-define")?.addEventListener("click", () => setActiveTab("calendar"));
  $("#today-mood-card")?.addEventListener("click", () => setActiveTab("mood"));
  $("#together-card")?.addEventListener("click", openTogetherModal);
  $("#special-card")?.addEventListener("click", () => setActiveTab("calendar"));
  view.querySelectorAll(".checklist-row").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });
  $("#weekend-card")?.addEventListener("click", () => openWeekendModal(nextWeekendFriday));
  $("#mood-reminder-banner")?.addEventListener("click", () => setActiveTab("mood"));
  $("#install-banner")?.addEventListener("click", openInstallGuide);
  $("#kiss-card")?.addEventListener("click", () => openKissModal(stats?.last_kiss_at));

  clearKissTimer();
  if (feat("kiss") && stats?.last_kiss_at) {
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

  if (feat("kiss")) maybeShowKissMilestone(daysSinceKiss, stats?.last_kiss_at);
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
function flipRole(role) { return role === "gabriel" ? "tata" : "gabriel"; }

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
    .filter((e) => e.kind !== "evento" && e.status !== "recusado" && e.status !== "nao_aconteceu")
    .filter((e) => { const en = e.end_date ? parseISODate(e.end_date) : parseISODate(e.start_date); return en >= start; })
    .sort((a, b) => parseISODate(a.start_date) - parseISODate(b.start_date));
  return candidates[0] || null;
}

const EVENT_CATEGORIES = {
  comemorativa: { emoji: "💝", label: "Data especial" },
  casal: { emoji: "💞", label: "Casal" },
  trabalho: { emoji: "💼", label: "Trabalho" },
  outro: { emoji: "📌", label: "Outro" },
};

function defaultTitle(e) {
  if (e.kind === "planejado") return "Encontro combinado";
  if (e.kind === "saudade") return "Encontro de saudade";
  if (e.kind === "evento") return "Evento";
  return "Convite";
}

function iconFor(e) {
  if (e.kind === "evento") return (EVENT_CATEGORIES[e.category] || EVENT_CATEGORIES.outro).emoji;
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
  if (!feat("recharge")) return false;
  const friday = fridayOfWeekend(parseISODate(dateISO));
  if (!friday) return false;
  const rows = await db.getWeekendRecharge(State.coupleId, monthKey(friday));
  return rows.some((r) => r.week_start === toISODate(friday) && r.role === role && r.active);
}

// nunca bloqueia a ação por falta de moeda — só cobra quando dá pra cobrar
async function spendCoinIfAvailable(role, amount, reason) {
  if (!coinsOn() || amount <= 0) return true;
  const balances = await db.getCoinBalances(State.coupleId);
  if ((balances[role] || 0) >= amount) {
    await addCoins(role, -amount, reason);
    return true;
  }
  return false;
}

// aceitar/recusar/cancelar um convite (fora dos 2 encontros oficiais do mês) e seus efeitos em moedas.
// mandar qualquer convite já custou 1 moeda de quem mandou (ver openSaudadeModal / renderInvites).
async function respondToConvite(entry, decision) {
  if (decision === "accept") {
    await db.updateEncounterStatus(entry.id, "confirmado");
    await earnCoins(State.role, coinRule("accept"), "aceitou um convite");
  } else if (decision === "decline") {
    await db.updateEncounterStatus(entry.id, "recusado");
    // recusar "devolve" a moeda pra quem convidou — quem recusou fica devendo, tenta cobrar dela
    await addCoins(entry.created_by, coinRule("invite"), "convite recusado: reembolso");
    const exempt = await isRechargeExemptForDate(entry.start_date, State.role);
    if (!exempt) await spendCoinIfAvailable(State.role, coinRule("decline"), "recusou um convite");
  } else if (decision === "cancel") {
    await db.updateEncounterStatus(entry.id, "recusado");
    // cancelar o próprio convite antes de resposta devolve a moeda de quem mandou
    await addCoins(State.role, coinRule("invite"), "cancelou o próprio convite: reembolso");
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

  await earnCoins(State.role, coinRule("moodStreak"), reason);
  return streak;
}

function openSweetNoteModal(alreadyEarnedToday) {
  openModal(`
    <h3 class="modal-title">💌 Recadinho fofo</h3>
    <p class="card-sub">${!coinsOn() || coinRule("note") === 0 ? "Manda quantos quiser." : alreadyEarnedToday ? "Você já ganhou a moeda de hoje, mas manda quantos quiser." : `O primeiro recadinho do dia já dá ${coinWord(coinRule("note"))} pra você.`}</p>
    <textarea id="sweet-note-text" rows="3" placeholder="tô pensando em você..."></textarea>
    <button class="btn btn-primary btn-block" style="margin-top:16px;" id="btn-send-sweet-note">Mandar</button>
  `);
  $("#btn-send-sweet-note").addEventListener("click", async () => {
    const message = $("#sweet-note-text").value.trim();
    if (!message) { alert("Escreve alguma coisa fofa primeiro :)"); return; }
    setBusy("#btn-send-sweet-note", true);
    try {
      await db.sendSweetNote(State.coupleId, State.role, message);
      if (!alreadyEarnedToday) await earnCoins(State.role, coinRule("note"), "mandou uma mensagem fofa");
      closeModal();
      await renderActiveTab();
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
    <p class="card-sub">Escolhe um dia pra tentar se ver. Isso não mexe na meta do mês, é só um pedido especial pra ${ROLE_LABEL[otherRole()]} aprovar. ${cn(` Se ${partnerThey()} recusar, a moeda volta pra você.`)}</p>
    <label class="field-label">Que dia?</label>
    <input type="date" id="saudade-date" min="${minDate}" value="${minDate}" />
    <label class="field-label">Mensagem (opcional)</label>
    <textarea id="saudade-msg" rows="2" placeholder="tô com saudade, será que dá pra gente se ver?"></textarea>
    <button class="btn btn-warm btn-block" style="margin-top:16px;" id="send-saudade">Enviar sinal${costTag("miss")}</button>
  `);
  $("#send-saudade").addEventListener("click", async () => {
    setBusy("#send-saudade", true);
    const dateVal = $("#saudade-date").value;
    const msg = $("#saudade-msg").value.trim();
    try {
      await addCoins(State.role, -coinRule("miss"), "sinal de saudade");
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
  const [plan, encounters, weekend, myCycle, partnerCycle] = await Promise.all([
    db.ensureMonthPlan(State.coupleId, mk, goalTarget()),
    db.listEncountersForMonth(State.coupleId, mk),
    db.getWeekendRecharge(State.coupleId, mk),
    genderOf(State.role) === "mulher" ? db.getCycle(State.coupleId, State.role).catch(() => null) : null,
    State.partner ? db.getCycle(State.coupleId, State.partner.role).catch(() => null) : null,
  ]);
  State.calendarCycle = myCycle ? { s: myCycle, full: true } : partnerCycle ? { s: partnerCycle, full: partnerCycle.visibility === "full" } : null;
  const yearlyDates = await db.listYearlyDates(State.coupleId).catch(() => []);
  const [viewYear, viewMonth] = mk.split("-").map(Number);
  encounters.forEach((e) => { if (e.yearly) e.origYear = parseISODate(e.start_date).getFullYear(); });
  for (const y of yearlyDates) {
    const orig = parseISODate(y.start_date);
    if (orig.getMonth() + 1 !== viewMonth || orig.getFullYear() >= viewYear) continue;
    const day = Math.min(orig.getDate(), daysInMonth(new Date(viewYear, viewMonth - 1, 1)));
    encounters.push({ ...y, start_date: toISODate(new Date(viewYear, viewMonth - 1, day)), end_date: null, month: mk, origYear: orig.getFullYear() });
  }
  State.calendarPlan = plan;
  State.calendarEncounters = encounters;
  State.calendarWeekend = weekend;

  const target = plan.base_target + plan.carry_in;
  const planejadosCount = encounters.filter((e) => e.kind === "planejado").length;
  const happened = encounters.filter((e) => e.kind === "planejado" && e.status === "aconteceu").length;

  view.innerHTML = `
    <div class="month-nav">
      <button id="prev-month">${icon("chevron-left", { size: 18 })}</button>
      <h2>${monthLabel(mk)}</h2>
      <button id="next-month">${icon("chevron-right", { size: 18 })}</button>
    </div>

    <div class="card">
      <div class="row" style="align-items:center;">
        <div>
          <div class="card-title" style="font-size:15px;">${feat("goal") ? `${happened}/${target} encontros aconteceram` : "Encontros do mês"}</div>
          ${feat("goal") ? `<div class="progress-dots" style="margin:2px 0 4px;">${progressDots(happened, target)}</div>` : ""}
          <div class="card-sub" style="margin-bottom:0;">${feat("goal") ? `${planejadosCount} de ${target} já definidos nesse mês` : "Combine encontros e marque eventos"}</div>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-add-planejado">+ Encontro</button>
      </div>
      <div class="row" style="margin-top:10px; gap:8px;">
        <button class="btn btn-secondary" style="flex:1;" id="btn-add-especial">💝 Data especial</button>
        <button class="btn btn-secondary" style="flex:1;" id="btn-add-evento">📌 Evento</button>
      </div>
    </div>

    <div class="card">
      <div class="weekday-row"><span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span></div>
      <div class="day-grid" id="day-grid"></div>
      <div class="legend">
        <span>💗 combinado</span><span>✅ aconteceu</span><span>📅 aceito</span>${feat("miss") ? "<span>🫂 saudade</span>" : ""}<span>✉️ convite</span>${feat("recharge") ? "<span>🔋 recarregando</span>" : ""}<span>💝 data especial</span><span>💞 evento casal</span><span>💼 trabalho</span><span>📌 outro</span>
      </div>
    </div>

    ${specialDatesCardHTML()}

    <div id="day-detail"></div>

    <div id="cycle-section">${cycleCalendarSectionHTML(myCycle, partnerCycle)}</div>
  `;

  buildDayGrid();
  wireCycleSection(myCycle, partnerCycle);
  view.querySelectorAll("[data-special-date]").forEach((el) => {
    el.addEventListener("click", () => {
      showDayDetail(el.dataset.specialDate);
      $("#day-detail").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  $("#prev-month").addEventListener("click", () => { State.calendarMonth = addMonths(State.calendarMonth, -1); renderCalendar(); });
  $("#next-month").addEventListener("click", () => { State.calendarMonth = addMonths(State.calendarMonth, 1); renderCalendar(); });
  $("#btn-add-planejado").addEventListener("click", () => openAddEncounterModal("planejado"));
  $("#btn-add-evento").addEventListener("click", () => openAddEventModal());
  $("#btn-add-especial").addEventListener("click", () => openAddEventModal(undefined, "comemorativa"));
}

function specialDatesCardHTML() {
  const list = State.calendarEncounters
    .filter((e) => e.category === "comemorativa")
    .sort((x, y) => x.start_date.localeCompare(y.start_date));
  if (!list.length) return "";
  return `
    <div class="card">
      <div class="card-title" style="font-size:15px;">💝 Datas especiais do mês</div>
      <div class="stack" style="margin-top:8px;">
        ${list.map((e) => `
          <div class="entry-item" style="cursor:pointer;" data-special-date="${e.start_date}">
            <div class="entry-icon">💝</div>
            <div class="entry-body">
              <div class="entry-title">${escapeHTML(e.title) || "Data especial"}</div>
              <div class="entry-meta">${humanDateShort(parseISODate(e.start_date))}${specialYearsLabel(e)}</div>
            </div>
          </div>`).join("")}
      </div>
    </div>
  `;
}

function specialYearsLabel(e) {
  const n = e.origYear ? parseISODate(e.start_date).getFullYear() - e.origYear : 0;
  return n > 0 ? ` · faz ${n} ano${n === 1 ? "" : "s"} 🎉` : "";
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
    const friday = feat("recharge") ? fridayOfWeekend(date) : null;
    const weekendActive = friday && State.calendarWeekend.some((w) => w.week_start === toISODate(friday) && w.active);
    const cyKey = State.calendarCycle ? cyclePhaseOnDate(State.calendarCycle.s, date, State.calendarCycle.full) : null;
    const cyDot = cyKey ? `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${CYCLE_COLORS[cyKey]};"></span>` : "";
    const dots = cyDot + entries.slice(0, cyKey ? 2 : 3).map(iconFor).join("");
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
  const friday = feat("recharge") ? fridayOfWeekend(date) : null;
  const weekendRow = friday ? State.calendarWeekend.filter((w) => w.week_start === toISODate(friday)) : [];
  const myWeekendOn = weekendRow.some((w) => w.role === State.role && w.active);

  const entriesHTML = entries.length ? entries.map((e) => entryItemHTML(e)).join("") : `
    <div class="empty-state"><span class="emoji">🗓️</span>Nada marcado nesse dia ainda.</div>
  `;

  const cyKeyDay = State.calendarCycle ? cyclePhaseOnDate(State.calendarCycle.s, date, State.calendarCycle.full) : null;
  const cyNames = { mens: "Menstruação", tpm: "TPM", ovul: "Ovulação", fert: "Período fértil (estimativa)" };
  $("#day-detail").innerHTML = `
    <div class="card">
      <div class="card-title">${humanDateLong(date)}</div>
      ${cyKeyDay ? `<div class="pill pill-muted" style="margin:6px 0 10px;"><span style="width:9px;height:9px;border-radius:50%;background:${CYCLE_COLORS[cyKeyDay]};display:inline-block;"></span>${cyNames[cyKeyDay]}</div>` : ""}
      <div class="stack" id="entries-list">${entriesHTML}</div>
      <div class="row" style="margin-top:14px;">
        ${feat("miss") ? `<button class="btn btn-secondary" id="btn-add-saudade-day">🫂 Encontro de saudade</button>` : ""}
        <button class="btn btn-secondary" id="btn-add-evento-day">📌 Evento</button>
        ${friday ? `<button class="btn ${myWeekendOn ? "btn-danger" : "btn-secondary"}" id="btn-toggle-weekend-day">${myWeekendOn ? "🔋 Cancelar recarga" : "🔋 Recarregar esse fds"}</button>` : ""}
      </div>
    </div>
  `;

  $("#btn-add-saudade-day")?.addEventListener("click", () => openAddEncounterModal("saudade", date));
  $("#btn-add-evento-day").addEventListener("click", () => openAddEventModal(date));
  $("#btn-toggle-weekend-day")?.addEventListener("click", async () => {
    await db.setWeekendRecharge(State.coupleId, toISODate(friday), State.role, !myWeekendOn);
    await renderCalendar();
    showDayDetail(iso);
  });

  wireEntryActions();
}

function entryItemHTML(e) {
  const mine = e.created_by === State.role;
  const isTerminal = e.status === "aconteceu" || e.status === "nao_aconteceu";
  let actions = "";
  if (e.kind === "evento") {
    actions = "";
  } else if (e.kind === "planejado" && !isTerminal) {
    actions = `
      <button class="btn btn-success btn-sm" data-act="happened" data-id="${e.id}">Aconteceu ✅</button>
      <button class="btn btn-ghost btn-sm" data-act="missed" data-id="${e.id}">Não rolou</button>
    `;
  } else if (e.kind === "saudade" && !isTerminal) {
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
        <button class="btn btn-success btn-sm" data-act="accept" data-id="${e.id}">Aceitar${earnTag("accept")}</button>
        <button class="btn btn-danger btn-sm" data-act="decline" data-id="${e.id}">Recusar</button>
        ${coinsOn() ? `<div class="hint-text" style="flex-basis:100%; margin-top:4px;">recusar devolve a moeda pra ${ROLE_LABEL[e.created_by]} e ${coinRule("decline") > 0 ? `custa ${coinRule("decline")}💰 sua` : "não custa nada pra você"}${feat("recharge") ? " (de graça se for na sua semana de recarregar)" : ""}</div>` : ""}
      `;
  } else if (isTerminal) {
    actions = `<button class="btn btn-ghost btn-sm" data-act="undo" data-id="${e.id}">↩️ Desfazer</button>`;
  }
  actions += `<button class="btn btn-ghost btn-sm" data-act="delete" data-id="${e.id}" title="Apagar">🗑️ Apagar</button>`;
  return `
    <div class="entry-item">
      <div class="entry-icon">${iconFor(e)}</div>
      <div class="entry-body">
        <div class="entry-title">${escapeHTML(e.title) || defaultTitle(e)}</div>
        <div class="entry-meta">${statusLabel(e)} · criado por ${ROLE_LABEL[e.created_by]}</div>
        <div class="entry-actions">${actions}</div>
      </div>
    </div>
  `;
}

function statusLabel(e) {
  if (e.kind === "evento" && e.category === "comemorativa") return `data especial${specialYearsLabel(e)}`;
  if (e.kind === "evento") return `evento de ${(EVENT_CATEGORIES[e.category] || EVENT_CATEGORIES.outro).label.toLowerCase()}`;
  const map = {
    agendado: "combinado", confirmado: "confirmado", aconteceu: "aconteceu",
    nao_aconteceu: "não aconteceu", pendente: "pendente", recusado: "recusado",
  };
  return map[e.status] || e.status;
}

// volta um encontro/convite marcado como aconteceu/não aconteceu pro estado "em andamento" de antes.
// se tinha ganhado o bônus de encontro combinado, estorna as moedas pra não dar pra ficar
// marcando/desmarcando de novo pra farmar moeda de graça.
async function undoEntryStatus(entry) {
  if (entry.status === "aconteceu" && entry.kind === "planejado") {
    await addCoins("gabriel", -coinRule("meet"), "desfez: encontro combinado aconteceu (estorno)");
    await addCoins("tata", -coinRule("meet"), "desfez: encontro combinado aconteceu (estorno)");
  }
  const previousStatus = entry.kind === "convite" ? "confirmado" : "agendado";
  await db.updateEncounterStatus(entry.id, previousStatus);
}

async function deleteEntryWithConfirm(entry) {
  const ok = confirm(`Apagar "${entry.title || defaultTitle(entry)}"?${entry.yearly ? " Ela some de todos os anos." : ""} Isso não desfaz moedas já ganhas ou gastas por causa dele.`);
  if (!ok) return false;
  await db.deleteEncounter(entry.id);
  return true;
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
            await earnCoins("gabriel", coinRule("meet"), "encontro combinado aconteceu");
            await earnCoins("tata", coinRule("meet"), "encontro combinado aconteceu");
          }
        } else if (act === "missed") {
          await db.updateEncounterStatus(id, "nao_aconteceu");
        } else if (act === "cancel" || act === "decline" || act === "accept") {
          const entry = State.calendarEncounters.find((e) => e.id === id);
          await respondToConvite(entry, act);
        } else if (act === "undo") {
          const entry = State.calendarEncounters.find((e) => e.id === id);
          await undoEntryStatus(entry);
        } else if (act === "delete") {
          const entry = State.calendarEncounters.find((e) => e.id === id);
          const deleted = await deleteEntryWithConfirm(entry);
          if (!deleted) { btn.disabled = false; return; }
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

function openAddEventModal(presetDate, presetCategory) {
  const dateVal = presetDate ? toISODate(presetDate) : toISODate(new Date());
  let category = presetCategory || "casal";
  openModal(`
    <h3 class="modal-title">📌 Novo evento no calendário</h3>
    <label class="field-label">Tipo</label>
    <div class="row" id="event-cats" style="gap:8px; flex-wrap:wrap;">
      ${Object.entries(EVENT_CATEGORIES).map(([id, c]) => `
        <button type="button" class="btn ${id === category ? "btn-primary" : "btn-secondary"} btn-sm" data-cat="${id}" style="flex:1 1 40%;">${c.emoji} ${c.label}</button>
      `).join("")}
    </div>
    <label class="field-label">Título</label>
    <input type="text" id="new-title" maxlength="80" placeholder="ex: aniversário de namoro, reunião importante" />
    <label class="field-label">Data de início</label>
    <input type="date" id="new-start" value="${dateVal}" />
    <label class="field-label">Data final (se durar mais de um dia)</label>
    <input type="date" id="new-end" value="" />
    <label id="yearly-wrap" style="display:flex; align-items:center; gap:8px; margin-top:12px; font-weight:700;">
      <input type="checkbox" id="new-yearly" checked style="width:auto; margin:0;" /> 🔁 Repetir todo ano (aniversário de namoro, etc.)
    </label>
    <p class="hint-text" style="margin-top:8px;">O evento aparece no calendário dos dois e não conta como encontro nem mexe nas moedas.</p>
    <button class="btn btn-primary btn-block" style="margin-top:16px;" id="save-encounter">Salvar</button>
  `);
  const syncYearly = () => { $("#yearly-wrap").style.display = category === "comemorativa" ? "flex" : "none"; };
  syncYearly();
  $("#event-cats").querySelectorAll("[data-cat]").forEach((b) => {
    b.addEventListener("click", () => {
      category = b.dataset.cat;
      syncYearly();
      $("#event-cats").querySelectorAll("[data-cat]").forEach((x) => {
        x.className = `btn ${x.dataset.cat === category ? "btn-primary" : "btn-secondary"} btn-sm`;
      });
    });
  });
  $("#save-encounter").addEventListener("click", async () => {
    const title = $("#new-title").value.trim();
    if (!title) { alert("Dá um título pro evento :)"); return; }
    if (!$("#new-start").value) { alert("Escolhe a data de início."); return; }
    const start = parseISODate($("#new-start").value);
    const endVal = $("#new-end").value;
    if (endVal && parseISODate(endVal) < start) { alert("A data final não pode ser antes da inicial."); return; }
    setBusy("#save-encounter", true);
    try {
      await db.createEncounter({
        coupleId: State.coupleId, startDate: start, endDate: endVal ? parseISODate(endVal) : null,
        title, kind: "evento", category, createdBy: State.role, status: "agendado",
        yearly: category === "comemorativa" && $("#new-yearly").checked,
      });
      closeModal();
      State.calendarMonth = startOfMonth(start);
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
  const question = gen(questionForWeek(weekIndex), genderOf(State.role));
  const weeklyAnswers = await db.getWeeklyAnswers(State.coupleId, weekIndex);
  const myAnswer = weeklyAnswers.find((a) => a.role === State.role);
  const theirAnswer = weeklyAnswers.find((a) => a.role !== State.role);
  const moodReactions = await db.listReactions(State.coupleId, "mood").catch(() => null); // null = recurso ainda não ativado no banco

    const myMoodDays = history.filter((h) => h.role === State.role).map((h) => h.day).sort();
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
    <div class="card" style="text-align:center; background:var(--accent-soft);">
      <div style="font-size:15px; font-weight:800; color:var(--accent-strong);">${moodStreakText}</div>
    </div>

    <div class="card">
      <div class="card-title">Como você está?</div>
      <div class="mood-grid" id="mood-grid">
        ${MOODS.map((m) => `
          <button class="mood-btn ${mine?.mood === m.id ? "selected" : ""}" data-mood="${m.id}">
            <span class="emoji">${m.emoji}</span><span class="label">${gen(m.label, genderOf(State.role))}</span>
          </button>
        `).join("")}
      </div>

      <div class="section-title">Como você está com ${ROLE_LABEL[otherRole()]} hoje?</div>
      <div class="mood-grid" id="mood-grid-partner">
        ${MOODS.map((m) => `
          <button class="mood-btn ${mine?.mood_partner === m.id ? "selected" : ""}" data-mood="${m.id}">
            <span class="emoji">${m.emoji}</span><span class="label">${gen(m.label, genderOf(State.role))}</span>
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
      <textarea id="mood-note" rows="2" placeholder="algo que quer contar pra ele/ela...">${escapeHTML(mine?.note || "")}</textarea>

      <button class="btn btn-primary btn-block" style="margin-top:16px;" id="save-mood">Salvar humor de hoje</button>
    </div>

    <div class="section-title">Humor de ${ROLE_LABEL[otherRole()]} hoje</div>
    <div class="card" id="partner-mood-tap" role="button" tabindex="0" style="cursor:pointer;">
      ${theirs ? `
        <div class="partner-mood-card">
          <span class="emoji-big">${MOOD_BY_ID[theirs.mood]?.emoji || "❔"}</span>
          <div>
            <div class="card-title" style="font-size:15px;">${gen(MOOD_BY_ID[theirs.mood]?.label || theirs.mood, genderOf(otherRole()))}</div>
            <div class="card-sub" style="margin-bottom:0;">${TALK_BY_ID[theirs.wants_to_talk]?.emoji || ""} ${TALK_BY_ID[theirs.wants_to_talk]?.label || ""}</div>
            ${theirs.note ? `<div class="entry-meta" style="margin-top:6px;">"${escapeHTML(theirs.note)}"</div>` : ""}
          </div>
        </div>
        ${theirs.mood_partner ? `
          <div class="partner-mood-card" style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
            <span class="emoji-big">${MOOD_BY_ID[theirs.mood_partner]?.emoji || "❔"}</span>
            <div>
              <div class="card-title" style="font-size:15px;">Com você: ${gen(MOOD_BY_ID[theirs.mood_partner]?.label || theirs.mood_partner, genderOf(otherRole()))}</div>
            </div>
          </div>
        ` : ""}
      ` : `<div class="empty-state"><span class="emoji">🤔</span>${ROLE_LABEL[otherRole()]} ainda não registrou o humor de hoje.</div>`}
      <p class="hint-text" style="margin:12px 0 0; text-align:center; font-weight:800; color:var(--accent-strong);">Toque pra ver os últimos 7 dias 📅 ›</p>
    </div>

    ${moodReactions && theirs ? `
      <div class="card react-card">
        <div class="card-sub" style="margin-bottom:8px;">Mande um carinho pra ${ROLE_LABEL[otherRole()]}</div>
        ${reactionBarHTML("mood", theirs.id, moodReactions)}
      </div>` : ""}
    ${(() => { const got = moodReactions && mine ? reactionGotHTML(mine.id, moodReactions, "ao seu humor de hoje") : ""; return got ? `<div class="card react-card">${got}</div>` : ""; })()}

    <div class="section-title">Últimos 7 dias</div>
    <div class="card">
      ${historyStripHTML(history)}
      <button class="btn btn-secondary btn-block" style="margin-top:14px;" id="btn-mood-history">📅 Ver detalhes de ${ROLE_LABEL[otherRole()]} (com você, conversa, recadinhos)</button>
    </div>

${feat("weekly") ? `    <div class="card-tab-wrap">
      <span class="card-tab">💭 Pergunta da semana</span>
    <div class="card">
      <div class="card-sub" style="font-size:15px; color:var(--text); font-weight:700;">${question}</div>
      <textarea id="weekly-answer" rows="3" style="margin-top:10px;" placeholder="escreve sua resposta...">${escapeHTML(myAnswer?.answer || "")}</textarea>
      <button class="btn btn-primary btn-block" style="margin-top:12px;" id="save-weekly">${myAnswer ? "Atualizar resposta" : `Responder${earnTag("weekly")}`}</button>
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
    </div>
    <p class="hint-text" style="text-align:center; margin-top:-8px;">🔮 Semana que vem: "${gen(questionForWeek(weekIndex + 1), genderOf(State.role))}"</p>` : ""}
  `;

  $("#partner-mood-tap").addEventListener("click", () => openMoodHistoryModal(history, otherRole()));
  $("#btn-mood-history").addEventListener("click", () => openMoodHistoryModal(history, otherRole()));
  wireReactions();

  let selectedMood = mine?.mood || null;
  let selectedMoodPartner = mine?.mood_partner || null;
  let selectedTalk = mine?.wants_to_talk || "talvez";

  $("#mood-grid").querySelectorAll(".mood-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMood = btn.dataset.mood;
      $("#mood-grid").querySelectorAll(".mood-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });
  $("#mood-grid-partner").querySelectorAll(".mood-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMoodPartner = btn.dataset.mood;
      $("#mood-grid-partner").querySelectorAll(".mood-btn").forEach((b) => b.classList.remove("selected"));
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
    if (!selectedMood) { alert("Escolhe como você está primeiro :)"); return; }
    if (!selectedMoodPartner) { alert(`Escolhe também como você está com ${ROLE_LABEL[otherRole()]} :)`); return; }
    setBusy("#save-mood", true);
    try {
      const isFirstToday = !mine;
      await db.upsertMood(State.coupleId, today, State.role, selectedMood, selectedMoodPartner, selectedTalk, $("#mood-note").value.trim());
      if (isFirstToday) await earnCoins(State.role, coinRule("mood"), "registrou o humor do dia");
      const streak = await maybeAwardMoodStreak();
      if (streak) alert(`🎉 ${streak} dias seguidos registrando o humor!${coinRule("moodStreak") > 0 ? cn(` +${coinRule("moodStreak")} moedas de bônus.`) : ""}`);
      await renderMood();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#save-mood", false);
    }
  });

  $("#save-weekly")?.addEventListener("click", async () => {
    const answer = $("#weekly-answer").value.trim();
    if (!answer) { alert("Escreve uma resposta primeiro :)"); return; }
    setBusy("#save-weekly", true);
    try {
      const saved = await db.saveWeeklyAnswer(State.coupleId, weekIndex, State.role, answer);
      if (saved.isNew) {
        await earnCoins(State.role, coinRule("weekly"), "respondeu a pergunta da semana");
        alert(`💭 Resposta salva!${coinRule("weekly") > 0 ? cn(` +${coinWord(coinRule("weekly"))} pra você.`) : ""}`);
      }
      await renderMood();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#save-weekly", false);
    }
  });
}

// detalhe dos últimos 7 dias de uma pessoa: humor geral + como está "com o par" + vontade de conversar + recado
function openMoodHistoryModal(history, role) {
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(new Date(), -i));
  const render = () => {
    const isMe = role === State.role;
    const withWhom = isMe ? ROLE_LABEL[otherRole()] : "você";
    const rows = days.map((d) => {
      const iso = toISODate(d);
      const m = history.find((h) => h.day === iso && h.role === role);
      const label = `${iso === todayISO() ? "Hoje" : weekdayAbbrev(d)} · ${humanDateShort(d)}`;
      if (!m) {
        return `<div class="entry-item"><div class="entry-icon">·</div><div class="entry-body">
          <div class="entry-title">${label}</div><div class="entry-meta">sem registro nesse dia</div></div></div>`;
      }
      const mood = MOOD_BY_ID[m.mood];
      const withMood = m.mood_partner ? MOOD_BY_ID[m.mood_partner] : null;
      const talk = TALK_BY_ID[m.wants_to_talk];
      return `
        <div class="entry-item">
          <div class="entry-icon">${mood?.emoji || "❔"}</div>
          <div class="entry-body">
            <div class="entry-title">${label}</div>
            <div class="entry-meta" style="margin-top:2px;">Geral: <strong style="color:var(--text);">${gen(mood?.label || escapeHTML(m.mood), genderOf(role))}</strong></div>
            ${withMood ? `<div class="entry-meta">Com ${withWhom}: ${withMood.emoji} <strong style="color:var(--text);">${gen(withMood.label, genderOf(role))}</strong></div>` : ""}
            ${talk ? `<div class="entry-meta">${talk.emoji} ${talk.label}</div>` : ""}
            ${m.note ? `<div class="entry-meta" style="margin-top:4px;">"${escapeHTML(m.note)}"</div>` : ""}
          </div>
        </div>`;
    }).join("");
    $("#modal-sheet").querySelector("#mood-hist-body").innerHTML = `<div class="stack">${rows}</div>`;
    $("#modal-sheet").querySelectorAll("[data-hist-role]").forEach((b) => {
      b.className = `btn ${b.dataset.histRole === role ? "btn-primary" : "btn-secondary"} btn-sm`;
    });
  };
  openModal(`
    <h3 class="modal-title">📅 Últimos 7 dias</h3>
    <div class="row" style="gap:8px; margin-bottom:12px;">
      ${[otherRole(), State.role].map((r) => `<button type="button" class="btn btn-secondary btn-sm" style="flex:1;" data-hist-role="${r}">${ROLE_EMOJI[r]} ${r === State.role ? "Você" : ROLE_LABEL[r]}</button>`).join("")}
    </div>
    <div id="mood-hist-body"></div>
  `);
  $("#modal-sheet").querySelectorAll("[data-hist-role]").forEach((b) => {
    b.addEventListener("click", () => { role = b.dataset.histRole; render(); });
  });
  render();
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
  d.textContent = s ?? "";
  return d.innerHTML;
}

// preenche um elemento .avatar (círculo já com tamanho/cor certos via CSS) com a foto, se
// tiver, ou a inicial do nome — usado no badge do topo e em qualquer lista de gente
function setAvatarBadge(selector, name, avatarUrl) {
  const el = $(selector);
  if (!el) return;
  if (avatarUrl) {
    el.innerHTML = `<img src="${escapeHTML(avatarUrl)}" alt="" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" />`;
  } else {
    el.textContent = (name || "?").trim()[0]?.toUpperCase() || "?";
  }
}

function avatarHTML(name, avatarUrl, extraStyle = "") {
  const initial = (name || "?").trim()[0]?.toUpperCase() || "?";
  return avatarUrl
    ? `<img class="avatar" src="${escapeHTML(avatarUrl)}" alt="" style="object-fit:cover; ${extraStyle}" />`
    : `<div class="avatar" style="${extraStyle}">${escapeHTML(initial)}</div>`;
}

// toca no avatar (casal ou amigos) pra trocar a foto de perfil; no modo casal, o nome
// continua se editando por "Nomes e emojis" (edita os dois de uma vez, não só o seu)
async function openEditProfileModal(mode) {
  const isAmigos = mode === "amigos";
  let currentName = "";
  let currentAvatar = null;
  if (isAmigos) {
    const members = await friends.listGroupMembers(State.friendGroup.id).catch(() => []);
    const me = members.find((m) => m.user_id === State.userId);
    currentName = me?.display_name || State.friendGroup.myDisplayName || "";
    currentAvatar = me?.avatar_url || null;
  } else {
    currentName = myDisplayName();
    currentAvatar = State.profile?.avatar_url || null;
  }

  openModal(`
    <h3 class="modal-title">👤 Editar perfil</h3>
    <input type="file" id="ep-file" accept="image/*" style="display:none;" />
    <div style="text-align:center; margin:8px 0 4px; cursor:pointer;" id="ep-avatar-wrap">
      ${avatarHTML(currentName, currentAvatar, "width:84px; height:84px; font-size:32px; margin:0 auto;")}
    </div>
    <p class="hint-text" style="text-align:center; margin:0 0 14px;">📷 Toque na foto pra trocar</p>
    ${isAmigos ? `
      <label class="field-label">Seu nome nessa turma</label>
      <input type="text" id="ep-name" maxlength="24" value="${escapeHTML(currentName)}" />
    ` : `
      <p class="hint-text">Pra trocar seu nome, usa "✏️ Nomes e emojis" lá no Perfil.</p>
    `}
    <button class="btn btn-primary btn-block" style="margin-top:14px;" id="ep-save">Salvar</button>
    <p class="error-text" id="ep-error"></p>
  `);

  let selectedBlob = null;
  $("#ep-avatar-wrap").addEventListener("click", () => $("#ep-file").click());
  $("#ep-file").addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      selectedBlob = await compressImage(file, 512);
      $("#ep-avatar-wrap").innerHTML = avatarHTML(currentName, URL.createObjectURL(selectedBlob), "width:84px; height:84px; font-size:32px; margin:0 auto;");
    } catch (e) {
      $("#ep-error").textContent = "Não deu pra usar essa foto: " + (e.message || e);
    }
  });

  $("#ep-save").addEventListener("click", async () => {
    const err = (m) => { $("#ep-error").textContent = m; };
    setBusy("#ep-save", true);
    try {
      let newAvatarUrl = currentAvatar;
      if (selectedBlob) newAvatarUrl = await db.uploadMyAvatar(State.userId, selectedBlob);
      if (isAmigos) {
        const newName = cleanName($("#ep-name").value);
        if (!newName) { err("Escreve seu nome."); setBusy("#ep-save", false); return; }
        if (newName !== currentName) await friends.updateMyDisplayName(State.friendGroup.id, State.userId, newName);
        State.friendGroup.myDisplayName = newName;
        setAvatarBadge("#friends-avatar-badge", newName, newAvatarUrl);
      } else {
        State.profile = { ...State.profile, avatar_url: newAvatarUrl };
        setAvatarBadge("#avatar-badge", currentName, newAvatarUrl);
      }
      closeModal();
      if (isAmigos) renderFriendsActiveTab();
    } catch (e) {
      err("Não deu: " + (e.message || e));
      setBusy("#ep-save", false);
    }
  });
}

// cabeçalho com "← Voltar" usado por toda tela dentro do hub de Recadinhos
function subViewHeader(title) {
  return `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
      <button class="btn btn-ghost btn-sm" id="btn-notes-back" style="flex:none; padding:9px 12px;">← Voltar</button>
      <h2 style="font-family:'Baloo 2', sans-serif; font-size:19px; margin:0;">${title}</h2>
    </div>
  `;
}
function wireNotesBack() {
  $("#btn-notes-back")?.addEventListener("click", () => { State.notesView = "hub"; renderNotes(); });
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
    ${subViewHeader("✉️ Convites")}
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
        ${coinsOn() ? `<span class="pill pill-coin">💰 você tem ${myCoins}</span>` : ""}
        <button class="btn btn-primary" id="send-invite" ${coinsOn() && myCoins < coinRule("invite") ? "disabled" : ""}>Enviar convite${costTag("invite")}</button>
      </div>
      ${coinsOn() ? `<p class="hint-text" style="margin-top:8px;">Se ${partnerThey()} recusar, a moeda volta pra você.</p>` : ""}
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

  wireNotesBack();
  $("#send-invite").addEventListener("click", async () => {
    const title = $("#invite-title").value.trim();
    if (!title) { alert("Escreve um título pro convite :)"); return; }
    setBusy("#send-invite", true);
    try {
      await addCoins(State.role, -coinRule("invite"), "enviou um convite");
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
        } else if (act === "undo") {
          const entry = all.find((e) => e.id === id);
          await undoEntryStatus(entry);
        } else if (act === "delete") {
          const entry = all.find((e) => e.id === id);
          const deleted = await deleteEntryWithConfirm(entry);
          if (!deleted) { btn.disabled = false; return; }
        }
        await renderInvites();
        updateNotesNavBadge();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

// ================= RECADINHOS =================

// aba Recadinhos virou uma central: essa função só roteia pra tela certa
async function renderNotes() {
  const map = {
    hub: renderNotesHub, history: renderNotesHistory,
    challenge: renderChallengeView, capsule: renderCapsuleView,
    wishes: renderWishesView, invites: renderInvites, memories: renderMemoriesView,
  };
  (map[State.notesView] || renderNotesHub)();
}

async function renderNotesHub() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const todayStr = todayISO();

  const [notes, noteReactions, todayAnswers, capsules, redemptions, invites, coins, memories, memoryReactions] = await Promise.all([
    db.listRecentSweetNotes(State.coupleId, 5),
    db.listReactions(State.coupleId, "note").catch(() => null), // null = recurso ainda não ativado no banco
    db.getChallengeAnswersForDay(State.coupleId, todayStr),
    db.listTimeCapsules(State.coupleId),
    db.listWishRedemptions(State.coupleId),
    db.listAllInvites(State.coupleId),
    feat("miss") ? db.getCoinBalances(State.coupleId) : Promise.resolve({}),
    db.listMemories(State.coupleId, 10).catch(() => null), // null = recurso ainda não ativado no banco
    db.listReactions(State.coupleId, "memory").catch(() => null),
  ]);
  const memoriesPending = memories ? memories.filter((m) => m.role !== State.role && m.reply_role !== State.role && !(memoryReactions || []).some((r) => r.target_id === m.id && r.role === State.role)).length : 0;

  const myLastNote = notes.find((n) => n.role === State.role);
  const iSentToday = notes.some((n) => n.role === State.role && n.created_at.slice(0, 10) === todayStr);
  const theirNoteToday = notes.find((n) => n.role !== State.role && n.created_at.slice(0, 10) === todayStr);
  const myAnswerToday = todayAnswers.find((a) => a.role === State.role);
  const pendingInvites = invites.filter((e) => e.status === "pendente" && e.created_by !== State.role);
  const readyRedemptions = redemptions.filter((r) => r.redeemed_by === State.role && r.reveal_on <= todayStr && !r.fulfilled);

  view.innerHTML = `
    <div class="card-tab-wrap">
      <span class="card-tab">💌 Recadinho fofo</span>
    <div class="card">
      ${theirNoteToday ? `<div class="entry-meta" style="margin-bottom:10px; color:var(--text);">${ROLE_LABEL[otherRole()]}: "${escapeHTML(theirNoteToday.message)}"</div>${noteReactions ? reactionBarHTML("note", theirNoteToday.id, noteReactions) : ""}` : ""}
      ${noteReactions && myLastNote ? reactionGotHTML(myLastNote.id, noteReactions, "ao seu último recadinho") : ""}
      <div class="card-sub">${!coinsOn() || coinRule("note") === 0 ? (iSentToday ? "Você já mandou um hoje. Pode mandar outro." : gen("Manda um recadinho fofo pra ele(a).", genderOf(otherRole()))) : iSentToday ? "Você já mandou um hoje. Pode mandar outro, mas a moeda já foi." : `O primeiro recadinho do dia já dá ${coinWord(coinRule("note"))} pra você.`}</div>
      <button class="btn btn-primary btn-block" style="margin-top:12px;" id="btn-send-note">💌 Mandar recadinho</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px;" id="btn-notes-history">Ver histórico completo →</button>
    </div>
    </div>

${feat("miss") ? `    <div class="card">
      <div class="card-title" style="font-size:15px;">Mandar sinal de saudade</div>
      <div class="card-sub">${coinsOn() && coinRule("miss") > 0 ? `Gasta ${coinWord(coinRule("miss"))} 💰 e manda` : "Manda"} um pedido de visita pra ${ROLE_LABEL[otherRole()]} aprovar.</div>
      <div class="row" style="align-items:center;">
        ${coinsOn() ? `<span class="pill pill-coin">💰 você tem ${coins[State.role] || 0}</span>` : ""}
        <button class="btn btn-warm" id="btn-saudade" ${(coinsOn() && (coins[State.role] || 0) < coinRule("miss")) ? "disabled" : ""}>🥺 Mandar sinal</button>
      </div>
    </div>` : ""}

    <div class="section-title">Atalhos</div>
    <div class="shortcut-grid">
${feat("daily") ? `      <button class="shortcut-card" data-view="challenge">
        <span class="shortcut-icon">${icon("target", { size: 24 })}</span>
        <span class="shortcut-title">Desafio do dia</span>
        <span class="shortcut-sub">${myAnswerToday ? "Respondido ✓" : "Responder agora"}</span>
      </button>` : ""}
${feat("capsule") ? `      <button class="shortcut-card" data-view="capsule">
        <span class="shortcut-icon">${icon("clock", { size: 24 })}</span>
        <span class="shortcut-title">Cápsula do tempo</span>
        <span class="shortcut-sub">${capsules.length ? `${capsules.length} guardada${capsules.length === 1 ? "" : "s"}` : "Nenhuma ainda"}</span>
      </button>` : ""}
${feat("wishes") ? `      <button class="shortcut-card" data-view="wishes">
        <span class="shortcut-icon">${icon("gift", { size: 24 })}</span>
        <span class="shortcut-title">Desejos secretos</span>
        <span class="shortcut-sub">${readyRedemptions.length ? "Tem resgate revelado!" : "Ver desejos"}</span>
        ${readyRedemptions.length ? `<span class="dot-badge" style="position:absolute; top:10px; right:10px;"></span>` : ""}
      </button>` : ""}
      <button class="shortcut-card" data-view="invites">
        <span class="shortcut-icon">${icon("mail", { size: 24 })}</span>
        <span class="shortcut-title">Convites</span>
        <span class="shortcut-sub">${pendingInvites.length ? `${pendingInvites.length} esperando você` : "Nenhum pendente"}</span>
        ${pendingInvites.length ? `<span class="dot-badge" style="position:absolute; top:10px; right:10px;"></span>` : ""}
      </button>
      <button class="shortcut-card" data-view="memories">
        <span class="shortcut-icon">${icon("camera", { size: 24 })}</span>
        <span class="shortcut-title">Lembrei de você</span>
        <span class="shortcut-sub">${memories === null ? "Ver" : memoriesPending ? `${memoriesPending} nova${memoriesPending === 1 ? "" : "s"}` : "Mandar uma foto"}</span>
        ${memoriesPending ? `<span class="dot-badge" style="position:absolute; top:10px; right:10px;"></span>` : ""}
      </button>
    </div>
  `;

  $("#btn-send-note")?.addEventListener("click", () => openSweetNoteModal(iSentToday));
  $("#btn-saudade")?.addEventListener("click", openSaudadeModal);
  wireReactions();
  $("#btn-notes-history")?.addEventListener("click", () => { State.notesView = "history"; renderNotes(); });
  document.querySelectorAll(".shortcut-card").forEach((btn) => {
    btn.addEventListener("click", () => { State.notesView = btn.dataset.view; renderNotes(); });
  });
}

async function renderNotesHistory() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const [notes, noteReactions] = await Promise.all([
    db.listRecentSweetNotes(State.coupleId, 500),
    db.listReactions(State.coupleId, "note").catch(() => null),
  ]);
  view.innerHTML = `
    ${subViewHeader("💌 Histórico de recadinhos")}
    <div class="card">
      ${notes.length ? `<div class="stack">${notes.map((n) => `
        <div class="entry-item">
          <div class="entry-icon">${ROLE_EMOJI[n.role]}</div>
          <div class="entry-body">
            <div class="entry-title">${ROLE_LABEL[n.role]}</div>
            <div class="entry-meta">"${escapeHTML(n.message)}"</div>
            <div class="entry-meta" style="opacity:.7; margin-top:2px;">${formatNoteTimestamp(n.created_at)}</div>
            ${noteReactions ? (n.role === State.role ? reactionGotHTML(n.id, noteReactions, "a esse recadinho") : reactionBarHTML("note", n.id, noteReactions)) : ""}
          </div>
        </div>
      `).join("")}</div>` : `<div class="empty-state">${icon("mail", { size: 34, className: "empty-icon" })}Nenhum recadinho ainda. Manda o primeiro!</div>`}
    </div>
  `;
  wireNotesBack();
  wireReactions();
}

async function renderChallengeView() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const todayStr = todayISO();
  const since60 = toISODate(addDays(new Date(), -60));

  const [todayAnswers, challengeHistory] = await Promise.all([
    db.getChallengeAnswersForDay(State.coupleId, todayStr),
    db.listChallengeAnswersHistory(State.coupleId, since60),
  ]);

  const todayIdx = dayIndexSince(State.coupleCreatedAt);
  const todayChallenge = genMixed(challengeForDay(todayIdx), genderOf(State.role), genderOf(otherRole()));
  const myAnswerToday = todayAnswers.find((a) => a.role === State.role);
  const theirAnswerToday = todayAnswers.find((a) => a.role !== State.role);

  const historyDays = [...new Set(challengeHistory.map((r) => r.day))]
    .filter((d) => d !== todayStr)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, 10);

  view.innerHTML = `
    ${subViewHeader("🎯 Desafio do dia")}
    <div class="card" style="background:var(--warm-soft);">
      <div class="card-title" style="font-size:15.5px; font-family:'Baloo 2', sans-serif;">"${todayChallenge}"</div>
      ${myAnswerToday ? `
        <div class="entry-meta" style="margin-top:8px; color:var(--text);">Você: "${escapeHTML(myAnswerToday.answer)}"</div>
      ` : `
        <textarea id="challenge-answer" rows="2" placeholder="escreve aqui..." style="margin-top:10px;"></textarea>
        <button class="btn btn-warm btn-block" style="margin-top:10px;" id="btn-answer-challenge">Responder desafio${earnTag("daily")}</button>
      `}
      ${theirAnswerToday
        ? `<div class="entry-meta" style="margin-top:8px; color:var(--text);">${ROLE_LABEL[otherRole()]}: "${escapeHTML(theirAnswerToday.answer)}"</div>`
        : `<p class="hint-text" style="margin-top:8px;">${ROLE_LABEL[otherRole()]} ainda não respondeu hoje.</p>`}
    </div>
    ${historyDays.length ? `
      <div class="card">
        <div class="card-title" style="font-size:14px;">Desafios anteriores</div>
        <div class="stack">${historyDays.map((day) => {
          const dayAnswers = challengeHistory.filter((r) => r.day === day);
          const prompt = genMixed(challengeForDay(dayIndexSince(State.coupleCreatedAt, parseISODate(day))), genderOf(State.role), genderOf(otherRole()));
          return `
            <div class="entry-item">
              <div class="entry-icon">🎯</div>
              <div class="entry-body">
                <div class="entry-title">${prompt}</div>
                <div class="entry-meta">${humanDateShort(parseISODate(day))}</div>
                ${dayAnswers.map((a) => `<div class="entry-meta" style="margin-top:4px; color:var(--text);">${ROLE_LABEL[a.role]}: "${escapeHTML(a.answer)}"</div>`).join("")}
              </div>
            </div>
          `;
        }).join("")}</div>
      </div>
    ` : ""}
  `;

  wireNotesBack();
  $("#btn-answer-challenge")?.addEventListener("click", async () => {
    const answer = $("#challenge-answer").value.trim();
    if (!answer) { alert("Escreve uma resposta primeiro :)"); return; }
    setBusy("#btn-answer-challenge", true);
    try {
      await db.upsertChallengeAnswer(State.coupleId, todayStr, State.role, answer);
      await earnCoins(State.role, coinRule("daily"), "respondeu o desafio do dia");
      await renderNotes();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#btn-answer-challenge", false);
    }
  });
}

async function renderCapsuleView() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const capsules = await db.listTimeCapsules(State.coupleId);

  view.innerHTML = `
    ${subViewHeader("🕰️ Cápsula do tempo")}
    <div class="card">
      <div class="card-sub">Escreva algo agora, só pode ser aberta na data que você escolher.</div>
      <textarea id="capsule-text" rows="3" placeholder="daqui uns anos, quero que você lembre que..."></textarea>
      <label class="field-label">Abrir em</label>
      <input type="date" id="capsule-date" min="${toISODate(addDays(new Date(), 1))}" value="${toISODate(addDays(new Date(), 30))}" />
      <button class="btn btn-primary btn-block" style="margin-top:12px;" id="btn-seal-capsule">Selar cápsula 💌</button>
    </div>
    <div class="card">
      ${capsules.length ? `<div class="stack">${capsules.map(capsuleItemHTML).join("")}</div>` : `<div class="empty-state"><span class="emoji">🕰️</span>Nenhuma cápsula ainda.</div>`}
    </div>
  `;

  wireNotesBack();
  $("#btn-seal-capsule")?.addEventListener("click", async () => {
    const message = $("#capsule-text").value.trim();
    const openOn = $("#capsule-date").value;
    if (!message) { alert("Escreve alguma coisa primeiro :)"); return; }
    if (!openOn) { alert("Escolhe uma data pra abrir :)"); return; }
    setBusy("#btn-seal-capsule", true);
    try {
      await db.createTimeCapsule(State.coupleId, State.role, message, openOn);
      await renderNotes();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#btn-seal-capsule", false);
    }
  });
}

// ---------------- Lembrei de você ----------------

function memoryItemHTML(m, myReaction, partnerReaction) {
  const mine = m.role === State.role;
  const reactedByMe = mine ? partnerReaction : myReaction; // reação de quem NÃO postou essa foto
  const canRespond = !mine;
  return `
    <div class="card" data-memory="${m.id}">
      <div class="row" style="align-items:center; margin-bottom:8px;">
        <div class="card-title" style="font-size:14px; margin-bottom:0;">${ROLE_LABEL[m.role]}${mine ? " (você)" : ""}</div>
        <div class="hint-text" style="margin:0;">${formatNoteTimestamp(m.created_at)}</div>
      </div>
      <div class="memory-photo-wrap"><img class="memory-photo" data-path="${escapeHTML(m.photo_path)}" alt="" /></div>
      <div class="entry-meta" style="margin-top:8px; color:var(--text);">"${escapeHTML(m.caption)}"</div>
      ${m.reply_text ? `
        <div class="entry-meta" style="margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">
          <strong>${ROLE_LABEL[m.reply_role]}:</strong> "${escapeHTML(m.reply_text)}"
        </div>
      ` : ""}
      ${reactedByMe ? `<div class="react-got"><span class="react-got-emoji">${reactedByMe}</span> reagiu</div>` : ""}
      ${canRespond ? `
        <div class="react-bar" data-memory-react="${m.id}" style="margin-top:10px;">
          ${REACTION_EMOJIS.map((e) => `<button type="button" class="react-btn ${myReaction === e ? "selected" : ""}" data-emoji="${e}">${e}</button>`).join("")}
        </div>
        ${!m.reply_text ? `
          <div class="row" style="margin-top:8px; gap:8px;">
            <input type="text" class="memory-reply-input" data-id="${m.id}" maxlength="300" placeholder="escreve um comentário (opcional)" style="flex:1;" />
            <button type="button" class="btn btn-secondary btn-sm" data-act="memory-reply" data-id="${m.id}" style="flex:none;">Comentar</button>
          </div>
        ` : ""}
      ` : ""}
    </div>
  `;
}

async function renderMemoriesView() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const [memories, memoryReactions, todayCount] = await Promise.all([
    db.listMemories(State.coupleId, 30),
    db.listReactions(State.coupleId, "memory"),
    db.countMyMemoriesToday(State.coupleId, State.role),
  ]);
  const atLimit = todayCount >= 5;

  view.innerHTML = `
    ${subViewHeader("📷 Lembrei de você")}
    <div class="card">
      <div class="card-sub">Uma foto de algo que te lembrou ${ROLE_LABEL[otherRole()]} hoje, com uma observação. Ex.: "esse Danone me lembrou de você..."</div>
      ${atLimit ? `<p class="hint-text" style="margin-top:8px;">Você já mandou 5 hoje, o limite volta amanhã.</p>` : `
        <input type="file" id="memory-file" accept="image/*" style="display:none;" />
        <div id="memory-picker" style="border:2px dashed var(--surface-alt); border-radius:14px; padding:24px 10px; text-align:center; cursor:pointer; margin-top:10px;">
          <div style="font-size:28px;">📷</div>
          <div class="hint-text" style="margin-top:4px;">Toque pra tirar ou escolher uma foto</div>
        </div>
        <div id="memory-preview" style="display:none; margin-bottom:10px; text-align:center; cursor:pointer;"><img id="memory-preview-img" style="max-width:100%; max-height:200px; border-radius:12px;" /><div class="hint-text" style="margin-top:4px;">Toque pra trocar a foto</div></div>
        <textarea id="memory-caption" rows="2" maxlength="300" placeholder="esse Danone me lembrou de você..."></textarea>
        <button class="btn btn-primary btn-block" style="margin-top:12px;" id="btn-send-memory">📷 Mandar lembrança</button>
        <p class="error-text" id="memory-err" style="margin-top:8px;" hidden></p>
      `}
    </div>

    <div class="section-title">Lembranças</div>
    <div class="stack" id="memory-list">
      ${memories.length ? memories.map((m) => {
        const myReaction = memoryReactions.find((r) => r.target_id === m.id && r.role === State.role)?.emoji;
        const partnerReaction = memoryReactions.find((r) => r.target_id === m.id && r.role !== State.role)?.emoji;
        return memoryItemHTML(m, myReaction, partnerReaction);
      }).join("") : `<div class="empty-state">${icon("camera", { size: 34, className: "empty-icon" })}Nenhuma lembrança ainda. Mande a primeira foto!</div>`}
    </div>
    <p class="hint-text" style="text-align:center; margin-top:8px;">As fotos ficam guardadas por 30 dias e depois somem sozinhas.</p>
  `;

  wireNotesBack();

  // mostra as fotos (o espaço é privado, então cada uma precisa de um link temporário)
  view.querySelectorAll(".memory-photo").forEach((img) => {
    db.memoryPhotoUrl(img.dataset.path).then((url) => { img.src = url; }).catch(() => { img.alt = "Não deu pra carregar a foto"; });
  });

  let selectedBlob = null;
  $("#memory-picker")?.addEventListener("click", () => $("#memory-file").click());
  $("#memory-preview")?.addEventListener("click", () => $("#memory-file").click());
  $("#memory-file")?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    setBusy("#btn-send-memory", true);
    try {
      selectedBlob = await compressImage(file);
      $("#memory-preview-img").src = URL.createObjectURL(selectedBlob);
      $("#memory-picker").style.display = "none";
      $("#memory-preview").style.display = "";
    } catch (e) {
      $("#memory-err").hidden = false;
      $("#memory-err").textContent = "Não deu pra usar essa foto: " + (e.message || e);
    } finally {
      setBusy("#btn-send-memory", false);
    }
  });

  $("#btn-send-memory")?.addEventListener("click", async () => {
    const caption = $("#memory-caption").value.trim();
    if (!selectedBlob) { $("#memory-err").hidden = false; $("#memory-err").textContent = "Escolhe uma foto primeiro."; return; }
    if (!caption) { $("#memory-err").hidden = false; $("#memory-err").textContent = "Escreve o que essa foto te lembrou."; return; }
    setBusy("#btn-send-memory", true);
    try {
      await db.createMemory(State.coupleId, State.role, selectedBlob, caption);
      await renderNotes();
    } catch (e) {
      $("#memory-err").hidden = false;
      $("#memory-err").textContent = e.message === "limite_diario" ? "Você já mandou 5 hoje, o limite volta amanhã." : "Não deu: " + (e.message || e);
      setBusy("#btn-send-memory", false);
    }
  });

  async function respondTo(id, { emoji, reply }) {
    try {
      await db.reactToMemory(State.coupleId, id, State.role, { emoji, reply });
      const gotPoint = await db.markMemoryPointsAwarded(id);
      if (gotPoint) {
        const m = memories.find((x) => x.id === id);
        await Promise.all([earnCoins(State.role, coinRule("memory"), "lembrei de você"), earnCoins(m.role, coinRule("memory"), "lembrei de você")]);
      }
      await renderNotes();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
    }
  }

  view.querySelectorAll("[data-memory-react]").forEach((bar) => {
    bar.querySelectorAll(".react-btn").forEach((btn) => {
      btn.addEventListener("click", () => respondTo(bar.dataset.memoryReact, { emoji: btn.dataset.emoji }));
    });
  });
  view.querySelectorAll("[data-act='memory-reply']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = view.querySelector(`.memory-reply-input[data-id="${btn.dataset.id}"]`);
      const reply = input?.value.trim();
      if (!reply) return;
      respondTo(btn.dataset.id, { reply });
    });
  });
}

async function renderWishesView() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const todayStr = todayISO();
  const [myWishes, redemptions, coins] = await Promise.all([
    db.getWishesForRole(State.coupleId, State.role),
    db.listWishRedemptions(State.coupleId),
    db.getCoinBalances(State.coupleId),
  ]);
  const myCoins = coins[State.role] || 0;

  view.innerHTML = `
    ${subViewHeader("🎁 Desejos secretos")}
    <div class="card">
      <div class="card-sub">Até 3 desejos guardados só seus, ${ROLE_LABEL[otherRole()]} não vê o que você escreveu aqui.</div>
      ${[1, 2, 3].map((slot) => {
        const w = myWishes.find((x) => x.slot === slot);
        return `<input type="text" class="wish-input" data-slot="${slot}" maxlength="120" style="margin-top:8px;" value="${escapeHTML(w?.text || "")}" placeholder="desejo ${slot}, ex: um dia de spa" />`;
      }).join("")}
      <button class="btn btn-secondary btn-block" style="margin-top:12px;" id="btn-save-wishes">Salvar meus desejos</button>
    </div>
    <div class="card">
      <div class="card-title" style="font-size:15px;">Resgatar um desejo de ${ROLE_LABEL[otherRole()]}</div>
      <div class="card-sub">Sorteia um às cegas, você só descobre qual foi amanhã.</div>
      <div class="row" style="align-items:center;">
        ${coinsOn() ? `<span class="pill pill-coin">💰 você tem ${myCoins}</span>` : ""}
        <button class="btn btn-plum" id="btn-redeem-wish" ${coinsOn() && myCoins < coinRule("wish") ? "disabled" : ""}>🎁 Resgatar às cegas${costTag("wish")}</button>
      </div>
    </div>
    ${redemptions.length ? `
      <div class="card">
        <div class="card-title" style="font-size:14px;">Resgates</div>
        <div class="stack">${redemptions.map(redemptionItemHTML).join("")}</div>
      </div>
    ` : ""}
  `;

  wireNotesBack();
  $("#btn-save-wishes")?.addEventListener("click", async () => {
    setBusy("#btn-save-wishes", true);
    try {
      const inputs = document.querySelectorAll(".wish-input");
      await Promise.all(Array.from(inputs).map((inp) => db.upsertWish(State.coupleId, State.role, Number(inp.dataset.slot), inp.value.trim())));
      await renderNotes();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#btn-save-wishes", false);
    }
  });

  $("#btn-redeem-wish")?.addEventListener("click", async () => {
    setBusy("#btn-redeem-wish", true);
    try {
      const partnerWishes = await db.getWishesForRole(State.coupleId, otherRole());
      const filled = partnerWishes.filter((w) => w.text && w.text.trim());
      if (!filled.length) {
        alert(`${ROLE_LABEL[otherRole()]} ainda não escreveu nenhum desejo.`);
        setBusy("#btn-redeem-wish", false);
        return;
      }
      const pick = filled[Math.floor(Math.random() * filled.length)];
      await addCoins(State.role, -coinRule("wish"), "resgatou um desejo às cegas");
      const revealOn = toISODate(addDays(new Date(), 1));
      await db.createWishRedemption(State.coupleId, State.role, otherRole(), pick.text, revealOn);
      await renderNotes();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#btn-redeem-wish", false);
    }
  });

  document.querySelectorAll('[data-act="fulfill-wish"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await db.markWishFulfilled(btn.dataset.id);
        await renderNotes();
        updateNotesNavBadge();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

function capsuleItemHTML(c) {
  const mine = c.from_role === State.role;
  const opensToday = c.open_on <= todayISO();
  const canRead = mine || opensToday;
  const timing = opensToday ? `Aberta em ${humanDateShort(parseISODate(c.open_on))}` : `Abre ${daysUntilLabel(parseISODate(c.open_on))}`;
  return `
    <div class="entry-item">
      <div class="entry-icon">${canRead ? "🔓" : "🔒"}</div>
      <div class="entry-body">
        <div class="entry-title">De ${ROLE_LABEL[c.from_role]} ${mine ? `pra ${ROLE_LABEL[otherRole()]}` : "pra você"}</div>
        <div class="entry-meta">${timing}</div>
        ${canRead
          ? `<div class="entry-meta" style="margin-top:6px; color:var(--text);">"${escapeHTML(c.message)}"</div>`
          : `<div class="entry-meta" style="margin-top:6px; filter:blur(4px); user-select:none;">${"• ".repeat(18)}</div>`}
      </div>
    </div>
  `;
}

function redemptionItemHTML(r) {
  const ready = r.reveal_on <= todayISO();
  const iAmRedeemer = r.redeemed_by === State.role;
  const label = iAmRedeemer ? `Você resgatou de ${ROLE_LABEL[r.wish_owner]}` : `${ROLE_LABEL[r.redeemed_by]} resgatou um desejo seu`;
  return `
    <div class="entry-item">
      <div class="entry-icon">${ready ? "🎁" : "🔒"}</div>
      <div class="entry-body">
        <div class="entry-title">${label}</div>
        ${ready ? `
          <div class="entry-meta" style="margin-top:4px; font-weight:800; color:var(--text);">"${escapeHTML(r.wish_text)}"</div>
          ${iAmRedeemer ? (r.fulfilled
            ? `<span class="pill pill-success" style="margin-top:8px;">Cumprido 🎉</span>`
            : `<button class="btn btn-success btn-sm" style="margin-top:8px;" data-act="fulfill-wish" data-id="${r.id}">Marcar como cumprido ✅</button>`
          ) : ""}
        ` : `<div class="entry-meta" style="margin-top:4px;">Revela ${daysUntilLabel(parseISODate(r.reveal_on))}</div>`}
      </div>
    </div>
  `;
}

function formatNoteTimestamp(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${humanDateShort(d)} · ${hh}:${mm}`;
}

// ================= LOJINHA =================

// ================= JOGOS (Capivarinhas) =================
// o motor e as fases (js/games/) não sabem nada de casal, turma ou moeda — só devolvem um
// tabuleiro e dizem se ganhou. Aqui é onde isso se liga ao resto do app.

const STAR_BATTLE_GAME_ID = "star_battle";
const STAR_BATTLE_PALETTE = ["#ffb3c6", "#ffd679", "#c3b2ef", "#7bd6c4", "#a8cf7d", "#8fc7ee", "#f2a6c9", "#e0b36b", "#9fd0e6", "#c9e08a"];
const STAR_BATTLE_LIVES = 3;
const coinsForStarBattleLevel = (size) => size;

function starBattleBoardHTML(size, regions, grid) {
  let cells = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const bg = STAR_BATTLE_PALETTE[regions[r][c] % STAR_BATTLE_PALETTE.length];
      const state = grid[r][c];
      const mark = state === CELL_MARK ? `<span class="sbg-x">✕</span>` : state === CELL_CAT ? "🦫" : "";
      const locked = state === CELL_CAT ? "cursor:default;" : "";
      cells += `<div class="sbg-cell" data-r="${r}" data-c="${c}" style="background:${bg}; ${locked}">${mark}</div>`;
    }
  }
  return `<div class="sbg-board" style="grid-template-columns:repeat(${size}, 1fr);">${cells}</div>`;
}

function starBattleHeartsHTML(livesLeft) {
  return Array.from({ length: STAR_BATTLE_LIVES }, (_, i) => (i < livesLeft ? "❤️" : "🤍")).join(" ");
}

async function renderStarBattleGame(scope) {
  const isAmigos = scope === "amigos";
  const container = isAmigos ? $("#friends-view") : view;
  const accentStrong = isAmigos ? "var(--friends-accent-strong)" : "var(--accent-strong)";
  const accentSoft = isAmigos ? "var(--friends-accent-soft)" : "var(--accent-soft)";
  const accentBtn = isAmigos ? "var(--friends-accent)" : "var(--accent-btn)";
  const onAccentBtn = isAmigos ? "var(--on-friends-accent)" : "var(--on-accent-btn)";
  const backFn = isAmigos ? renderFriendsShop : renderShop;

  container.innerHTML = `<div class="center-note">Carregando...</div>`;
  const currentLevel = isAmigos
    ? await friends.getGameProgress(State.friendGroup.id, STAR_BATTLE_GAME_ID).catch(() => 1)
    : await db.getGameProgress(State.coupleId, STAR_BATTLE_GAME_ID).catch(() => 1);
  const levelData = STAR_BATTLE_LEVELS[Math.min(currentLevel, STAR_BATTLE_LEVELS.length) - 1];
  let grid = emptyGrid(levelData.size);
  let livesLeft = STAR_BATTLE_LIVES;
  let over = false;

  container.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="sbg-back" style="margin-bottom:10px;">← Voltar</button>
    <div class="card" style="background:${accentSoft}; text-align:center; padding:14px;">
      <div style="font-family:'Baloo 2',sans-serif; font-weight:800; color:${accentStrong};">🦫 Capivarinhas · Fase ${currentLevel}</div>
      <div class="row" style="justify-content:center; gap:14px; margin-top:8px;">
        <span id="sbg-counter" style="font-weight:800; color:${accentStrong};"></span>
        <span id="sbg-hearts"></span>
      </div>
      <div class="row" style="justify-content:center; gap:5px; margin-top:10px; flex-wrap:wrap;">
        <span style="font-size:9.5px; font-weight:700; padding:3px 8px; border-radius:999px; background:${accentBtn}; color:${onAccentBtn};">1 capivara por cor</span>
        <span style="font-size:9.5px; font-weight:700; padding:3px 8px; border-radius:999px; background:${accentSoft}; color:${accentStrong};">1 por linha e coluna</span>
        <span style="font-size:9.5px; font-weight:700; padding:3px 8px; border-radius:999px; background:${accentSoft}; color:${accentStrong};">não se tocam</span>
      </div>
      <p class="hint-text" style="margin:8px 0 0;">Toque 1: marca ✕ (sem risco). Toque 2 na marcada: revela de verdade.</p>
    </div>
    <div id="sbg-board-wrap" style="margin-top:14px; display:flex; justify-content:center;"></div>
    <p class="hint-text" id="sbg-status" style="text-align:center; margin-top:10px;"></p>
  `;
  $("#sbg-back").addEventListener("click", () => backFn());
  const boardWrap = $("#sbg-board-wrap");

  function updateHud() {
    $("#sbg-counter").textContent = `🦫 ${countFound(grid)}/${levelData.size}`;
    $("#sbg-hearts").textContent = starBattleHeartsHTML(livesLeft);
  }

  function redraw() {
    updateHud();
    boardWrap.innerHTML = starBattleBoardHTML(levelData.size, levelData.regions, grid);
    if (over) return;
    boardWrap.querySelectorAll(".sbg-cell").forEach((cell) => {
      cell.addEventListener("click", async () => {
        const r = Number(cell.dataset.r), c = Number(cell.dataset.c);
        const state = grid[r][c];
        if (state === CELL_CAT) return;
        if (state === CELL_EMPTY) {
          markCell(grid, r, c);
          redraw();
          return;
        }
        const found = revealCell(levelData.solution, grid, r, c);
        if (found) {
          redraw();
          if (countFound(grid) === levelData.size) await onLevelWon();
        } else {
          livesLeft--;
          redraw();
          $("#sbg-status").textContent = livesLeft > 0 ? "❌ Não tinha capivara aí." : "💔 Acabaram os corações!";
          if (livesLeft <= 0) onOutOfLives();
        }
      });
    });
  }

  function onOutOfLives() {
    over = true;
    boardWrap.querySelectorAll(".sbg-cell").forEach((cell) => { cell.style.pointerEvents = "none"; cell.style.opacity = ".6"; });
    container.insertAdjacentHTML("beforeend", `
      <button class="btn btn-block" style="margin-top:14px; background:${accentBtn}; color:${onAccentBtn};" id="sbg-retry">Tentar de novo</button>
    `);
    $("#sbg-retry").addEventListener("click", () => {
      grid = emptyGrid(levelData.size);
      livesLeft = STAR_BATTLE_LIVES;
      over = false;
      $("#sbg-retry").remove();
      $("#sbg-status").textContent = "";
      redraw();
    });
  }

  async function onLevelWon() {
    over = true;
    const reward = coinsForStarBattleLevel(levelData.size);
    const nextLevel = Math.min(currentLevel + 1, STAR_BATTLE_LEVELS.length);
    $("#sbg-status").textContent = `🎉 Fase completa! +${reward} moedas`;
    try {
      if (isAmigos) {
        await friends.addCoinBonus(State.friendGroup.id, State.userId, reward, `Capivarinhas: fase ${currentLevel}`);
        await friends.advanceGameProgress(State.friendGroup.id, STAR_BATTLE_GAME_ID, nextLevel);
      } else {
        await earnCoins(State.role, reward, `Capivarinhas: fase ${currentLevel}`);
        await db.advanceGameProgress(State.coupleId, STAR_BATTLE_GAME_ID, nextLevel);
      }
    } catch (e) { /* progresso não salvou: continua jogável, tenta de novo na próxima fase */ }
    setTimeout(() => renderStarBattleGame(scope), 1400);
  }

  redraw();
}

async function renderShop() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const [coins, redemptions, customRows] = await Promise.all([
    db.getCoinBalances(State.coupleId),
    db.listShopRedemptions(State.coupleId),
    db.listCustomPerks(State.coupleId).catch(() => []),
  ]);
  const myCoins = coins[State.role] || 0;
  const pending = redemptions.filter((r) => r.status === "pendente");
  const fulfilled = redemptions.filter((r) => r.status === "cumprido");
  const customPerks = customRows.map(customToPerk);
  const perkById = { ...PERK_BY_ID, ...Object.fromEntries(customPerks.map((p) => [p.id, p])) };
  // valor que o casal ajustou pra um item geral (não mexe nos outros casais, só no de vocês)
  const perkCosts = State.settings?.features?.perk_costs || {};
  for (const id of Object.keys(PERK_BY_ID)) {
    const ov = perkCosts[id];
    if (Number.isInteger(ov) && ov >= 1 && ov <= 200) perkById[id] = { ...PERK_BY_ID[id], cost: ov, fulfillReward: suggestedReward(ov) };
  }
  // item apagado depois de resgatado: usa a recompensa sugerida pelo custo que ficou registrado
  const rewardFor = (r) => perkById[r.perk_id]?.fulfillReward ?? suggestedReward(r.cost);

  function perkCardHTML(p) {
    return `
      <div class="card">
        <div class="row" style="align-items:flex-start;">
          <div style="flex:0 0 auto; font-size:30px;">${escapeHTML(p.emoji)}</div>
          <div style="flex:1; min-width:0;">
            <div class="card-title" style="font-size:15px;">${escapeHTML(gen(p.title, genderOf(State.role)))}</div>
            ${p.desc ? `<div class="card-sub">${escapeHTML(p.desc)}</div>` : ""}
          </div>
          ${p.custom
            ? `<button class="btn btn-ghost btn-sm" style="flex:none;" data-act="edit-perk" data-id="${p.rowId}">✏️ Editar</button>`
            : `<button class="btn btn-ghost btn-sm" style="flex:none;" data-act="edit-cost" data-id="${p.id}">✏️ Valor</button>`}
        </div>
        <button class="btn ${myCoins >= p.cost ? "btn-warm" : "btn-secondary"} btn-block" data-act="redeem" data-perk="${p.id}" ${myCoins < p.cost ? "disabled" : ""}>Resgatar (💰 ${p.cost})</button>
      </div>
    `;
  }

  function redemptionItemHTML(r) {
    const perk = perkById[r.perk_id];
    const reward = rewardFor(r);
    return `
      <div class="entry-item">
        <div class="entry-icon">${escapeHTML(perk?.emoji || "🎁")}</div>
        <div class="entry-body">
          <div class="entry-title">${escapeHTML(gen(r.title, genderOf(r.role)))}</div>
          <div class="entry-meta">resgatado por ${ROLE_LABEL[r.role]} · ${r.cost}💰</div>
          ${r.status === "pendente"
            ? `<div class="entry-actions"><button class="btn btn-success btn-sm" data-act="fulfill" data-id="${r.id}">Marcar como cumprido${reward ? ` (💰+${reward} pra quem fez)` : ""} ✅</button></div>`
            : `
              <div style="margin-top:4px;"><span class="pill pill-success">Cumprido ✅</span></div>
              <div class="entry-actions"><button class="btn btn-ghost btn-sm" data-act="undo-fulfill" data-id="${r.id}">↩️ Desfazer</button></div>
            `}
        </div>
      </div>
    `;
  }

  view.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center; gap:10px;">
        <span class="icon-badge">${icon("wallet", { size: 20 })}</span>
        <div class="card-title" style="font-size:15px; margin-bottom:0;">Sua carteira</div>
      </div>
      <div class="row" style="margin-top:10px;">
        <span class="pill pill-coin">💰 você tem ${myCoins}</span>
        <span class="pill pill-muted">${ROLE_LABEL[otherRole()]}: ${coins[otherRole()] || 0}💰</span>
      </div>
    </div>

    <div class="section-title">🎮 Games</div>
    <div class="card" id="btn-open-star-battle" style="cursor:pointer;">
      <div class="row" style="align-items:center; gap:10px;">
        <img src="icons/capivarinhas.jpg" alt="Capivarinhas" style="width:48px; height:48px; border-radius:12px; object-fit:cover; flex:none;" />
        <div style="flex:1;">
          <div class="card-title" style="font-size:15px; margin-bottom:0;">Capivarinhas</div>
          <div class="hint-text" style="margin:0;">Quebra-cabeça de lógica · ganha moeda a cada fase</div>
        </div>
      </div>
    </div>

    <div class="section-title">Trocar moedas por</div>
    <div class="stack">
      ${PERKS.filter((x) => !perkHidden(x.id)).map((x) => perkById[x.id] || x).map(perkCardHTML).join("")}
    </div>

    <div class="section-title">Criados por vocês 💡</div>
    <div class="stack">
      ${customPerks.map(perkCardHTML).join("")}
      <button class="btn btn-secondary btn-block" id="btn-new-perk">➕ Criar um item da lojinha</button>
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
      const perk = perkById[btn.dataset.perk];
      const perkTitle = gen(perk.title, genderOf(State.role));
      if (!confirm(`Resgatar "${perkTitle}" por ${perk.cost} moedas?`)) return;
      btn.disabled = true;
      try {
        await db.redeemPerk(State.coupleId, State.role, { ...perk, title: perkTitle });
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
        const redemption = redemptions.find((r) => r.id === btn.dataset.id);
        const reward = rewardFor(redemption);
        let paid = 0;
        if (reward) {
          paid = await earnCoins(flipRole(redemption.role), reward, `cumpriu: ${redemption.title}`);
        }
        await db.markRedemptionFulfilled(btn.dataset.id, paid);
        await renderShop();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
  $("#btn-open-star-battle").addEventListener("click", () => renderStarBattleGame("casal"));
  $("#btn-new-perk").addEventListener("click", () => openPerkModal(null));
  view.querySelectorAll("[data-act='edit-perk']").forEach((btn) => {
    btn.addEventListener("click", () => openPerkModal(customRows.find((r) => r.id === btn.dataset.id)));
  });
  view.querySelectorAll("[data-act='edit-cost']").forEach((btn) => {
    btn.addEventListener("click", () => openPerkCostModal(perkById[btn.dataset.id]));
  });
  view.querySelectorAll("[data-act='undo-fulfill']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const redemption = redemptions.find((r) => r.id === btn.dataset.id);
      if (!confirm(`Desfazer "${redemption?.title}"? Ela volta pra pendente${redemption?.reward_paid ? ` e a moeda de recompensa (${redemption.reward_paid}) é devolvida` : ""}.`)) return;
      btn.disabled = true;
      try {
        if (redemption?.reward_paid) {
          await addCoins(flipRole(redemption.role), -redemption.reward_paid, `desfez: cumpriu ${redemption.title}`);
        }
        await db.undoRedemptionFulfilled(btn.dataset.id);
        await renderShop();
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        btn.disabled = false;
      }
    });
  });
}

function openPerkModal(existing) {
  const cost0 = existing?.cost ?? 10;
  openModal(`
    <h3 class="modal-title">${existing ? "✏️ Editar item" : "💡 Novo item da lojinha"}</h3>
    <div class="row" style="gap:10px;">
      <div style="flex:0 0 72px;">
        <label class="field-label">Emoji</label>
        <input type="text" id="perk-emoji" maxlength="4" value="${escapeHTML(existing?.emoji || "🎁")}" style="text-align:center; font-size:22px;" />
      </div>
      <div style="flex:1; min-width:0;">
        <label class="field-label">Nome</label>
        <input type="text" id="perk-title" maxlength="60" value="${escapeHTML(existing?.title || "")}" placeholder="ex: massagem nos pés" />
      </div>
    </div>
    <label class="field-label">Descrição (opcional)</label>
    <textarea id="perk-desc" rows="2" maxlength="200" placeholder="o que o outro se compromete a fazer">${escapeHTML(existing?.description || "")}</textarea>
    <label class="field-label">Custo em moedas</label>
    <input type="number" id="perk-cost" min="1" max="200" value="${cost0}" />
    <p class="hint-text" id="perk-reward-hint" style="margin-top:6px;"></p>
    <button class="btn btn-primary btn-block" style="margin-top:16px;" id="save-perk">Salvar</button>
    ${existing ? `<button class="btn btn-danger btn-block" style="margin-top:8px;" id="delete-perk">🗑️ Apagar item</button>` : ""}
  `);
  const reward = () => suggestedReward(Math.min(200, Math.max(1, parseInt($("#perk-cost").value, 10) || 1)));
  const updateHint = () => { $("#perk-reward-hint").textContent = `Quem cumprir o resgate ganha 💰+${reward()} (25% do custo).`; };
  updateHint();
  $("#perk-cost").addEventListener("input", updateHint);

  $("#save-perk").addEventListener("click", async () => {
    const title = $("#perk-title").value.trim();
    const cost = parseInt($("#perk-cost").value, 10);
    if (!title) { alert("Dá um nome pro item :)"); return; }
    if (!cost || cost < 1 || cost > 200) { alert("O custo tem que ser entre 1 e 200 moedas."); return; }
    setBusy("#save-perk", true);
    try {
      await db.saveCustomPerk({
        id: existing?.id, coupleId: State.coupleId, createdBy: State.role,
        emoji: $("#perk-emoji").value.trim() || "🎁", title,
        description: $("#perk-desc").value.trim(), cost, fulfillReward: suggestedReward(cost),
      });
      closeModal();
      await renderShop();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#save-perk", false);
    }
  });
  $("#delete-perk")?.addEventListener("click", async () => {
    if (!confirm(`Apagar "${existing.title}" da lojinha? Resgates já feitos continuam valendo.`)) return;
    try {
      await db.deleteCustomPerk(existing.id);
      closeModal();
      await renderShop();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
    }
  });
}

// deixa o casal ajustar o valor de um item GERAL da lojinha (não mexe nos outros casais).
// pra itens criados por vocês, a edição completa já é pelo botão "✏️ Editar" (openPerkModal).
function openPerkCostModal(perk) {
  const base = PERK_BY_ID[perk.id];
  const isCustomValue = perk.cost !== base.cost;
  openModal(`
    <h3 class="modal-title">✏️ Valor deste item</h3>
    <p class="card-sub">${perk.emoji} ${escapeHTML(gen(perk.title, genderOf(State.role)))}</p>
    <p class="hint-text">Isso só muda pro seu casal, outros casais continuam vendo o valor padrão (${base.cost}).</p>
    <label class="field-label">Custo em moedas</label>
    <input type="number" id="perk-cost-value" min="1" max="200" value="${perk.cost}" />
    <button class="btn btn-primary btn-block" style="margin-top:16px;" id="save-perk-cost">Salvar</button>
    ${isCustomValue ? `<button class="btn btn-ghost btn-block" style="margin-top:8px;" id="reset-perk-cost">Voltar ao valor padrão (${base.cost})</button>` : ""}
  `);
  $("#save-perk-cost").addEventListener("click", async () => {
    const cost = parseInt($("#perk-cost-value").value, 10);
    if (!cost || cost < 1 || cost > 200) { alert("O custo tem que ser entre 1 e 200 moedas."); return; }
    setBusy("#save-perk-cost", true);
    try {
      State.settings = await db.updateCoupleFeatures(State.coupleId, (f) => ({ ...f, perk_costs: { ...(f.perk_costs || {}), [perk.id]: cost } }));
      setPeopleSettings(State.settings);
      closeModal();
      await renderShop();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#save-perk-cost", false);
    }
  });
  $("#reset-perk-cost")?.addEventListener("click", async () => {
    try {
      State.settings = await db.updateCoupleFeatures(State.coupleId, (f) => {
        const perk_costs = { ...(f.perk_costs || {}) };
        delete perk_costs[perk.id];
        return { ...f, perk_costs };
      });
      setPeopleSettings(State.settings);
      closeModal();
      await renderShop();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
    }
  });
}

// ================= PERFIL =================

async function renderProfile() {
  view.innerHTML = `<div class="center-note">Carregando...</div>`;
  const moodSince = toISODate(addDays(new Date(), -60));
  const [coins, history, couple, loginStreakInfo, moodHistory, googleLinked, myFriendGroups] = await Promise.all([
    db.getCoinBalances(State.coupleId),
    db.listCoinHistory(State.coupleId, 12),
    supabase.from("couples").select("code").eq("id", State.coupleId).single(),
    computeLoginStreak(),
    db.getMoodHistory(State.coupleId, moodSince),
    db.getGoogleLinkStatus(),
    friends.listMyFriendGroups().catch(() => []),
  ]);
  const loginStreak = loginStreakInfo.streak;
  const moodStreak = countMoodStreakFromHistory(moodHistory, State.role);
  const pushPerm = permissionState();
  const alreadySubscribed = await isSubscribed();

  view.innerHTML = `
    <div class="card">
      <div class="row" style="align-items:center;">
        ${State.profile?.avatar_url ? avatarHTML(myDisplayName(), State.profile.avatar_url, "width:56px;height:56px;font-size:22px;") : `<div class="avatar" style="width:56px;height:56px;font-size:22px;">${ROLE_EMOJI[State.role]}</div>`}
        <div>
          <div class="card-title">${escapeHTML(myDisplayName())}</div>
          <div class="card-sub" style="margin-bottom:0;">você é ${ROLE_LABEL[State.role]} · par de ${State.partner ? escapeHTML(partnerDisplayName()) : "..."}</div>
          <button class="btn btn-ghost btn-sm" id="btn-edit-names" style="margin-top:6px; padding:6px 10px;">✏️ Nomes e emojis</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="row" style="align-items:center; gap:10px;">
        <span class="icon-badge">${icon("settings", { size: 20 })}</span>
        <div class="card-title" style="font-size:15px; margin-bottom:0;">Personalizar nosso app</div>
      </div>
      <div class="card-sub" style="margin-top:10px;">Ligue e desligue recursos e ajuste a tela inicial do jeito de vocês.</div>
      <button class="btn btn-secondary btn-block" id="btn-personalize">Personalizar</button>
    </div>

${feat("streaks") ? `    <div class="section-title">Sequências 🔥</div>
    <div class="card">
      <div class="row">
        <span class="pill">🔥 Uso do app: ${loginStreak} dia${loginStreak === 1 ? "" : "s"}</span>
        <span class="pill">🥰 Humor: ${moodStreak} dia${moodStreak === 1 ? "" : "s"}</span>
      </div>
      <p class="hint-text" style="margin-top:10px;">Só passa a contar como sequência a partir de 2 dias seguidos. Abrir o app ou registrar o humor hoje garante o dia de amanhã.</p>
    </div>` : ""}

    <div class="card">
      <div class="card-title" style="font-size:15px;">Código do casal</div>
      <div class="card-sub">Use em outro celular pra entrar como ${ROLE_LABEL[otherRole()]} (ou reinstalar).</div>
      <div class="onboarding-code" style="font-size:24px; padding:12px;">${escapeHTML(couple.data?.code || "") || "----"}</div>
    </div>

    <div class="card">
      <div class="card-title" style="font-size:15px;">Recuperar acesso pelo Google</div>
      ${googleLinked
        ? `<p class="card-sub" style="margin-bottom:0;">✅ Sua conta Google já está ligada neste perfil. Se trocar de celular, use "Continuar com o Google" pra entrar direto.</p>`
        : `<div class="card-sub">Ligue sua conta Google a este perfil, como um seguro: se você trocar de celular ou perder o código do casal, ainda consegue entrar.</div>
           <button class="btn btn-secondary btn-block" id="btn-link-google">Ligar minha conta Google</button>`}
    </div>

    <div class="section-title">Modo Amigos 👥</div>
    <div class="card" style="border-color:var(--friends-accent-soft);">
      ${!googleLinked ? `
        <p class="card-sub" style="margin-bottom:0;">Pra usar com amigos, primeiro liga sua conta Google aqui em cima, depois volta nessa tela.</p>
      ` : `
        ${myFriendGroups.length ? `
          <p class="card-sub">Você faz parte de ${myFriendGroups.length === 1 ? "1 turma" : myFriendGroups.length + " turmas"}. Trocar de conta não pede login de novo.</p>
          <div class="stack">
            ${myFriendGroups.map((g) => {
              const pal = GROUP_PALETTES[g.colorKey] || GROUP_PALETTES.azul;
              const v = isDarkMode() ? pal.dark : pal.light;
              return `<button class="btn btn-block" data-switch-friends="${g.id}" style="background:${v.soft}; color:${v.strong}; display:flex; align-items:center; gap:10px; text-align:left;">
                <span style="font-size:18px;">${escapeHTML(g.emoji || "👥")}</span>
                <span style="flex:1;">${escapeHTML(g.name)}</span>
                <span style="font-size:11.5px; font-weight:700; opacity:.75;">${g.memberCount || 1} pessoa${g.memberCount === 1 ? "" : "s"}</span>
              </button>`;
            }).join("")}
          </div>
          <button class="btn btn-ghost btn-block" style="margin-top:8px;" id="btn-new-friend-group">Criar ou entrar em outra turma</button>
        ` : `
          <p class="card-sub">Um "modo" separado do casal, pra turma de amigos: código próprio, prêmios próprios, moedas separadas.</p>
          <button class="btn btn-block" id="btn-new-friend-group" style="background:var(--friends-accent); color:var(--on-friends-accent);">👥 Criar ou entrar numa turma</button>
        `}
      `}
    </div>

    <div class="section-title">Privacidade 🔒</div>
    <div class="card">
      <div class="card-sub">Seus dados são seus. Você pode baixar tudo que registrou aqui e ler como cuidamos deles.</div>
      <button class="btn btn-secondary btn-block" id="btn-export-data">Baixar meus dados</button>
      <p class="hint-text" style="text-align:center; margin:10px 0 0;"><a href="privacidade.html" target="_blank" rel="noopener" style="color:var(--accent-strong);">Política de privacidade</a></p>
    </div>

    <div class="section-title">Instalar no celular 📲</div>
    <div class="card">
      ${isInstalled()
        ? `<p class="card-sub" style="margin-bottom:0;">✅ O Saudômetro já está instalado neste aparelho.</p>`
        : `<div class="card-sub">Coloque o Saudômetro na tela inicial: abre em tela cheia, mais rápido, e no iPhone é o que libera as notificações.</div>
           <button class="btn btn-secondary btn-block" id="btn-install-guide">Ver o passo a passo</button>`}
    </div>

    <div class="section-title">Notificações 🔔</div>
    <div class="card">
      ${needsHomeScreenFirst() ? `
        <p class="card-sub">No iPhone, notificação só funciona depois de adicionar o Saudômetro à tela de início.</p>
        <p class="hint-text">Toca no ícone de compartilhar do Safari (⬆️) → "Adicionar à Tela de Início" → abre o app por esse ícone novo, aí sim ativa as notificações por aqui.</p>
        <button class="btn btn-secondary btn-block" id="btn-install-guide-2">Ver o passo a passo</button>
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

${coinsOn() ? `    <div class="section-title">Moedas 💰</div>
    <div class="card">
      <div class="row">
        <span class="pill pill-coin">${ROLE_EMOJI.gabriel} ${ROLE_LABEL.gabriel}: ${coins.gabriel || 0}</span>
        <span class="pill pill-coin">${ROLE_EMOJI.tata} ${ROLE_LABEL.tata}: ${coins.tata || 0}</span>
      </div>
      <div class="stack" style="margin-top:12px; font-size:13px; color:var(--text-muted);">
        ${coinRulesHTML()}
        <div>🎁 Todo resgate na lojinha fica <strong style="color:var(--text);">pendente</strong> até alguém marcar como cumprido, só aí quem cumpriu ganha a moeda de recompensa. Se o outro te resgatou algo, um aviso aparece quando você abrir o app.</div>
        <div>🕰️ A cápsula do tempo é de graça, não gasta nem dá moeda, é só pra guardar um recado pro futuro.</div>
        ${luckyOn() ? `<div>🍀 De vez em quando (1 em cada 10), uma recompensa vem em dobro, é o "dia da sorte".</div>` : ""}
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

` : ""}

    <p class="hint-text" style="text-align:center; margin:22px 0 4px; font-size:11px; opacity:0.45;">© 2026 Gabriel Nascimento Santos</p>
  `;

  // 5 toques rápidos no avatar abrem o modo dono (senha validada no servidor)
  let avatarTaps = 0, avatarTimer = null;
  view.querySelector(".avatar")?.addEventListener("click", () => {
    avatarTaps++;
    clearTimeout(avatarTimer);
    avatarTimer = setTimeout(() => { avatarTaps = 0; }, 1500);
    if (avatarTaps >= 5) { avatarTaps = 0; openAdminGate(); }
  });

  $("#btn-edit-names")?.addEventListener("click", openNamesEditor);
  $("#btn-personalize")?.addEventListener("click", openPersonalizeModal);
  $("#btn-export-data")?.addEventListener("click", openMyDataModal);
  $("#btn-link-google")?.addEventListener("click", async () => {
    setBusy("#btn-link-google", true);
    try {
      const { error } = await db.linkGoogleIdentity();
      if (error) throw error;
      // a página navega pro Google e volta sozinha; nada mais a fazer aqui
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#btn-link-google", false);
    }
  });
  view.querySelectorAll("[data-switch-friends]").forEach((btn) => btn.addEventListener("click", async () => {
    const g = myFriendGroups.find((x) => x.id === btn.dataset.switchFriends);
    if (g) await enterFriendsMode(g);
  }));
  $("#btn-new-friend-group")?.addEventListener("click", openFriendsGroupModal);
  $("#btn-install-guide")?.addEventListener("click", openInstallGuide);
  $("#btn-install-guide-2")?.addEventListener("click", openInstallGuide);

  $("#btn-enable-push")?.addEventListener("click", () => {
    openModal(`
      <h3 class="modal-title">🔔 Ativar notificações</h3>
      <p class="card-sub">O seu celular vai pedir uma permissão agora, é só aceitar (geralmente aparece "Permitir"). Depois disso, você recebe aviso quando ${ROLE_LABEL[otherRole()]} atualizar o humor, mandar um convite ou responder a pergunta da semana.</p>
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

// ================= CICLO MENSTRUAL (opcional, aba Calendário) =================

const partnerName = () => escapeHTML(partnerDisplayName());

function visibilityLabel(v) {
  return { me: "Só você vê", basic: `${partnerName()} vê o básico`, full: `${partnerName()} vê tudo` }[v];
}

function cycleCalendarSectionHTML(mine, theirs) {
  let h = "";
  // o recurso é só de quem é mulher; o parceiro só vê o card se ela compartilhar
  if (!mine && genderOf(State.role) === "mulher") {
    h += `
      <div class="card">
        <div class="card-title" style="font-size:15px;">🌸 Meu ciclo <span class="pill pill-muted" style="margin-left:6px;">opcional</span></div>
        <p class="card-sub">Acompanhe seu ciclo aqui e decida se ${partnerName()} vê alguma coisa. Enquanto estiver desligado, nada é guardado e ninguém vê nada.</p>
        <button class="btn btn-secondary btn-block" id="cycle-enable">Ativar meu ciclo</button>
      </div>`;
  } else if (mine) {
    const c = cycleInfo(mine);
    h += `
      <div class="card">
        <div class="row" style="align-items:center; margin-bottom:6px;">
          <div class="card-title" style="font-size:15px; flex:1;">🌸 Meu ciclo</div>
          <span class="pill pill-muted">${mine.visibility === "me" ? "🔒 " : "👁️ "}${visibilityLabel(mine.visibility)}</span>
        </div>
        ${cycleRingSVG(c, true)}
        ${cycleLegendHTML(true)}
        <div style="text-align:center; margin-top:14px;"><button class="btn btn-primary btn-sm" id="cycle-edit" style="background:#E8508F;">Editar período</button></div>
        ${cycleTilesHTML(c, true)}
        <p class="hint-text" style="margin:12px 0 0;">${CYCLE_DISCLAIMER}</p>
        <button class="btn btn-ghost btn-block" style="margin-top:10px;" id="cycle-disable">Desativar e apagar meus dados do ciclo</button>
      </div>`;
  }
  if (theirs) {
    const full = theirs.visibility === "full";
    const c = cycleInfo(theirs);
    h += `
      <div class="card" style="position:relative;">
        <button class="btn btn-ghost btn-sm" id="cycle-help-btn" aria-label="Entender cada fase do ciclo" style="position:absolute; top:10px; right:10px; width:30px; height:30px; padding:0; border-radius:50%; font-weight:800;">?</button>
        <div class="card-title" style="font-size:15px; padding-right:38px; margin-bottom:6px;">🌸 Ciclo de ${partnerName()}</div>
        <span class="pill pill-muted" style="margin-bottom:8px;">💗 Compartilhou com você</span>
        ${cycleRingSVG(c, full, `${partnerName()} está`)}
        ${cycleLegendHTML(full)}
        <p class="card-sub" style="text-align:center; margin:12px 0 0;">${cycleTip(c)}</p>
        ${cycleTilesHTML(c, full)}
        <p class="hint-text" style="margin:12px 0 0;">${CYCLE_DISCLAIMER}</p>
      </div>`;
  }
  return h;
}

function wireCycleSection(mine, theirs) {
  $("#cycle-enable")?.addEventListener("click", () => openCycleEditor(null));
  $("#cycle-edit")?.addEventListener("click", () => openCycleEditor(mine));
  $("#cycle-disable")?.addEventListener("click", async () => {
    if (!confirm("Desativar o ciclo e apagar tudo que foi registrado? Isso não dá pra desfazer.")) return;
    try {
      await db.deleteCycle(State.coupleId, State.role);
      await renderCalendar();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
    }
  });
  $("#cycle-help-btn")?.addEventListener("click", () => {
    openModal(`
      <h3 class="modal-title">💡 Entendendo cada fase</h3>
      ${cycleHelpHTML(cycleInfo(theirs), theirs.visibility === "full")}
    `);
  });
}

function openCycleEditor(existing) {
  if (existing?.consent_at) { openCycleEditorForm(existing, existing.consent_at); return; }
  openModal(`
    <h3 class="modal-title">🌸 Antes de ativar</h3>
    <p class="card-sub">Os dados do ciclo menstrual são <strong>dados de saúde</strong>, considerados sensíveis pela LGPD. Por isso, precisamos do seu consentimento.</p>
    <ul class="card-sub" style="padding-left:18px; margin:6px 0 10px;">
      <li><strong>O que guardamos:</strong> a data em que sua última menstruação começou, a duração do ciclo e da menstruação, e com quem você quer compartilhar.</li>
      <li><strong>Só você vê</strong> por padrão. ${partnerName()} só vê se você escolher, e você muda isso quando quiser.</li>
      <li>Você pode <strong>desativar e apagar tudo</strong> a qualquer momento, e baixar seus dados em Perfil.</li>
      <li>As previsões são <strong>estimativas</strong>: não substituem orientação médica nem servem como método anticoncepcional.</li>
    </ul>
    <label style="display:flex; gap:10px; align-items:flex-start; margin:12px 0; font-size:14px; cursor:pointer;">
      <input type="checkbox" id="cy-consent" style="width:auto; margin-top:3px; flex:none;" />
      <span>Li a <a href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a> e aceito que o Saudômetro guarde esses dados para essa finalidade.</span>
    </label>
    <button class="btn btn-primary btn-block" id="cy-consent-go" disabled>Continuar</button>
    <button class="btn btn-ghost btn-block" style="margin-top:6px;" id="cy-consent-no">Agora não</button>
  `);
  $("#cy-consent").addEventListener("change", (e) => { $("#cy-consent-go").disabled = !e.target.checked; });
  $("#cy-consent-no").addEventListener("click", closeModal);
  $("#cy-consent-go").addEventListener("click", () => openCycleEditorForm(existing, new Date().toISOString()));
}

function openCycleEditorForm(existing, consentAt) {
  const today = todayISO();
  let start = existing?.last_period_start || today;
  let L = existing?.cycle_length || 28, P = existing?.period_length || 5;
  let vis = existing?.visibility || "me";
  let lengthTouched = false;
  const visOptions = [["me", "🔒 Só eu vejo"], ["basic", `👁️ ${partnerName()}: só o básico`], ["full", `👁️ ${partnerName()}: tudo`]];

  openModal(`
    <h3 class="modal-title">🌸 ${existing ? "Editar meu ciclo" : "Ativar meu ciclo"}</h3>
    <label class="field-label">Quando começou sua última menstruação?</label>
    <div class="row" style="gap:8px;">
      <button type="button" class="btn btn-secondary btn-sm" style="flex:1;" data-q="0">Começou hoje</button>
      <button type="button" class="btn btn-secondary btn-sm" style="flex:1;" data-q="1">Foi ontem</button>
    </div>
    <label class="field-label">Ou escolha outra data</label>
    <input type="date" id="cy-date" value="${start}" max="${today}" />
    <div class="row" style="align-items:center; margin-top:14px;"><span style="flex:1;">Duração do ciclo</span>
      <button type="button" class="btn btn-secondary btn-sm" data-step="L" data-d="-1" style="flex:none; width:38px;">−</button>
      <strong id="cy-L" style="min-width:64px; text-align:center;"></strong>
      <button type="button" class="btn btn-secondary btn-sm" data-step="L" data-d="1" style="flex:none; width:38px;">+</button></div>
    <div class="row" style="align-items:center; margin-top:8px;"><span style="flex:1;">Dias de menstruação</span>
      <button type="button" class="btn btn-secondary btn-sm" data-step="P" data-d="-1" style="flex:none; width:38px;">−</button>
      <strong id="cy-P" style="min-width:64px; text-align:center;"></strong>
      <button type="button" class="btn btn-secondary btn-sm" data-step="P" data-d="1" style="flex:none; width:38px;">+</button></div>
    <p class="hint-text" style="margin-top:8px;">Não sabe a duração? Deixe 28 e 5. Depois de alguns ciclos registrados, o app ajusta pela sua média.</p>
    <label class="field-label">Quem pode ver</label>
    <div class="stack" id="cy-vis" style="gap:6px;">
      ${visOptions.map(([id, l]) => `<button type="button" class="btn btn-block ${vis === id ? "btn-primary" : "btn-secondary"}" data-vis="${id}">${l}</button>`).join("")}
    </div>
    <p class="hint-text" style="margin-top:8px;">"Só o básico" mostra menstruação e TPM. "Tudo" inclui ovulação e período fértil. Quando compartilhado, um botão "?" explica cada fase pra quem vê.</p>
    <button class="btn btn-primary btn-block" style="margin-top:16px;" id="cy-save">Salvar</button>
  `);
  const paint = () => { $("#cy-L").textContent = `${L} dias`; $("#cy-P").textContent = `${P} dias`; };
  paint();
  $("#modal-sheet").querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => {
    start = toISODate(addDays(new Date(), -parseInt(b.dataset.q, 10)));
    $("#cy-date").value = start;
  }));
  $("#cy-date").addEventListener("change", (e) => { if (e.target.value) start = e.target.value; });
  $("#modal-sheet").querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    const d = parseInt(b.dataset.d, 10);
    if (b.dataset.step === "L") { L = Math.min(40, Math.max(21, L + d)); lengthTouched = true; }
    else P = Math.min(10, Math.max(2, P + d));
    paint();
  }));
  $("#cy-vis").querySelectorAll("[data-vis]").forEach((b) => b.addEventListener("click", () => {
    vis = b.dataset.vis;
    $("#cy-vis").querySelectorAll("[data-vis]").forEach((x) => { x.className = `btn btn-block ${x.dataset.vis === vis ? "btn-primary" : "btn-secondary"}`; });
  }));
  $("#cy-save").addEventListener("click", async () => {
    if (!start || start > today) { alert("Escolhe uma data que já passou (ou hoje)."); return; }
    setBusy("#cy-save", true);
    try {
      const starts = new Set(existing?.period_starts || []);
      // mudar a data por poucos dias é correção, não ciclo novo
      if (existing && Math.abs((parseISODate(start) - parseISODate(existing.last_period_start)) / 86400000) <= 10) {
        starts.delete(existing.last_period_start);
      }
      starts.add(start);
      const list = [...starts].sort().slice(-8);
      let len = L;
      if (!lengthTouched) { const avg = averageCycleLength(list); if (avg) len = avg; }
      await db.saveCycle(State.coupleId, State.role, {
        visibility: vis, last_period_start: list[list.length - 1], cycle_length: len, period_length: P, period_starts: list, consent_at: consentAt,
      });
      closeModal();
      await renderCalendar();
    } catch (e) {
      alert("Não deu: " + (e.message || e));
      setBusy("#cy-save", false);
    }
  });
}

// ================= PERSONALIZAR =================

const HOME_META = {
  kiss: { t: "Cronômetro do último beijo", d: "Dias sem se beijar e os avisos de saudade ligados a ele" },
  goal: { t: "Meta de encontros do mês", d: "Card com a meta, o progresso e a moeda por encontro" },
  next: { t: "Próximo encontro", d: "Card com o próximo encontro combinado" },
  recharge: { t: "Fim de semana de recarregar", d: "Card, botões no calendário e recusar convite sem custo" },
  mood: { t: "Humor de hoje", d: "Como cada um está hoje", nw: true },
  together: { t: "Dias juntos", d: "Contador desde a data que vocês escolherem", nw: true },
  special: { t: "Próxima data especial", d: "Aniversário de namoro e outras datas que vocês criaram", nw: true },
  checklist: { t: "Checklist do dia", d: "O que você já fez hoje: humor, recadinho e desafio do dia", nw: true },
};

const FEATURE_LIST = [
  { k: "miss", g: "Recados e brincadeiras", t: "Sinal de saudade", d: "Pedir visita, encontro de saudade e mensagens de saudade, na aba Recados" },
  { k: "weekly", g: "Recados e brincadeiras", t: "Pergunta da semana", d: "Uma pergunta nova por semana, na aba Humor" },
  { k: "daily", g: "Recados e brincadeiras", t: "Desafio do dia", d: "Uma pergunta por dia, no hub de Recados" },
  { k: "capsule", g: "Recados e brincadeiras", t: "Cápsula do tempo", d: "Mensagem que só abre numa data futura" },
  { k: "wishes", g: "Recados e brincadeiras", t: "Desejos secretos", d: "Desejos que o outro resgata às cegas" },
  { k: "streaks", g: "Perfil", t: "Sequências de dias", d: "Contagem de dias seguidos no topo e no Perfil, com bônus e proteção" },
  { k: "shop", g: "Lojinha e moedas", t: "Lojinha e moedas", d: "Aba Lojinha, moedas e recompensas. Desligado, tudo é de graça e sem moedas" },
];

function applyNavVisibility() {
  const shopBtn = document.querySelector('.nav-btn[data-tab="shop"]');
  if (shopBtn) shopBtn.style.display = feat("shop") ? "" : "none";
}

// ---- cards novos da tela inicial ----

function togetherParts(sinceISO) {
  const d = parseISODate(sinceISO);
  const t = startOfDay(new Date());
  const days = Math.max(0, Math.round((t - d) / 86400000));
  let years = t.getFullYear() - d.getFullYear();
  let months = t.getMonth() - d.getMonth();
  if (t.getDate() < d.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return { days, years: Math.max(0, years), months };
}

function togetherCardHTML() {
  const since = togetherSince();
  if (!since) {
    return `
      <div class="card" id="together-card" style="cursor:pointer; text-align:center;">
        <div class="card-title" style="font-size:15px;">💞 Dias juntos</div>
        <div class="card-sub" style="margin-bottom:0;">Toque pra escolher a data em que vocês começaram.</div>
      </div>`;
  }
  const { days, years, months } = togetherParts(since);
  const parts = [years ? `${years} ${years === 1 ? "ano" : "anos"}` : "", months ? `${months} ${months === 1 ? "mês" : "meses"}` : ""].filter(Boolean).join(" e ");
  return `
    <div class="card" id="together-card" style="cursor:pointer; text-align:center;">
      <div class="card-title" style="font-size:15px;">💞 Dias juntos</div>
      <div style="font-family:'Baloo 2', sans-serif; font-size:36px; font-weight:800; color:var(--accent-strong); line-height:1.2;">${days.toLocaleString("pt-BR")}</div>
      <div class="card-sub" style="margin-bottom:0;">${parts ? `${parts} · ` : ""}desde ${parseISODate(since).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })}</div>
    </div>`;
}

function openTogetherModal() {
  const today = todayISO();
  openModal(`
    <h3 class="modal-title">💞 Dias juntos</h3>
    <label class="field-label">Estamos juntos desde</label>
    <input type="date" id="together-date" value="${togetherSince() || ""}" max="${today}" />
    <p class="error-text" id="together-err"></p>
    <button class="btn btn-primary btn-block" style="margin-top:14px;" id="together-save">Salvar</button>
    ${togetherSince() ? `<button class="btn btn-ghost btn-block" style="margin-top:6px;" id="together-clear">Remover a data</button>` : ""}
  `);
  const save = async (value) => {
    setBusy("#together-save", true);
    try {
      State.settings = await db.updateCoupleFeatures(State.coupleId, (f) => ({
        ...f, together_since: value, last_editor: State.role, last_edit_at: new Date().toISOString(),
      }));
      setPeopleSettings(State.settings);
      closeModal();
      renderActiveTab();
    } catch (e) {
      $("#together-err").textContent = "Não deu: " + (e.message || e);
      setBusy("#together-save", false);
    }
  };
  $("#together-save").addEventListener("click", () => {
    const v = $("#together-date").value;
    if (!v || v > today) { $("#together-err").textContent = "Escolha uma data que já passou."; return; }
    save(v);
  });
  $("#together-clear")?.addEventListener("click", () => save(null));
}

async function findNextSpecialDate() {
  let rows = [];
  try { rows = await db.listSpecialDates(State.coupleId); } catch (e) { return null; }
  const today = startOfDay(new Date());
  let best = null;
  for (const r of rows) {
    const o = parseISODate(r.start_date);
    let d = o, years = 0;
    if (r.yearly) {
      d = new Date(today.getFullYear(), o.getMonth(), o.getDate());
      if (d < today) d = new Date(today.getFullYear() + 1, o.getMonth(), o.getDate());
      years = d.getFullYear() - o.getFullYear();
    } else if (d < today) continue;
    if (!best || d < best.date) best = { title: r.title, date: d, years };
  }
  return best;
}

function specialCardHTML(n) {
  if (!n) {
    return `
      <div class="card" id="special-card" style="cursor:pointer; background:var(--warm-soft);">
        <div class="card-title" style="font-size:15px;">💝 Próxima data especial</div>
        <div class="card-sub" style="margin-bottom:0;">Nenhuma ainda. Toque pra criar uma no calendário.</div>
      </div>`;
  }
  return `
    <div class="card" id="special-card" style="cursor:pointer; background:var(--warm-soft);">
      <div class="card-title" style="font-size:15px;">💝 Próxima data especial</div>
      <div class="entry-item" style="border:none; padding:6px 0 0;">
        <div class="entry-icon">💝</div>
        <div class="entry-body">
          <div class="entry-title">${escapeHTML(n.title) || "Data especial"}</div>
          <div class="entry-meta">${humanDateLong(n.date)} · ${daysUntilLabel(n.date)}${n.years > 0 ? ` · faz ${n.years} ano${n.years === 1 ? "" : "s"} 🎉` : ""}</div>
        </div>
      </div>
    </div>`;
}

// ---- regras de moedas de cada casal ----

const RULE_LIST = [
  { k: "mood", t: "Registrar o humor do dia", kind: "earn" },
  { k: "note", t: "Mandar um recadinho fofo (1x por dia)", kind: "earn" },
  { k: "weekly", t: "Responder a pergunta da semana", kind: "earn" },
  { k: "daily", t: "Responder o desafio do dia (1x por dia)", kind: "earn" },
  { k: "meet", t: "Encontro combinado aconteceu (pra cada um)", kind: "earn" },
  { k: "memory", t: "Lembrei de você: quando o par reage (pra cada um)", kind: "earn" },
  { k: "accept", t: "Aceitar um convite", kind: "earn" },
  { k: "moodStreak", t: "Bônus de 7 dias seguidos de humor", kind: "earn" },
  { k: "login15", t: "Bônus de 15 dias seguidos usando o app (1x)", kind: "earn" },
  { k: "login30", t: "Bônus de 30 dias seguidos usando o app (1x)", kind: "earn", max: 50 },
  { k: "invite", t: "Mandar um convite", kind: "cost" },
  { k: "miss", t: "Mandar sinal de saudade", kind: "cost" },
  { k: "decline", t: "Recusar um convite", kind: "cost" },
  { k: "freeze", t: "Proteger a sequência de dias", kind: "cost" },
  { k: "wish", t: "Resgatar um desejo secreto às cegas", kind: "cost" },
];

// texto do Perfil que explica como ganhar e gastar moedas, com os valores do casal
function coinRulesHTML() {
  const r = coinRule;
  const earn = [], spend = [];
  if (r("meet") > 0) earn.push(`encontro combinado do mês acontece (+${r("meet")} pra cada um)`);
  if (r("mood") > 0) earn.push(`registrar o humor do dia (+${r("mood")}, uma vez por dia)`);
  if (r("moodStreak") > 0) earn.push(`sequência de 7 dias de humor (+${r("moodStreak")} de bônus)`);
  if (r("note") > 0) earn.push(`mandar uma mensagem fofa (+${r("note")}, uma vez por dia)`);
  if (feat("weekly") && r("weekly") > 0) earn.push(`responder a pergunta da semana (+${r("weekly")})`);
  if (feat("daily") && r("daily") > 0) earn.push(`responder o desafio do dia (+${r("daily")}, uma vez por dia)`);
  if (r("accept") > 0) earn.push(`aceitar um convite (+${r("accept")})`);
  if (r("memory") > 0) earn.push(`mandar ou reagir a uma lembrança em "Lembrei de você" (+${r("memory")} pra cada um)`);
  if (feat("streaks") && r("login15") > 0) earn.push(`15 dias seguidos usando o app (+${r("login15")}, uma vez)`);
  if (feat("streaks") && r("login30") > 0) earn.push(`30 dias seguidos (+${r("login30")}, uma vez)`);
  if (r("invite") > 0) earn.push("convite que você mandou foi recusado, a moeda volta");
  earn.push("cumprir um resgate da lojinha que o outro pediu (varia por item, veja a Lojinha)");
  if (r("invite") > 0) spend.push(`mandar um convite (-${r("invite")})`);
  if (feat("miss") && r("miss") > 0) spend.push(`mandar um sinal de saudade (-${r("miss")})`);
  if (r("decline") > 0) spend.push(`recusar um convite de alguém (-${r("decline")}${feat("recharge") ? ", de graça se for na sua semana de recarregar" : ""})`);
  if (feat("streaks") && r("freeze") > 0) spend.push(`usar o freeze pra proteger a sequência de dias (-${r("freeze")})`);
  if (feat("wishes") && r("wish") > 0) spend.push(`resgatar um desejo secreto às cegas (-${r("wish")})`);
  const strong = (t) => `<strong style="color:var(--text);">${t}</strong>`;
  return `
    <div>🟢 ${strong("Ganha:")} ${earn.join(" · ")}</div>
    <div>🔴 ${strong("Gasta:")} ${spend.join(" · ") || "nada por enquanto"}</div>`;
}

// ---- tela Personalizar ----

function openPersonalizeModal() {
  const cur = {};
  HOME_WIDGETS.forEach((id) => { cur[id] = homeWidgetOn(id); });
  FEATURE_LIST.forEach((f) => { cur[f.k] = feat(f.k); });
  let order = homeOrder();
  let goal = goalTarget();
  let since = togetherSince() || "";
  const today = todayISO();
  const rules = {};
  RULE_LIST.forEach((r) => { rules[r.k] = coinRule(r.k); });
  let lucky = luckyOn();
  const perksOff = new Set(State.settings?.features?.perks_off || []);

  const switchHTML = (k, label) => `<button type="button" class="switch ${cur[k] ? "on" : ""}" data-k="${k}" role="switch" aria-checked="${cur[k]}" aria-label="${label}"></button>`;

  const paint = () => {
    const homeRows = order.map((id, i) => {
      const m = HOME_META[id];
      const stepper = id === "goal" && cur.goal
        ? `<span style="display:flex; align-items:center; gap:6px; flex:none;">
             <button type="button" class="btn btn-secondary btn-sm" data-goal="-1" style="padding:4px 10px;">−</button>
             <strong style="min-width:56px; text-align:center; font-size:13px;">${goal} / mês</strong>
             <button type="button" class="btn btn-secondary btn-sm" data-goal="1" style="padding:4px 10px;">+</button>
           </span>` : "";
      const together = id === "together" && cur.together
        ? `<div style="padding:8px 0 4px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
             <label class="hint-text" for="pz-since" style="margin:0;">Estamos juntos desde</label>
             <input type="date" id="pz-since" value="${since}" max="${today}" style="width:auto; flex:1; min-width:150px;" />
           </div>` : "";
      return `
        <div style="border-bottom:1px solid var(--border);">
          <div class="switch-row" style="padding:8px 0;">
            <div style="display:flex; flex-direction:column; gap:2px; flex:none;">
              <button type="button" class="btn btn-ghost btn-sm" data-mv="${i}" data-d="-1" aria-label="Subir ${m.t}" style="padding:2px 8px; min-height:0;" ${i === 0 ? "disabled" : ""}>▲</button>
              <button type="button" class="btn btn-ghost btn-sm" data-mv="${i}" data-d="1" aria-label="Descer ${m.t}" style="padding:2px 8px; min-height:0;" ${i === order.length - 1 ? "disabled" : ""}>▼</button>
            </div>
            <div style="min-width:0; flex:1;">
              <div style="font-weight:800; font-size:14px;">${m.t}${m.nw ? ` <span class="pill pill-success" style="font-size:10px; padding:1px 7px;">novo</span>` : ""}</div>
              <div class="hint-text" style="margin:0;">${m.d}</div>
            </div>
            ${stepper}
            ${switchHTML(id, m.t)}
          </div>
          ${together}
        </div>`;
    }).join("");

    let g = "";
    const otherRows = FEATURE_LIST.map((f) => {
      const head = f.g !== g ? `<p class="hint-text" style="margin:14px 0 6px;">${f.g}</p>` : "";
      g = f.g;
      return `${head}
        <div class="switch-row" style="padding:8px 0; border-bottom:1px solid var(--border);">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:800; font-size:14px;">${f.t}</div>
            <div class="hint-text" style="margin:0;">${f.d}</div>
          </div>
          ${switchHTML(f.k, f.t)}
        </div>`;
    }).join("");

    const ruleRow = (r) => `
      <div class="switch-row" style="padding:6px 0; border-bottom:1px solid var(--border);">
        <div style="flex:1; min-width:0; font-size:13px; font-weight:800;">${r.t}</div>
        <span style="display:flex; align-items:center; gap:6px; flex:none;">
          <button type="button" class="btn btn-secondary btn-sm" data-rule="${r.k}" data-rd="-1" style="padding:4px 10px;" aria-label="Diminuir ${r.t}">−</button>
          <strong style="min-width:28px; text-align:center; font-size:13px;">${rules[r.k]}</strong>
          <button type="button" class="btn btn-secondary btn-sm" data-rule="${r.k}" data-rd="1" style="padding:4px 10px;" aria-label="Aumentar ${r.t}">+</button>
        </span>
      </div>`;
    const coinRows = `
      <p class="hint-text" style="margin:14px 0 4px;">Pontos e moedas. Coloque 0 pra não dar (ou não cobrar) nada naquela ação.</p>
      <p class="hint-text" style="margin:8px 0 2px;">Ganha moedas</p>
      ${RULE_LIST.filter((r) => r.kind === "earn").map(ruleRow).join("")}
      <p class="hint-text" style="margin:12px 0 2px;">Gasta moedas</p>
      ${RULE_LIST.filter((r) => r.kind === "cost").map(ruleRow).join("")}
      <div class="switch-row" style="padding:8px 0; border-bottom:1px solid var(--border);">
        <div style="min-width:0; flex:1;">
          <div style="font-weight:800; font-size:14px;">Dia da sorte</div>
          <div class="hint-text" style="margin:0;">De vez em quando, 1 em cada 10, uma recompensa vem em dobro</div>
        </div>
        <button type="button" class="switch ${lucky ? "on" : ""}" data-lucky="1" role="switch" aria-checked="${lucky}" aria-label="Dia da sorte"></button>
      </div>
      <p class="hint-text" style="margin:14px 0 4px;">Itens prontos da lojinha. Desligue os que não combinam com vocês (vocês também podem criar os seus).</p>
      ${PERKS.map((x) => `
        <div class="switch-row" style="padding:6px 0; border-bottom:1px solid var(--border);">
          <div style="min-width:0; flex:1; font-size:13px; font-weight:800;">${x.emoji} ${gen(x.title, genderOf(State.role))} <span class="hint-text">${x.cost}💰</span></div>
          <button type="button" class="switch ${perksOff.has(x.id) ? "" : "on"}" data-perk="${x.id}" role="switch" aria-checked="${!perksOff.has(x.id)}" aria-label="${x.title}"></button>
        </div>`).join("")}
      <button type="button" class="btn btn-ghost btn-sm" id="pz-reset-rules" style="margin-top:10px;">Voltar aos valores padrão</button>`;

    $("#pz-list").innerHTML = `
      <p class="hint-text" style="margin:14px 0 4px;">Tela inicial. Use as setas pra mudar a ordem e o botão pra ligar ou desligar.</p>
      ${homeRows}
      ${otherRows}
      ${cur.shop ? coinRows : ""}`;
    const list = $("#pz-list");
    list.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => { cur[b.dataset.k] = !cur[b.dataset.k]; paint(); }));
    list.querySelectorAll("[data-goal]").forEach((b) => b.addEventListener("click", () => {
      goal = Math.min(30, Math.max(1, goal + parseInt(b.dataset.goal, 10)));
      paint();
    }));
    list.querySelectorAll("[data-mv]").forEach((b) => b.addEventListener("click", () => {
      const i = parseInt(b.dataset.mv, 10), j = i + parseInt(b.dataset.d, 10);
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      paint();
    }));
    $("#pz-since")?.addEventListener("change", (e) => { since = e.target.value; });
    list.querySelectorAll("[data-rule]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.rule, r = RULE_LIST.find((x) => x.k === k);
      rules[k] = Math.min(r.max || 20, Math.max(0, rules[k] + parseInt(b.dataset.rd, 10)));
      paint();
    }));
    list.querySelector("[data-lucky]")?.addEventListener("click", () => { lucky = !lucky; paint(); });
    list.querySelectorAll("[data-perk]").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.perk;
      if (perksOff.has(id)) perksOff.delete(id); else perksOff.add(id);
      paint();
    }));
    $("#pz-reset-rules")?.addEventListener("click", () => {
      RULE_LIST.forEach((r) => { rules[r.k] = COIN_DEFAULTS[r.k]; });
      lucky = true;
      perksOff.clear();
      paint();
    });
  };

  openModal(`
    <h3 class="modal-title">🎛️ Personalizar nosso app</h3>
    <p class="card-sub">Ligue só o que faz sentido pra vocês e escolha a ordem da tela inicial. Qualquer um dos dois pode mudar, e o outro é avisado. Nada do que já foi registrado é apagado.</p>
    <button type="button" class="btn btn-ghost btn-sm" id="pz-live-together">Atalho: moramos juntos</button>
    <div id="pz-list"></div>
    <p class="error-text" id="pz-err"></p>
    <button class="btn btn-primary btn-block" style="margin-top:16px;" id="pz-save">Salvar</button>
  `);
  paint();
  $("#pz-live-together").addEventListener("click", () => {
    ["kiss", "goal", "next", "recharge", "miss"].forEach((k) => { cur[k] = false; });
    cur.mood = true;
    paint();
  });
  $("#pz-save").addEventListener("click", async () => {
    if (since && since > today) { $("#pz-err").textContent = "A data de início precisa já ter passado."; return; }
    setBusy("#pz-save", true);
    try {
      const goalChanged = goal !== goalTarget();
      State.settings = await db.updateCoupleFeatures(State.coupleId, (f) => ({
        ...f, ...cur, home_order: order, together_since: since || null, goal_target: goal,
        coin_rules: { ...rules, lucky }, perks_off: [...perksOff],
        last_editor: State.role, last_edit_at: new Date().toISOString(),
      }));
      setPeopleSettings(State.settings);
      if (goalChanged && cur.goal) await db.setMonthBaseTarget(State.coupleId, monthKey(new Date()), goal).catch(() => {});
      applyNavVisibility();
      closeModal();
      renderActiveTab();
    } catch (e) {
      $("#pz-err").textContent = "Não deu: " + (e.message || e);
      setBusy("#pz-save", false);
    }
  });
}

// aviso único pra quem chega num casal novo: tudo começa ligado e dá pra personalizar
// devolve uma Promise que só resolve quando o aviso é dispensado (ou na hora, se não tiver
// nada pra mostrar) — assim quem chama pode encadear com await e não corre o risco de um
// aviso seguinte (ex.: o de ligar a conta Google, ou o changelog) sobrescrever esse no modal
function maybeShowTour() {
  return new Promise((resolve) => {
    const s = State.settings;
    if (!s?.names?.[State.role] || s.features?.tour?.[State.role]) return resolve(); // casal antigo não recebe o aviso
    openModal(`
      <h3 class="modal-title">🎛️ O app é de vocês</h3>
      <p class="card-sub">Tudo começa ligado. Você pode configurar a tela inicial do jeito que quiser e desligar o que não faz sentido pra vocês, como o cronômetro do beijo, a meta de encontros ou o fim de semana de recarregar.</p>
      <p class="hint-text">Fica em Perfil, em "Personalizar nosso app". Qualquer um dos dois pode mudar, e o outro é avisado.</p>
      <button class="btn btn-primary btn-block" style="margin-top:14px;" id="tour-now">Personalizar agora</button>
      <button class="btn btn-ghost btn-block" style="margin-top:6px;" id="tour-later">Depois</button>
    `);
    const markSeen = async () => {
      try {
        State.settings = await db.updateCoupleFeatures(State.coupleId, (f) => ({ ...f, tour: { ...(f.tour || {}), [State.role]: true } }));
        setPeopleSettings(State.settings);
      } catch (e) { /* aviso é só um bônus */ }
    };
    $("#tour-now").addEventListener("click", async () => { await markSeen(); closeModal(); openPersonalizeModal(); resolve(); });
    $("#tour-later").addEventListener("click", async () => { await markSeen(); closeModal(); resolve(); });
  });
}

const GOOGLE_NUDGE_DISMISSED_KEY = "googleLinkNudgeDismissed";

// convida quem ainda está no jeito antigo (sessão anônima, sem Google ligado) a ligar a conta —
// uma vez só (guardado no localStorage), pra não repetir toda vez que abrir o app. Resolve a
// Promise quando dispensado (ou na hora, se não tiver nada pra mostrar), assim quem chama
// pode encadear com await sem correr o risco de um aviso seguinte sobrescrever esse no modal
async function maybeShowGoogleLinkNudge() {
  try {
    if (localStorage.getItem(GOOGLE_NUDGE_DISMISSED_KEY) === "1") return;
  } catch (e) { /* sem storage: só mostra sempre */ }
  let anon = false;
  try { anon = await db.isAnonymousUser(); } catch (e) { return; }
  if (!anon) return;

  return new Promise((resolve) => {
    openModal(`
      <h3 class="modal-title">🔐 Ligar sua conta Google</h3>
      <p class="card-sub">Recomendamos ligar sua conta Google ao seu perfil: ajuda a recuperar o acesso se você trocar de celular ou perder o código do casal, e é por essa mesma conta que dá pra usar o Modo Amigos.</p>
      <button class="btn btn-primary btn-block" style="margin-top:14px;" id="btn-google-nudge-link">Ligar minha conta Google</button>
      <button class="btn btn-ghost btn-block" style="margin-top:6px;" id="btn-google-nudge-dismiss">Agora não</button>
    `);
    $("#btn-google-nudge-link")?.addEventListener("click", async () => {
      setBusy("#btn-google-nudge-link", true);
      try {
        const { error } = await db.linkGoogleIdentity();
        if (error) throw error;
        // a página navega pro Google e volta sozinha; nada mais a fazer aqui
      } catch (e) {
        alert("Não deu: " + (e.message || e));
        setBusy("#btn-google-nudge-link", false);
        resolve();
      }
    });
    $("#btn-google-nudge-dismiss")?.addEventListener("click", () => {
      try { localStorage.setItem(GOOGLE_NUDGE_DISMISSED_KEY, "1"); } catch (e) { /* sem storage: só volta a aparecer */ }
      closeModal();
      resolve();
    });
  });
}

// mostra as novidades ainda não vistas, uma de cada vez — a pessoa reage com um emoji pra
// marcar como vista e ver a próxima (ou fechar, se não sobrar nenhuma)
const CHANGELOG_REACTIONS = ["👍", "😍", "🤩", "🎉"];

// resolve quando a fila de novidades acaba (ou na hora, se não tiver nenhuma) — assim quem
// chama pode encadear com await sem correr o risco de um aviso seguinte sobrescrever esse modal
function maybeShowChangelog(mode) {
  const queue = unseenChangelogFor(mode);
  if (!queue.length) return Promise.resolve();
  return new Promise((resolve) => showNextChangelogEntry(queue, mode, resolve));
}

function showNextChangelogEntry(queue, mode, resolve) {
  if (!queue.length) return resolve();
  const entry = queue[0];
  const accentVar = mode === "amigos" ? "--friends-accent" : "--accent-btn";
  const onAccentVar = mode === "amigos" ? "--on-friends-accent" : "--on-accent-btn";
  openModal(`
    <p class="hint-text" style="text-align:center; font-weight:800; letter-spacing:.04em; text-transform:uppercase; margin:0 0 8px;">Novidade</p>
    <div style="text-align:center; font-size:34px;">${entry.emoji}</div>
    <h3 class="modal-title" style="text-align:center;">${escapeHTML(entry.title)}</h3>
    <p class="card-sub" style="text-align:center;">${escapeHTML(entry.text)}</p>
    <p class="hint-text" style="text-align:center; margin-top:16px;">Reage pra continuar:</p>
    <div class="row" style="gap:8px; justify-content:center; margin-top:6px;">
      ${CHANGELOG_REACTIONS.map((r) => `<button class="btn btn-sm" style="flex:none; font-size:20px; padding:8px 14px; background:var(${accentVar}); color:var(${onAccentVar});" data-changelog-react="${r}">${r}</button>`).join("")}
    </div>
  `);
  $("#modal-sheet").querySelectorAll("[data-changelog-react]").forEach((btn) => {
    btn.addEventListener("click", () => {
      markChangelogSeen(entry.id);
      const rest = queue.slice(1);
      if (rest.length) showNextChangelogEntry(rest, mode, resolve);
      else { closeModal(); resolve(); }
    });
  });
}

// ================= MEUS DADOS =================

// só o que a própria pessoa registrou (não inclui o que o par escreveu nem segredos dele)
async function collectMyData() {
  const mine = State.role;
  const spec = [
    ["moods", "role"], ["sweet_notes", "role"], ["coin_ledger", "role"], ["weekly_answers", "role"],
    ["daily_challenge_answers", "role"], ["secret_wishes", "role"], ["time_capsules", "from_role"],
    ["wish_redemptions", "redeemed_by"], ["shop_redemptions", "role"], ["encounters", "created_by"],
    ["app_opens", "role"], ["cycle_settings", "role"], ["reactions", "role"], ["memory_photos", "role"],
  ];
  const out = { exportado_em: new Date().toISOString(), nome: myDisplayName(), papel: mine, casal_id: State.coupleId, dados: {} };
  for (const [table, col] of spec) {
    const { data, error } = await supabase.from(table).select("*").eq("couple_id", State.coupleId).eq(col, mine);
    out.dados[table] = error ? `não foi possível ler (${error.message})` : data || [];
  }
  return out;
}

async function openMyDataModal() {
  openModal(`<h3 class="modal-title">📦 Meus dados</h3><div class="center-note">Juntando seus dados...</div>`);
  let json;
  try {
    json = JSON.stringify(await collectMyData(), null, 2);
  } catch (e) {
    $("#modal-sheet").innerHTML = `<h3 class="modal-title">📦 Meus dados</h3><p class="error-text">Não deu: ${escapeHTML(e.message || String(e))}</p>`;
    return;
  }
  $("#modal-sheet").innerHTML = `
    <h3 class="modal-title">📦 Meus dados</h3>
    <p class="card-sub">Tudo que você registrou no app, em formato aberto (JSON). Não inclui o que o seu par escreveu.</p>
    <textarea id="mydata-text" rows="9" readonly style="font-family:monospace; font-size:11px;">${escapeHTML(json)}</textarea>
    <div class="row" style="gap:8px; margin-top:12px;">
      <button class="btn btn-primary" style="flex:1;" id="mydata-copy">Copiar</button>
      <button class="btn btn-secondary" style="flex:1;" id="mydata-save">Baixar arquivo</button>
    </div>
    <p class="hint-text" id="mydata-msg" style="margin-top:8px;"></p>`;
  $("#mydata-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(json); $("#mydata-msg").textContent = "Copiado."; }
    catch (e) { $("#mydata-text").select(); $("#mydata-msg").textContent = "Selecione o texto e copie."; }
  });
  $("#mydata-save").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = `saudometro-meus-dados-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    $("#mydata-msg").textContent = "Se o arquivo não baixar no seu celular, use Copiar.";
  });
}

// ================= NOMES DO CASAL =================

const EMOJI_POOL = ["🦋", "🌸", "🦁", "🐻", "🐰", "🐺", "🦊", "🐼", "🐱", "🐶", "🦄", "🌻", "⭐", "🌙", "🍀", "🔥", "🐯", "🐸", "🦉", "🍓"];

// qualquer um dos dois pode editar os nomes, o gênero e o emoji de ambos
function openNamesEditor() {
  const base = legacyPeople();
  const cur = {
    names: { ...base.names, ...(State.settings?.names || {}) },
    genders: { ...base.genders, ...(State.settings?.genders || {}) },
    emojis: { ...base.emojis, ...(State.settings?.emojis || {}) },
  };
  const roles = [State.role, otherRole()];
  const genders = { ...cur.genders };
  const emojis = { ...cur.emojis };
  openModal(`
    <h3 class="modal-title">✏️ Nomes e emojis</h3>
    <p class="card-sub">Os dois podem editar. O app usa o nome e o gênero pra escrever os textos do jeito certo, e o emoji identifica cada um.</p>
    ${roles.map((r) => `
      <div class="card" style="padding:12px; margin-bottom:10px;">
        <label class="field-label">${r === State.role ? "Você" : "Seu par"}</label>
        <input type="text" data-nm="${r}" maxlength="24" value="${escapeHTML(nameOf(r))}" />
        <div class="row" style="gap:8px; margin-top:8px;" data-gr="${r}">
          ${[["mulher", "Mulher"], ["homem", "Homem"]].map(([v, l]) => `<button type="button" class="btn ${genders[r] === v ? "btn-primary" : "btn-secondary"} btn-sm" style="flex:1;" data-g="${v}">${l}</button>`).join("")}
        </div>
        <div class="row" style="gap:6px; flex-wrap:wrap; margin-top:10px;" data-er="${r}">
          ${EMOJI_POOL.map((e) => `<button type="button" class="btn ${emojis[r] === e ? "btn-primary" : "btn-secondary"} btn-sm" style="padding:6px 9px; font-size:18px;" data-e="${e}" aria-label="Emoji ${e}">${e}</button>`).join("")}
        </div>
      </div>`).join("")}
    <p class="error-text" id="names-err"></p>
    <button class="btn btn-primary btn-block" id="names-save">Salvar</button>
  `);
  $("#modal-sheet").querySelectorAll("[data-gr]").forEach((row) => {
    row.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => {
      genders[row.dataset.gr] = b.dataset.g;
      row.querySelectorAll("[data-g]").forEach((x) => { x.className = `btn ${x.dataset.g === b.dataset.g ? "btn-primary" : "btn-secondary"} btn-sm`; });
    }));
  });
  $("#modal-sheet").querySelectorAll("[data-er]").forEach((row) => {
    row.querySelectorAll("[data-e]").forEach((b) => b.addEventListener("click", () => {
      emojis[row.dataset.er] = b.dataset.e;
      row.querySelectorAll("[data-e]").forEach((x) => { x.className = `btn ${x.dataset.e === b.dataset.e ? "btn-primary" : "btn-secondary"} btn-sm`; });
    }));
  });
  $("#names-save").addEventListener("click", async () => {
    const names = { ...cur.names };
    $("#modal-sheet").querySelectorAll("[data-nm]").forEach((i) => { names[i.dataset.nm] = cleanName(i.value); });
    if (!names.gabriel || !names.tata) { $("#names-err").textContent = "Os dois nomes precisam estar preenchidos."; return; }
    if (names.gabriel.toLowerCase() === names.tata.toLowerCase()) { $("#names-err").textContent = "Os dois nomes precisam ser diferentes."; return; }
    if (emojis.gabriel === emojis.tata) { $("#names-err").textContent = "Cada um precisa de um emoji diferente."; return; }
    setBusy("#names-save", true);
    try {
      State.settings = await db.saveCoupleSettings(State.coupleId, { names, genders, emojis, features: State.settings?.features || {} });
      setPeopleSettings(State.settings);
      $("#greeting-name").textContent = myDisplayName();
      $("#avatar-badge").textContent = (myDisplayName() || "?").trim()[0]?.toUpperCase() || "?";
      closeModal();
      renderActiveTab();
    } catch (e) {
      $("#names-err").textContent = "Não deu: " + (e.message || e);
      setBusy("#names-save", false);
    }
  });
}

// ================= MODO DONO =================

function openAdminGate() {
  let saved = "";
  try { saved = sessionStorage.getItem("adminKey") || ""; } catch (e) { /* sem storage */ }
  if (saved) { showAdminStats(saved); return; }
  openModal(`
    <h3 class="modal-title">🔐 Modo dono</h3>
    <p class="card-sub">Área só pra quem administra o app.</p>
    <input type="password" id="admin-key" autocomplete="off" placeholder="senha" />
    <p class="error-text" id="admin-err" style="margin-top:8px;" hidden></p>
    <button class="btn btn-primary btn-block" style="margin-top:14px;" id="admin-go">Entrar</button>
  `);
  $("#admin-go").addEventListener("click", () => showAdminStats($("#admin-key").value));
  $("#admin-key").addEventListener("keydown", (ev) => { if (ev.key === "Enter") showAdminStats($("#admin-key").value); });
}

async function showAdminStats(key) {
  if (!key) return;
  const busyBtn = $("#admin-go");
  if (busyBtn) setBusy("#admin-go", true);
  try {
    const s = await db.adminStats(key);
    let errs = [];
    try { errs = await db.adminErrors(key); } catch (e) { errs = null; } // migração de erros ainda não rodou
    try { sessionStorage.setItem("adminKey", key); } catch (e) { /* sem storage */ }
    const fmt = (iso) => (iso ? humanDateShort(parseISODate(String(iso).slice(0, 10))) : "-");
    const stat = (n, label) => `<div class="card" style="text-align:center; margin:0;"><div style="font-family:'Baloo 2',sans-serif; font-size:28px; font-weight:800; color:var(--accent-strong);">${n}</div><div class="hint-text" style="margin:0;">${label}</div></div>`;
    openModal(`
      <h3 class="modal-title">🔐 Modo dono</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        ${stat(s.couples, "casais")}
        ${stat(s.users, "usuários")}
        ${stat(s.couples_complete, "casais completos (2 pessoas)")}
        ${stat(s.new_7d, "casais novos (7 dias)")}
        ${stat(s.active_today, "casais ativos hoje")}
        ${stat(s.active_7d, "casais ativos (7 dias)")}
      </div>
      <div class="section-title">Casais (mais novos primeiro)</div>
      <div class="stack" style="max-height:40vh; overflow-y:auto;">
        ${s.list.length ? s.list.map((c, i) => `
          <div class="entry-item">
            <div class="entry-icon">💑</div>
            <div class="entry-body">
              <div class="entry-title">Casal ${s.couples - i}</div>
              <div class="entry-meta">criado em ${fmt(c.created_at)} · ${c.members}/2 pessoas · último uso: ${fmt(c.last_open)}</div>
            </div>
          </div>`).join("") : `<div class="empty-state">Nenhum casal ainda.</div>`}
      </div>
      <div class="section-title">Erros no app (7 dias)</div>
      <div class="stack" style="max-height:30vh; overflow-y:auto;">
        ${errs === null ? `<div class="empty-state">Monitoramento ainda não ativado no banco.</div>`
          : errs.length ? errs.map((x) => `
          <div class="entry-item">
            <div class="entry-icon">⚠️</div>
            <div class="entry-body">
              <div class="entry-title" style="word-break:break-word;">${escapeHTML(x.message)}</div>
              <div class="entry-meta">${escapeHTML(x.place || "")} · ${x.times}x · ${x.people} pessoa(s) · último: ${fmt(x.last_at)}</div>
            </div>
          </div>`).join("") : `<div class="empty-state">Nenhum erro nos últimos 7 dias 🎉</div>`}
      </div>
      <p class="hint-text" style="margin-top:12px;">Só números e datas, nenhum código de casal ou conteúdo privado aparece aqui.</p>
      <button class="btn btn-ghost btn-block" style="margin-top:10px;" id="admin-logout">Sair do modo dono</button>
    `);
    $("#admin-logout").addEventListener("click", () => {
      try { sessionStorage.removeItem("adminKey"); } catch (e) { /* sem storage */ }
      closeModal();
    });
  } catch (e) {
    try { sessionStorage.removeItem("adminKey"); } catch (e2) { /* sem storage */ }
    const denied = String(e.message || e).includes("acesso negado");
    if ($("#admin-err")) {
      $("#admin-err").hidden = false;
      $("#admin-err").textContent = denied ? "Senha incorreta." : "Modo dono ainda não configurado no banco.";
      setBusy("#admin-go", false);
    } else {
      openAdminGate();
    }
  }
}

// ---------------- start ----------------

function applyStaticIcons() {
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, { size: 22 });
  });
}

initTheme();
applyStaticIcons();
initErrorReporting();
boot();
