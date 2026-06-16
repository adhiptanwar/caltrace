import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AddInput = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
  calories: z.number().int().nonnegative(),
  protein_g: z.number().optional().default(0),
  carbs_g: z.number().optional().default(0),
  fat_g: z.number().optional().default(0),
  items: z.array(z.any()).optional().default([]),
  category: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  eaten_at: z.string(),
});

export const addMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error, data: row } = await context.supabase
      .from("meals")
      .insert({
        user_id: context.userId,
        name: data.name,
        description: data.description,
        calories: data.calories,
        protein_g: data.protein_g,
        carbs_g: data.carbs_g,
        fat_g: data.fat_g,
        items: data.items,
        category: data.category,
        eaten_at: data.eaten_at,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listMeals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sinceDays: z.number().int().min(1).max(365).default(30) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.sinceDays * 86400_000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("meals")
      .select("*")
      .gte("eaten_at", since)
      .order("eaten_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const deleteMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("meals").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
