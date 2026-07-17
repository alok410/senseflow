import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const setRateInput = z.object({
  rate_per_liter: z.number().nonnegative(),
  free_tier_liters: z.number().nonnegative(),
  effective_from: z.string().min(4),
});

export const setWaterRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => setRateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("water_rates").insert({
      rate_per_liter: data.rate_per_liter,
      free_tier_liters: data.free_tier_liters,
      effective_from: data.effective_from,
      updated_by: context.userId,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });