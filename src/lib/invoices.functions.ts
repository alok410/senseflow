import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Auth is temporarily disabled.

const markPaidInput = z.object({
  invoiceId: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
  method: z.string().trim().max(40).optional(),
});

export const markInvoicePaid = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => markPaidInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inv, error: iErr } = await supabaseAdmin
      .from("invoices")
      .select("id, consumer_id, total_amount, status")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inv) throw new Error("Invoice not found.");
    if (inv.status === "paid") return { ok: true, alreadyPaid: true };

    const paidAt = new Date().toISOString();
    const { error: upErr } = await supabaseAdmin.from("invoices")
      .update({ status: "paid", paid_at: paidAt })
      .eq("id", data.invoiceId);
    if (upErr) throw new Error(upErr.message);

    const method = (data.method === "online" || data.method === "prepaid_recharge") ? data.method : "manual";
    const { error: pErr } = await supabaseAdmin.from("payments").insert({
      invoice_id: inv.id,
      consumer_id: inv.consumer_id,
      amount: inv.total_amount,
      method,
      notes: data.notes ?? null,
      recorded_by: null,
    });
    if (pErr) throw new Error(pErr.message);

    return { ok: true, alreadyPaid: false };
  });