import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

const UpsertInput = z.object({
  gender: z.enum(["male", "female"]).nullable().optional(),
  birth_date: z.string().nullable().optional(),
  height_cm: z.number().positive().max(272).nullable().optional(),
  activity_level: z
    .enum(["sedentary", "light", "moderate", "heavy", "athlete"])
    .nullable()
    .optional(),
  goal_weight_kg: z.number().positive().max(700).nullable().optional(),
  display_name: z.string().nullable().optional(),
});

export const upsertProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpsertInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (existing) {
      const { data: row, error } = await context.supabase
        .from("profiles")
        .update(data)
        .eq("user_id", context.userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    } else {
      const { data: row, error } = await context.supabase
        .from("profiles")
        .insert({ ...data, user_id: context.userId })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
  });
