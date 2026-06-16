import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const addWeight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ weight_kg: z.number().positive().max(700) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("weights")
      .insert({
        user_id: context.userId,
        weight_kg: data.weight_kg,
        logged_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listWeights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sinceDays: z.number().int().min(1).max(3650).default(180) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.sinceDays * 86400_000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("weights")
      .select("*")
      .gte("logged_at", since)
      .order("logged_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const deleteWeight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("weights").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
