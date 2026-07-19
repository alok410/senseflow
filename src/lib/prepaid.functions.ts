import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  consumerId: z.string().uuid(),
  amount: z.number().positive().max(1_000_000),
  notes: z.string().trim().max(500).optional(),
});

export const addCashBalance = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    // Auth is temporarily disabled.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();

    const { data: existing } = await supabaseAdmin
      .from("prepaid_balances").select("balance").eq("consumer_id", data.consumerId).maybeSingle();
    const newBalance = Number(existing?.balance || 0) + data.amount;

    const { error: upErr } = await supabaseAdmin.from("prepaid_balances").upsert({
      consumer_id: data.consumerId,
      balance: newBalance,
      last_recharge_amount: data.amount,
      last_recharge_date: now,
      updated_at: now,
    }, { onConflict: "consumer_id" });
    if (upErr) throw new Error(upErr.message);

    const { error: pErr } = await supabaseAdmin.from("payments").insert({
      consumer_id: data.consumerId,
      amount: data.amount,
      method: "manual",
      notes: data.notes ?? `Cash payment recorded`,
      recorded_by: null,
    });
    if (pErr) throw new Error(pErr.message);

    return { ok: true, balance: newBalance };
  });