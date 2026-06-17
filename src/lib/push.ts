import { VAPID_PUBLIC_KEY } from "./push-config";
import { savePushSubscription, deletePushSubscription } from "./push.functions";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

function bufToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export async function getPushPermission(): Promise<NotificationPermission> {
  if (!pushSupported()) return "denied";
  return Notification.permission;
}

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.error("SW registration failed", e);
    return null;
  }
}

export async function enablePushNotifications(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "Notifications not supported on this device." };

  // iOS requires PWA install for push
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (/Mac/.test(ua) && "ontouchend" in document);
  if (isIOS && !isStandalonePWA()) {
    return {
      ok: false,
      reason: "On iOS, please install Trace to your Home Screen first, then enable notifications from inside the app.",
    };
  }

  const reg = await registerSW();
  if (!reg) return { ok: false, reason: "Could not register service worker." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Permission denied." };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const endpoint = json.endpoint || sub.endpoint;
  const p256dh = json.keys?.p256dh || bufToBase64(sub.getKey("p256dh"));
  const auth = json.keys?.auth || bufToBase64(sub.getKey("auth"));
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  await savePushSubscription({ data: { endpoint, p256dh, auth, timezone } });
  return { ok: true };
}

export async function disablePushNotifications(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await deletePushSubscription({ data: { endpoint } });
  }
}

export async function getCurrentSubscriptionEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}
