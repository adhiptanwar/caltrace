// Server-only helper that generates and caches a daily set of rude/sarcastic
// reminder messages via Lovable AI. One set per UTC date, shared by all users.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ReminderSlot = "breakfast" | "lunch" | "dinner" | "weight";

type Msg = { title: string; body: string };
type MsgSet = Record<ReminderSlot, Msg>;

const FALLBACK: MsgSet = {
  breakfast: { title: "Oi, dumbass", body: "Log breakfast." },
  lunch: { title: "Hey, loser", body: "Log lunch. Now. Loser. Lol." },
  dinner: { title: "Don't choke now, moron", body: "Log dinner." },
  weight: { title: "Get on the scale, chicken", body: "Log your weight, coward." },
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readCached(date: string): Promise<Partial<MsgSet>> {
  const { data } = await supabaseAdmin
    .from("daily_reminder_messages")
    .select("slot, title, body")
    .eq("date", date);
  const out: Partial<MsgSet> = {};
  for (const row of data ?? []) {
    out[row.slot as ReminderSlot] = { title: row.title, body: row.body };
  }
  return out;
}

async function generateViaAi(date: string): Promise<MsgSet | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;

  const systemPrompt = `You write push-notification copy for a calorie tracking app.
Tone: RUDE, sarcastic, playfully insulting — call the user names (loser, dumbass, moron, idiot, slob, coward, chicken, etc.).
Keep it edgy but not slurs, not threats, not body-shaming about weight/appearance, not self-harm.
Each title must be under 40 chars. Each body under 90 chars.
Vary the style today (${date}) so it feels fresh — don't reuse common phrasings.
Return ONLY JSON with this exact shape:
{
  "breakfast": { "title": "...", "body": "... mention logging breakfast ..." },
  "lunch":     { "title": "...", "body": "... mention logging lunch ..." },
  "dinner":    { "title": "...", "body": "... mention logging dinner ..." },
  "weight":    { "title": "...", "body": "... mention logging weight ..." }
}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Generate today's set for ${date}.` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.error("daily-messages AI failed", res.status, await res.text());
      return null;
    }
    const json = await res.json();
    const text: string = json.choices?.[0]?.message?.content ?? "{}";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }
    const slots: ReminderSlot[] = ["breakfast", "lunch", "dinner", "weight"];
    const out: MsgSet = { ...FALLBACK };
    for (const s of slots) {
      const v = parsed?.[s];
      if (v && typeof v.title === "string" && typeof v.body === "string") {
        out[s] = { title: v.title.slice(0, 80), body: v.body.slice(0, 200) };
      }
    }
    return out;
  } catch (e) {
    console.error("daily-messages AI threw", e);
    return null;
  }
}

let inflight: Promise<MsgSet> | null = null;

export async function getDailyMessages(): Promise<MsgSet> {
  const date = todayUtc();
  const cached = await readCached(date);
  if (cached.breakfast && cached.lunch && cached.dinner && cached.weight) {
    return cached as MsgSet;
  }

  if (!inflight) {
    inflight = (async () => {
      const generated = (await generateViaAi(date)) ?? FALLBACK;
      const rows = (Object.keys(generated) as ReminderSlot[]).map((slot) => ({
        date,
        slot,
        title: generated[slot].title,
        body: generated[slot].body,
      }));
      await supabaseAdmin
        .from("daily_reminder_messages")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(rows as any, { onConflict: "date,slot" });
      return generated;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
