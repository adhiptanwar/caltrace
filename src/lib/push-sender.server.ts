// Server-only push sender. Do NOT import from client code.
import webpush from "web-push";
import { VAPID_PUBLIC_KEY, VAPID_SUBJECT } from "./push-config";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) throw new Error("VAPID_PRIVATE_KEY is not configured");
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, privateKey);
  configured = true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

export async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<{ ok: boolean; statusCode?: number; gone?: boolean }> {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 },
    );
    return { ok: true };
  } catch (err: unknown) {
    const e = err as { statusCode?: number; body?: string };
    const gone = e.statusCode === 404 || e.statusCode === 410;
    console.error("Push send failed", e.statusCode, e.body);
    return { ok: false, statusCode: e.statusCode, gone };
  }
}
