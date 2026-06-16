import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  imageDataUrl: z.string().min(20),
});

export type AnalyzedMeal = {
  name: string;
  description: string;
  items: { name: string; portion?: string; calories: number }[];
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export const analyzeMealImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<AnalyzedMeal> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const systemPrompt = `You are a nutrition assistant. Analyze the food photo and return a concise JSON object with:
- "name": short meal name (max 6 words)
- "description": 1-sentence summary
- "items": array of {name, portion, calories} for each visible food item
- "calories": total estimated kcal (integer)
- "protein_g", "carbs_g", "fat_g": macro estimates in grams (numbers)
Estimate conservatively. Return JSON only.`;

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
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this meal photo." },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Rate limit exceeded. Try again shortly.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits to continue.");
      throw new Error(`AI analysis failed: ${res.status} ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const text: string = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    return {
      name: String(parsed.name ?? "Meal"),
      description: String(parsed.description ?? ""),
      items: Array.isArray(parsed.items) ? parsed.items : [],
      calories: Math.round(Number(parsed.calories ?? 0)) || 0,
      protein_g: Number(parsed.protein_g ?? 0) || 0,
      carbs_g: Number(parsed.carbs_g ?? 0) || 0,
      fat_g: Number(parsed.fat_g ?? 0) || 0,
    };
  });
