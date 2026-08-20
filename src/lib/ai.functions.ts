import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  imageDataUrl: z.string().min(20),
});

export type AnalyzedItem = {
  name: string;
  portion?: string;
  quantity: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type AnalyzedMeal = {
  name: string;
  description: string;
  items: AnalyzedItem[];
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Expected a base64 data URL for the image");
  return { mediaType: match[1], base64: match[2] };
}

export const analyzeMealImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<AnalyzedMeal> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const { mediaType, base64 } = parseDataUrl(data.imageDataUrl);

    const systemPrompt = `You are a nutrition assistant. Analyze the food photo and return JSON:
- "name": short meal name (max 6 words)
- "description": 1-sentence summary
- "items": array of { "name", "portion" (e.g. "1 egg", "100g", "1 slice"), "quantity" (number of those portions visible, integer or decimal), "calories" (per single portion unit), "protein_g", "carbs_g", "fat_g" (all per single portion unit) }
- "calories", "protein_g", "carbs_g", "fat_g": totals for the whole meal (sum of items * quantity)
Estimate conservatively. Per-item values are PER SINGLE portion unit so the user can adjust quantity. Return JSON only, no other text.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: "Analyze this meal photo." },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Rate limit exceeded. Try again shortly.");
      if (res.status === 529) throw new Error("AI is overloaded. Try again shortly.");
      throw new Error(`AI analysis failed: ${res.status} ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const text: string = json.content?.[0]?.text ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    const rawItems: any[] = Array.isArray(parsed.items) ? parsed.items : [];
    const items: AnalyzedItem[] = rawItems.map((it: any) => ({
      name: String(it.name ?? "Item"),
      portion: it.portion ? String(it.portion) : undefined,
      quantity: Number(it.quantity ?? 1) || 1,
      calories: Number(it.calories ?? 0) || 0,
      protein_g: Number(it.protein_g ?? 0) || 0,
      carbs_g: Number(it.carbs_g ?? 0) || 0,
      fat_g: Number(it.fat_g ?? 0) || 0,
    }));

    return {
      name: String(parsed.name ?? "Meal"),
      description: String(parsed.description ?? ""),
      items,
      calories: Math.round(Number(parsed.calories ?? 0)) || 0,
      protein_g: Number(parsed.protein_g ?? 0) || 0,
      carbs_g: Number(parsed.carbs_g ?? 0) || 0,
      fat_g: Number(parsed.fat_g ?? 0) || 0,
    };
  });
