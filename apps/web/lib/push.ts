import { apiFetch } from "./api";

const PROMPT_KEY = "ep_push_prompt_after_agenda";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Call after the first successful agenda save — never on page load. */
export async function offerPushAfterFirstAgendaSave(token: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return;
  }
  try {
    if (localStorage.getItem(PROMPT_KEY) === "done") return;
  } catch {
    return;
  }
  if (Notification.permission === "denied") {
    try {
      localStorage.setItem(PROMPT_KEY, "done");
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    localStorage.setItem(PROMPT_KEY, "done");
  } catch {
    /* ignore */
  }

  if (Notification.permission === "default") {
    const result = await Notification.requestPermission();
    if (result !== "granted") return;
  }

  await subscribeAndRegister(token);
}

async function subscribeAndRegister(token: string): Promise<void> {
  const { publicKey } = await apiFetch<{ publicKey: string | null }>("/push/vapid-public-key", {}, token);
  if (!publicKey) return;

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

  await apiFetch(
    "/push/subscribe",
    {
      method: "POST",
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent.slice(0, 300),
      }),
    },
    token,
  );
}
