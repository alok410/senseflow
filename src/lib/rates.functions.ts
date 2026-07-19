import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const setRateInput = z.object({
  rate_per_liter: z.number().nonnegative(),
  free_tier_liters: z.number().nonnegative(),
  effective_from: z.string().min(4),
});

export const setWaterRate = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => setRateInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.from("water_rates").insert({
      rate_per_liter: data.rate_per_liter,
      free_tier_liters: data.free_tier_liters,
      effective_from: data.effective_from,
      updated_by: null,
    }).select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });