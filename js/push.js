import { supabase } from "./supabaseClient.js";

// chave pública VAPID (não é segredo, fica visível no navegador mesmo)
const VAPID_PUBLIC_KEY = "BF6VYdqY4N1QDiu6qViI2Gm7o3RAIpBKnaZYIs2YyOZi5CoqBUGAzEBpJ5EPEc3JVY8LOedemAXxv2glro4zCdU";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// no iPhone, notificação só funciona se o site foi aberto pelo ícone
// adicionado à tela de início (não pelo Safari direto)
export function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function needsHomeScreenFirst() {
  return isIOS() && !isStandalone();
}

export function permissionState() {
  if (!pushSupported()) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

export async function registerServiceWorker() {
  if (!pushSupported()) return null;
  return navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
}

export async function isSubscribed() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

export async function subscribeToPush(coupleId, role) {
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("Esse navegador não suporta notificações.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permissão de notificação não foi concedida.");

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    { couple_id: coupleId, role, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
  return sub;
}

export async function unsubscribeFromPush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  // só desliga de verdade no navegador se não sobrar nenhuma notificação de turma usando esse
  // mesmo endpoint (o mesmo aparelho pode estar inscrito pro casal E pra turma ao mesmo tempo)
  const { data: stillUsed } = await supabase.from("friend_push_subscriptions").select("id").eq("endpoint", endpoint).limit(1);
  if (!stillUsed?.length) await sub.unsubscribe();
}

// mesma ideia, mas grava em friend_push_subscriptions (por user_id, não por couple_id/role —
// um push de dispositivo só, vale pra todas as turmas da pessoa). O endpoint do navegador é o
// mesmo se a pessoa também já ativou pro casal; guardar nas duas tabelas é intencional, cada
// função de notificação (notify / notify-friends) lê a sua própria tabela.
export async function subscribeToFriendPush(userId) {
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("Esse navegador não suporta notificações.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permissão de notificação não foi concedida.");

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = sub.toJSON();
  const { error } = await supabase.from("friend_push_subscriptions").upsert(
    { user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
  return sub;
}

export async function unsubscribeFromFriendPush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await supabase.from("friend_push_subscriptions").delete().eq("endpoint", endpoint);
  // idem: só desliga de verdade se não sobrar nenhuma notificação de casal nesse aparelho
  const { data: stillUsed } = await supabase.from("push_subscriptions").select("id").eq("endpoint", endpoint).limit(1);
  if (!stillUsed?.length) await sub.unsubscribe();
}
