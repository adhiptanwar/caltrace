import { createFileRoute } from "@tanstack/react-router";

type Slot = "breakfast" | "lunch" | "dinner";
const SLOT_TIMES: Record<Slot, { hour: number; minute: number }> = {
  breakfast: { hour: 8, minute: 0 },
  lunch: { hour: 12, minute: 30 },
  dinner: { hour: 19, minute: 0 },
};
const SLOT_MESSAGES: Record<Slot, { title: string; body: string }> = {
  breakfast: { title: "Good morning ☀️", body: "Don't forget to log your breakfast in Trace." },
  lunch: { title: "Lunch time 🥗", body: "Take a moment to log your lunch in Trace." },
  dinner: { title: "Dinner time 🍽️", body: "Log your dinner so your day is complete." },
};
const WINDOW_MIN = 240; // send if cron runs within ±10 min of slot time

function localParts(tz: string, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return {
      date: `${map.year}-${map.month}-${map.day}`,
      hour: parseInt(map.hour, 10),
      minute: parseInt(map.minute, 10),
    };
  } catch {
    return null;
  }
}

function slotForLocalTime(hour: number, minute: number): Slot | null {
  const mins = hour * 60 + minute;
  for (const s of ["breakfast", "lunch", "dinner"] as Slot[]) {
    const t = SLOT_TIMES[s];
    const slotMins = t.hour * 60 + t.minute;
    if (Math.abs(mins - slotMins) <= WINDOW_MIN) return s;
  }
  return null;
}

export const Route = createFileRoute("/api/public/hooks/meal-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const apikey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!apikey) return new Response("Missing publishable key", { status: 500 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendPush } = await import("@/lib/push-sender.server");

        const now = new Date();
        const { data: subs, error } = await supabaseAdmin
          .from("push_subscriptions")
          .select(
            "id, user_id, endpoint, p256dh, auth, timezone, last_sent_breakfast, last_sent_lunch, last_sent_dinner",
          );
        if (error) return Response.json({ error: error.message }, { status: 500 });

        let sent = 0;
        let skipped = 0;

        for (const sub of subs ?? []) {
          const parts = localParts(sub.timezone || "UTC", now);
          if (!parts) {
            skipped++;
            continue;
          }
          const slot = slotForLocalTime(parts.hour, parts.minute);
          if (!slot) {
            skipped++;
            continue;
          }
          const lastSentKey = `last_sent_${slot}` as "last_sent_breakfast" | "last_sent_lunch" | "last_sent_dinner";
          if (sub[lastSentKey] === parts.date) {
            skipped++;
            continue;
          }

          // Did the user already log a meal in this category today (their local day)?
          const startLocal = new Date(`${parts.date}T00:00:00`);
          // Build a UTC range covering the user's local day. We approximate by querying
          // a 36h window and filtering in JS using the same tz formatting.
          const fromUtc = new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString();
          const toUtc = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
          const { data: meals } = await supabaseAdmin
            .from("meals")
            .select("eaten_at, category")
            .eq("user_id", sub.user_id)
            .eq("category", slot)
            .gte("eaten_at", fromUtc)
            .lte("eaten_at", toUtc);

          const alreadyLogged = (meals ?? []).some((m) => {
            const p = localParts(sub.timezone || "UTC", new Date(m.eaten_at));
            return p && p.date === parts.date;
          });

          if (alreadyLogged) {
            // Mark as "handled" today so we don't keep checking, but don't notify.
            const patch: Record<string, string> = {};
            patch[lastSentKey] = parts.date;
            await supabaseAdmin
              .from("push_subscriptions")
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .update(patch as any)
              .eq("id", sub.id);
            skipped++;
            continue;
          }

          const msg = SLOT_MESSAGES[slot];
          const result = await sendPush(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            { title: msg.title, body: msg.body, url: "/app", tag: `trace-${slot}-${parts.date}` },
          );

          if (result.gone) {
            await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
          } else if (result.ok) {
            const patch: Record<string, string> = {};
            patch[lastSentKey] = parts.date;
            await supabaseAdmin
              .from("push_subscriptions")
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .update(patch as any)
              .eq("id", sub.id);
            sent++;
          }
          void startLocal;
        }

        return Response.json({ ok: true, sent, skipped, total: subs?.length ?? 0 });
      },
    },
  },
});
