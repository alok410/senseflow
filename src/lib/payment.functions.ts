import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────
// PaymentGateway interface — swap DummyPaymentGateway for real one
// ─────────────────────────────────────────────────────────────────
export interface PaymentGateway {
  /**
   * Initiate a payment for an invoice.
   * Returns a transaction_ref and optional redirect URL.
   */
  initiate(params: {
    invoiceId: string;
    consumerId: string;
    amountRupees: number;
    invoiceNumber: string;
  }): Promise<{ transactionRef: string; redirectUrl?: string }>;

  /**
   * Verify / finalise a payment.
   * Returns the final status.
   */
  verify(transactionRef: string): Promise<"SUCCESS" | "FAILED">;
}

// ─────────────────────────────────────────────────────────────────
// DummyPaymentGateway — no external call; pure in-memory
// To swap in Razorpay: implement the same interface and replace
// the `gateway` export below.
// ─────────────────────────────────────────────────────────────────
export class DummyPaymentGateway implements PaymentGateway {
  async initiate(params: {
    invoiceId: string;
    consumerId: string;
    amountRupees: number;
    invoiceNumber: string;
  }): Promise<{ transactionRef: string }> {
    // Generate a fake transaction ref
    const ref = `DUMMY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    return { transactionRef: ref };
  }

  async verify(transactionRef: string): Promise<"SUCCESS" | "FAILED"> {
    // The actual result is driven by the consumer's button click (simulatePaymentResult)
    // This is a no-op verify for dummy gateway
    return "SUCCESS";
  }
}

/** Active gateway — replace with new RazorpayGateway() to go live */
const gateway: PaymentGateway = new DummyPaymentGateway();
export { gateway };

// ─────────────────────────────────────────────────────────────────
// initiatePayment — consumer: creates a INITIATED dummy_payment row
// Returns the paymentId to poll / confirm later
// ─────────────────────────────────────────────────────────────────
const initiateInput = z.object({
  invoiceId:  z.string().uuid(),
  consumerId: z.string().uuid(),
});

export const initiatePayment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => initiateInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Load invoice — verify it belongs to this consumer and is payable
    const { data: inv, error: iErr } = await supabaseAdmin
      .from("invoices")
      .select("id, consumer_id, total_amount, status, invoice_number")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inv) throw new Error("Invoice not found.");
    if (inv.consumer_id !== data.consumerId) throw new Error("Access denied.");

    const payableStatuses = ["published", "pending", "overdue"];
    if (!payableStatuses.includes(inv.status)) {
      if (inv.status === "paid") return { alreadyPaid: true, paymentId: null };
      throw new Error(`Invoice cannot be paid in status: ${inv.status}`);
    }

    // 2. Check no INITIATED payment already in flight (prevent double-initiation)
    const { data: existing } = await supabaseAdmin
      .from("dummy_payments")
      .select("id, status")
      .eq("invoice_id", data.invoiceId)
      .eq("status", "INITIATED")
      .maybeSingle();
    if (existing) {
      // Return existing pending payment so user can proceed
      return { alreadyPaid: false, paymentId: existing.id, transactionRef: null };
    }

    // 3. Call gateway to get a transaction reference
    const { transactionRef } = await gateway.initiate({
      invoiceId: data.invoiceId,
      consumerId: data.consumerId,
      amountRupees: Number(inv.total_amount),
      invoiceNumber: inv.invoice_number ?? data.invoiceId,
    });

    // 4. Persist the INITIATED payment record
    const { data: pay, error: pErr } = await supabaseAdmin
      .from("dummy_payments")
      .insert({
        invoice_id:      data.invoiceId,
        consumer_id:     data.consumerId,
        amount:          inv.total_amount,
        status:          "INITIATED",
        transaction_ref: transactionRef,
        method:          "DUMMY",
      })
      .select("id")
      .single();
    if (pErr) throw new Error(pErr.message);

    return { alreadyPaid: false, paymentId: pay.id, transactionRef };
  });

// ─────────────────────────────────────────────────────────────────
// simulatePaymentResult — consumer: "Simulate Success" / "Simulate Failure"
// Atomically updates dummy_payment + invoice in one go.
// ─────────────────────────────────────────────────────────────────
const simulateInput = z.object({
  paymentId:  z.string().uuid(),
  consumerId: z.string().uuid(),
  result:     z.enum(["success", "failure"]),
});

export const simulatePaymentResult = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => simulateInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Load payment — verify it's INITIATED and belongs to this consumer
    const { data: pay, error: pErr } = await supabaseAdmin
      .from("dummy_payments")
      .select("id, invoice_id, consumer_id, amount, status, transaction_ref")
      .eq("id", data.paymentId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!pay) throw new Error("Payment not found.");
    if (pay.consumer_id !== data.consumerId) throw new Error("Access denied.");
    if (pay.status !== "INITIATED") {
      // Already resolved
      return { ok: true, status: pay.status as "SUCCESS" | "FAILED", alreadyResolved: true };
    }

    // 2. Load invoice — double-pay guard
    const { data: inv, error: iErr } = await supabaseAdmin
      .from("invoices")
      .select("id, status, total_amount")
      .eq("id", pay.invoice_id)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inv) throw new Error("Invoice not found.");
    if (inv.status === "paid") {
      // Mark payment as SUCCESS (idempotent)
      await supabaseAdmin
        .from("dummy_payments")
        .update({ status: "SUCCESS" })
        .eq("id", pay.id);
      return { ok: true, status: "SUCCESS" as const, alreadyResolved: true };
    }

    const now = new Date().toISOString();

    if (data.result === "success") {
      // 3a. SUCCESS path — update payment then invoice
      const { error: upPay } = await supabaseAdmin
        .from("dummy_payments")
        .update({ status: "SUCCESS" })
        .eq("id", pay.id);
      if (upPay) throw new Error(upPay.message);

      const { error: upInv } = await supabaseAdmin
        .from("invoices")
        .update({ status: "paid", paid_at: now })
        .eq("id", pay.invoice_id)
        .neq("status", "paid"); // double-pay guard at DB level
      if (upInv) throw new Error(upInv.message);

      // 4. Record a payment row in the main payments table for analytics
      await supabaseAdmin.from("payments").insert({
        invoice_id:  pay.invoice_id,
        consumer_id: pay.consumer_id,
        amount:      pay.amount,
        method:      "online",
        notes:       `Dummy payment ${pay.transaction_ref}`,
        recorded_by: null,
        payment_status: "completed",
      }).then(() => { /* ignore errors — payments table is analytics-only */ });

      // 5. Audit log
      await supabaseAdmin.from("invoice_audit_log").insert({
        invoice_id:   pay.invoice_id,
        action:       "PAYMENT_SUCCESS",
        performed_by: pay.consumer_id,
        new_value:    { transaction_ref: pay.transaction_ref, amount: pay.amount },
        note:         "Paid via dummy payment gateway",
      });

      return { ok: true, status: "SUCCESS" as const, alreadyResolved: false, transactionRef: pay.transaction_ref };
    } else {
      // 3b. FAILURE path
      const { error: upPay } = await supabaseAdmin
        .from("dummy_payments")
        .update({ status: "FAILED", failure_reason: "Simulated failure by user" })
        .eq("id", pay.id);
      if (upPay) throw new Error(upPay.message);

      await supabaseAdmin.from("invoice_audit_log").insert({
        invoice_id:   pay.invoice_id,
        action:       "PAYMENT_FAILED",
        performed_by: pay.consumer_id,
        new_value:    { transaction_ref: pay.transaction_ref },
        note:         "Payment simulation failed",
      });

      return { ok: true, status: "FAILED" as const, alreadyResolved: false };
    }
  });

// ─────────────────────────────────────────────────────────────────
// getMyPayments — consumer: list their payment history
// ─────────────────────────────────────────────────────────────────
const myPaymentsInput = z.object({ consumerId: z.string().uuid() });

export const getMyDummyPayments = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => myPaymentsInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("dummy_payments")
      .select("*")
      .eq("consumer_id", data.consumerId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
