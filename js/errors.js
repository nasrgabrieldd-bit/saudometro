import { supabase } from "./supabaseClient.js";

// Manda pro banco os erros de JavaScript que acontecem no aparelho (aparecem no modo dono).
// Só vai mensagem curta + arquivo/linha; nada do conteúdo do casal.

const MAX_PER_SESSION = 5;

// o banco recusou por permissão (RLS): acontece, por exemplo, quando o casal foi apagado com o app aberto
export function isAccessDenied(e) {
  return e?.code === "42501" || /row-level security|permission denied/i.test(String(e?.message || e || ""));
}

// ruído que não dá pra consertar: erro de script de outro site (sem detalhe) e aviso inofensivo do navegador
export function shouldIgnoreError(message) {
  const m = String(message || "").trim();
  return m === "" || /^Script error.?$/i.test(m) || /ResizeObserver loop/i.test(m);
}
const seen = new Set();

function cleanText(s) {
  // tira endereço completo e parâmetros da URL (podem ter código do casal)
  return String(s || "").replace(/https?:\/\/[^\s)]+/g, (u) => u.split("?")[0].split("#")[0]).slice(0, 300);
}

async function report(message, place) {
  const msg = cleanText(message);
  if (!msg || seen.size >= MAX_PER_SESSION) return;
  const key = msg + "|" + place;
  if (seen.has(key)) return;
  seen.add(key);
  try {
    await supabase.rpc("log_error", {
      p_message: msg,
      p_place: cleanText(place),
      p_ua: navigator.userAgent.slice(0, 200),
    });
  } catch (e) {
    // sem internet ou sem login: não tem o que fazer, e nunca pode gerar outro erro
  }
}

export function initErrorReporting() {
  window.addEventListener("error", (ev) => {
    // erro de carregar imagem/script vem sem mensagem; ignora
    if (shouldIgnoreError(ev.message)) return;
    const file = (ev.filename || "").split("/").pop();
    report(ev.message, `${file}:${ev.lineno || 0}`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    const msg = r && r.message ? r.message : String(r || "");
    const stack = r && r.stack ? String(r.stack).split("\n").find((l) => /\.js/.test(l)) || "" : "";
    report("Promise rejeitada: " + msg, stack.trim().split("/").pop());
  });
}
