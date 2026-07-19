import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  consumerId: z.string().uuid(),
  amount: z.number().positive().max(1_000_000),
  notes: z.string().trim().max(500).optional(),
});

export const addCashBalance = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }) => {
    // Allow admins OR secretaries who manage this consumer.
    const [{ data: isAdmin }, { data: isSec }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "secretary" }),
    ]);
    let allowed = !!isAdmin;
    if (!allowed && isSec) {
      const { data: mgr } = await context.supabase.rpc("secretary_manages_consumer", {
        _secretary_id: context.userId, _consumer_id: data.consumerId,
      });
      allowed = !!mgr;
    }
    if (!allowed) throw new Error("Forbidden");

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
      recorded_by: context.userId,
    });
    if (pErr) throw new Error(pErr.message);

    return { ok: true, balance: newBalance };
  });