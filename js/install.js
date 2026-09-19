import { isIOS, isStandalone } from "./push.js";

// Instalar o app na tela inicial: no Android o navegador oferece um botão direto; no iPhone é só pelo Safari.

const DISMISS_KEY = "installHintDismissed";
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // guarda o convite do Chrome pra mostrar quando a pessoa quiser
  deferredPrompt = e;
});
window.addEventListener("appinstalled", () => { deferredPrompt = null; });

export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

export function isInstalled() {
  return isStandalone();
}

// iPhone/iPad com Chrome, Firefox ou Edge (não o Safari): o caminho muda um pouco
function isIOSOtherBrowser() {
  return isIOS() && /CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
}

export function canPromptInstall() {
  return deferredPrompt !== null;
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  return choice?.outcome === "accepted";
}

// só sugere no celular e enquanto o app ainda não foi instalado
export function shouldShowInstallHint() {
  if (isInstalled() || !(isIOS() || isAndroid())) return false;
  try { return localStorage.getItem(DISMISS_KEY) !== "1"; } catch (e) { return true; }
}

export function dismissInstallHint() {
  try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) { /* sem storage: só volta a aparecer */ }
}

const steps = (items) =>
  `<ol class="install-steps">${items.map((t) => `<li>${t}</li>`).join("")}</ol>`;

const IPHONE_STEPS = steps([
  "Abra o Saudômetro no <strong>Safari</strong> (o navegador azul com bússola).",
  "Toque no ícone de <strong>compartilhar</strong>: um quadrado com uma seta pra cima (⬆️), na barra de baixo. No iPad ele fica no topo.",
  "Role a lista e toque em <strong>“Adicionar à Tela de Início”</strong>.",
  "Toque em <strong>“Adicionar”</strong> no canto de cima.",
  "Pronto! Agora abra o app <strong>pelo ícone novo</strong> na tela inicial. É por ele que as notificações funcionam.",
]);

const IPHONE_OTHER_BROWSER_NOTE =
  `<p class="hint-text" style="margin:0 0 8px;">Você está abrindo por outro navegador. O caminho mais garantido é copiar o endereço deste site e abrir no <strong>Safari</strong>.</p>`;

const ANDROID_STEPS = steps([
  "Abra o Saudômetro no <strong>Chrome</strong>.",
  "Toque nos <strong>três pontinhos</strong> (⋮) no canto de cima.",
  "Toque em <strong>“Instalar app”</strong> ou <strong>“Adicionar à tela inicial”</strong>.",
  "Confirme em <strong>“Instalar”</strong>. O ícone aparece na sua tela inicial.",
]);

const DESKTOP_STEPS = steps([
  "No <strong>Chrome</strong> ou <strong>Edge</strong>, procure o ícone de instalar (um monitor com uma seta) na barra de endereço, à direita.",
  "Clique nele e em <strong>“Instalar”</strong>.",
]);

export function installGuideHTML() {
  const ios = isIOS();
  const android = isAndroid();
  const primary = ios
    ? `<div class="section-title" style="margin-top:4px;">No iPhone</div>${isIOSOtherBrowser() ? IPHONE_OTHER_BROWSER_NOTE : ""}${IPHONE_STEPS}`
    : android
      ? `<div class="section-title" style="margin-top:4px;">No Android</div>${ANDROID_STEPS}`
      : `<div class="section-title" style="margin-top:4px;">No computador</div>${DESKTOP_STEPS}`;
  const others = [
    ios ? "" : `<details class="install-more"><summary>Como fazer no iPhone</summary>${IPHONE_STEPS}</details>`,
    android ? "" : `<details class="install-more"><summary>Como fazer no Android</summary>${ANDROID_STEPS}</details>`,
    ios || android ? `<details class="install-more"><summary>Como fazer no computador</summary>${DESKTOP_STEPS}</details>` : "",
  ].join("");
  return `
    <h3 class="modal-title">📲 Instalar no celular</h3>
    <p class="card-sub">Vira um ícone na tela inicial, abre em tela cheia como um app de verdade, abre mais rápido e, no iPhone, é a única forma de receber notificações.</p>
    ${canPromptInstall() ? `<button class="btn btn-primary btn-block" id="install-now" style="margin-bottom:6px;">Instalar agora</button>` : ""}
    ${primary}
    ${others}
    ${isInstalled() ? "" : `<button class="btn btn-ghost btn-block" style="margin-top:10px;" id="install-dismiss">Já instalei / não mostrar mais o aviso</button>`}
  `;
}
