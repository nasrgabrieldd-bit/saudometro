// Cloudflare Turnstile: prova que quem entra é uma pessoa. A chave abaixo é pública (a secreta fica só no Supabase).
const SITE_KEY = "0x4AAAAAAE8ir3YoPmUS1Iik";

let scriptPromise = null;

function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { scriptPromise = null; reject(new Error("captcha: script bloqueado")); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

// devolve o token, ou undefined se não deu (o Supabase decide se aceita entrar sem ele)
export async function getCaptchaToken(timeoutMs = 20000) {
  try {
    await loadScript();
  } catch (e) {
    return undefined;
  }
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;";
    document.body.appendChild(box);
    let done = false;
    let widgetId = null;
    let timer = null;
    const finish = (token) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (widgetId !== null) window.turnstile.remove(widgetId); } catch (e) { /* já removido */ }
      box.remove();
      resolve(token);
    };
    timer = setTimeout(() => finish(undefined), timeoutMs);
    try {
      widgetId = window.turnstile.render(box, {
        sitekey: SITE_KEY,
        appearance: "interaction-only", // só aparece se precisar de um clique
        callback: (token) => finish(token),
        "error-callback": () => finish(undefined),
        "timeout-callback": () => finish(undefined),
      });
    } catch (e) {
      finish(undefined);
    }
  });
}
