import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import crypto from "crypto";

// ─────────────────────────────────────────────
// createRazorpayOrder — called client-side to initiate payment
// Returns a Razorpay order_id that the frontend uses to open the checkout
// ─────────────────────────────────────────────
const createOrderInput = z.object({
  invoiceId: z.string().uuid(),
  consumerId: z.string().uuid(),
  amountPaise: z.number().int().min(100), // amount in paise (₹1 = 100 paise)
});

export const createRazorpayOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createOrderInput.parse(d))
  .handler(async ({ data }) => {
    // Read keys from app_settings DB first, fall back to env vars
    const { getSettingByKey } = await import("@/lib/settings.functions");
    const [dbKeyId, dbSecret] = await Promise.all([
      getSettingByKey("razorpay_key_id"),
      getSettingByKey("razorpay_key_secret"),
    ]);
    const keyId = dbKeyId || process.env.RAZORPAY_KEY_ID || "";
    const keySecret = dbSecret || process.env.RAZORPAY_KEY_SECRET || "";

    if (!keyId || !keySecret || keyId === "rzp_test_YOUR_KEY_ID") {
      throw new Error("Razorpay is not configured. Go to Admin → Settings and enter your Razorpay Key ID and Secret.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify invoice exists and is not already paid
    const { data: inv, error: iErr } = await supabaseAdmin
      .from("invoices")
      .select("id, consumer_id, total_amount, status, invoice_number")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inv) throw new Error("Invoice not found.");
    if (inv.consumer_id !== data.consumerId) throw new Error("Unauthorized.");
    if (inv.status === "paid") throw new Error("Invoice is already paid.");

    // Create Razorpay order via REST API
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const receipt = `inv-${data.invoiceId.slice(0, 8)}`;

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: data.amountPaise,
        currency: "INR",
        receipt,
        notes: {
          invoice_id: data.invoiceId,
          consumer_id: data.consumerId,
          invoice_number: inv.invoice_number ?? "",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Razorpay order creation failed: ${errText}`);
    }

    const order = await response.json() as { id: string; amount: number; currency: string };

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
      invoiceNumber: inv.invoice_number ?? data.invoiceId.slice(0, 8),
    };
  });

// ─────────────────────────────────────────────
// verifyRazorpayPayment — called after checkout success
// Verifies HMAC signature and marks invoice paid
// ─────────────────────────────────────────────
const verifyPaymentInput = z.object({
  invoiceId: z.string().uuid(),
  consumerId: z.string().uuid(),
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => verifyPaymentInput.parse(d))
  .handler(async ({ data }) => {
    // Read secret from app_settings DB first, fall back to env
    const { getSettingByKey } = await import("@/lib/settings.functions");
    const dbSecret = await getSettingByKey("razorpay_key_secret");
    const keySecret = dbSecret || process.env.RAZORPAY_KEY_SECRET || "";
    if (!keySecret || keySecret === "YOUR_KEY_SECRET") {
      throw new Error("Razorpay not configured.");
    }

    // Verify HMAC SHA256 signature
    const body = `${data.razorpayOrderId}|${data.razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(body)
      .digest("hex");

    if (expectedSignature !== data.razorpaySignature) {
      throw new Error("Payment verification failed: invalid signature.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify invoice
    const { data: inv, error: iErr } = await supabaseAdmin
      .from("invoices")
      .select("id, consumer_id, total_amount, status")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inv) throw new Error("Invoice not found.");
    if (inv.consumer_id !== data.consumerId) throw new Error("Unauthorized.");
    if (inv.status === "paid") return { ok: true, alreadyPaid: true };

    const paidAt = new Date().toISOString();

    // Mark invoice paid + record payment in parallel
    const [upRes, payRes] = await Promise.all([
      supabaseAdmin
        .from("invoices")
        .update({ status: "paid", paid_at: paidAt })
        .eq("id", data.invoiceId),
      supabaseAdmin.from("payments").insert({
        invoice_id: inv.id,
        consumer_id: inv.consumer_id,
        amount: inv.total_amount,
        method: "online",
        transaction_id: data.razorpayPaymentId,
        razorpay_order_id: data.razorpayOrderId,
        razorpay_payment_id: data.razorpayPaymentId,
        razorpay_signature: data.razorpaySignature,
        notes: `Razorpay online payment`,
        recorded_by: null,
        payment_status: "completed",
      }),
    ]);

    if (upRes.error) throw new Error(upRes.error.message);
    if (payRes.error) throw new Error(payRes.error.message);

    return { ok: true, alreadyPaid: false };
  });

// ─────────────────────────────────────────────
// getConsumerPaymentHistory — for the consumer payments tab
// ─────────────────────────────────────────────
const payHistoryInput = z.object({
  consumerId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).optional(),
});

export type PaymentHistoryRow = {
  id: string;
  invoice_id: string | null;
  amount: number;
  method: string;
  transaction_id: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  notes: string | null;
  created_at: string;
  invoice_number: string | null;
  bill_period_start: string | null;
  bill_period_end: string | null;
};

export const getConsumerPaymentHistory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => payHistoryInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: payments, error } = await supabaseAdmin
      .from("payments")
      .select("*")
      .eq("consumer_id", data.consumerId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);

    if (error) throw new Error(error.message);

    // Enrich with invoice data
    const invoiceIds = (payments || [])
      .map((p: any) => p.invoice_id)
      .filter(Boolean);

    let invoiceMap = new Map<string, any>();
    if (invoiceIds.length > 0) {
      const { data: invs } = await supabaseAdmin
        .from("invoices")
        .select("id, invoice_number, bill_period_start, bill_period_end")
        .in("id", invoiceIds);
      (invs || []).forEach((i: any) => invoiceMap.set(i.id, i));
    }

    return (payments || []).map((p: any) => {
      const inv = p.invoice_id ? invoiceMap.get(p.invoice_id) : null;
      return {
        id: p.id,
        invoice_id: p.invoice_id,
        amount: Number(p.amount),
        method: p.method,
        transaction_id: p.transaction_id,
        razorpay_order_id: p.razorpay_order_id,
        razorpay_payment_id: p.razorpay_payment_id,
        notes: p.notes,
        created_at: p.created_at,
        invoice_number: inv?.invoice_number ?? null,
        bill_period_start: inv?.bill_period_start ?? null,
        bill_period_end: inv?.bill_period_end ?? null,
      } as PaymentHistoryRow;
    });
  });
