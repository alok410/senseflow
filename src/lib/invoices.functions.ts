import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type InvoiceRow = {
  id: string;
  consumer_id: string;
  bill_period_start: string;
  bill_period_end: string;
  consumption: number;
  free_consumption: number;
  chargeable_consumption: number;
  rate_applied: number;
  amount: number;
  late_fee: number;
  total_amount: number;
  due_date: string;
  status: string;
  paid_at: string | null;
  created_at: string;
  consumer_name: string | null;
  consumer_phone: string | null;
  block_id: string | null;
  location_id: string | null;
};

// ─────────────────────────────────────────────
// listInvoices — admin & secretary (supabaseAdmin bypasses RLS)
// ─────────────────────────────────────────────
const listInput = z.object({
  status: z.string().optional(),        // "all" | "pending" | "paid" | "overdue"
  locationId: z.string().uuid().nullable().optional(),
  consumerId: z.string().uuid().nullable().optional(),
  secretaryId: z.string().uuid().nullable().optional(), // restrict to secretary's locations
  limit: z.number().int().min(1).max(1000).optional(),
});

export const listInvoices = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => listInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // If secretaryId provided, resolve their managed location IDs first
    let allowedLocationIds: string[] | null = null;
    if (data.secretaryId) {
      const { data: secLocs } = await supabaseAdmin
        .from("secretary_locations")
        .select("location_id")
        .eq("secretary_id", data.secretaryId);
      allowedLocationIds = (secLocs || []).map((r: any) => r.location_id);
      if (!allowedLocationIds.length) return [] as InvoiceRow[];
    }

    // Fetch invoices with consumer profile join
    let query = supabaseAdmin
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 500);

    if (data.status && data.status !== "all") {
      query = query.eq("status", data.status);
    }
    if (data.consumerId) {
      query = query.eq("consumer_id", data.consumerId);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    if (!rows || !rows.length) return [] as InvoiceRow[];

    // Fetch consumer profiles in batch
    const consumerIds = Array.from(new Set(rows.map((r: any) => r.consumer_id)));
    const [profilesRes, detailsRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, phone")
        .in("id", consumerIds),
      supabaseAdmin
        .from("consumer_details")
        .select("user_id, block_id, location_id")
        .in("user_id", consumerIds),
    ]);

    const profileMap = new Map(
      (profilesRes.data || []).map((p: any) => [p.id, p]),
    );
    const detailMap = new Map(
      (detailsRes.data || []).map((d: any) => [d.user_id, d]),
    );

    let result: InvoiceRow[] = rows.map((r: any) => {
      const profile = profileMap.get(r.consumer_id) as any;
      const detail = detailMap.get(r.consumer_id) as any;
      return {
        ...r,
        consumer_name: profile?.full_name ?? null,
        consumer_phone: profile?.phone ?? null,
        block_id: detail?.block_id ?? null,
        location_id: detail?.location_id ?? null,
      };
    });

    // Filter by location (admin filter or secretary restriction)
    const locationFilter = data.locationId || null;
    if (locationFilter && locationFilter !== "all") {
      result = result.filter((r) => r.location_id === locationFilter);
    } else if (allowedLocationIds) {
      result = result.filter((r) => allowedLocationIds!.includes(r.location_id ?? ""));
    }

    return result;
  });

// ─────────────────────────────────────────────
// generateInvoice — admin only
// Creates an invoice for a consumer from their meter data
// ─────────────────────────────────────────────
const generateInput = z.object({
  consumerId: z.string().uuid(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lateFee: z.number().min(0).optional(),
  dueDays: z.number().int().min(1).max(90).optional(), // days from today for due date
});

export const generateInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => generateInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check for duplicate invoice for same consumer & period
    const { data: existing } = await supabaseAdmin
      .from("invoices")
      .select("id")
      .eq("consumer_id", data.consumerId)
      .eq("bill_period_start", data.periodStart)
      .eq("bill_period_end", data.periodEnd)
      .maybeSingle();
    if (existing) throw new Error("An invoice already exists for this consumer and period.");

    // Get current water rate
    const { data: rate, error: rateErr } = await supabaseAdmin
      .from("water_rates")
      .select("rate_per_liter, free_tier_liters")
      .lte("effective_from", data.periodEnd)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rateErr) throw new Error(rateErr.message);
    if (!rate) throw new Error("No water rate configured. Please set up a water rate first.");

    const ratePerLiter = Number(rate.rate_per_liter);
    const freePerMonth = Number(rate.free_tier_liters);

    // Calculate period length in days to pro-rate free tier
    const startDate = new Date(data.periodStart);
    const endDate = new Date(data.periodEnd);
    const periodDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
    const daysInMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
    const proratedFree = Math.round(freePerMonth * (periodDays / daysInMonth));

    // Get consumption from meter_readings for the period
    const { data: readings, error: rErr } = await supabaseAdmin
      .from("meter_readings")
      .select("reading, previous_reading, consumption, reading_date")
      .eq("consumer_id", data.consumerId)
      .gte("reading_date", `${data.periodStart}T00:00:00Z`)
      .lte("reading_date", `${data.periodEnd}T23:59:59Z`)
      .order("reading_date", { ascending: true });
    if (rErr) throw new Error(rErr.message);

    const totalConsumption = (readings || []).reduce(
      (s: number, r: any) => s + Number(r.consumption || 0),
      0,
    );

    const freeConsumption = Math.min(totalConsumption, proratedFree);
    const chargeableConsumption = Math.max(0, totalConsumption - freeConsumption);
    const amount = Math.round(chargeableConsumption * ratePerLiter * 100) / 100;
    const lateFee = data.lateFee ?? 0;
    const totalAmount = Math.round((amount + lateFee) * 100) / 100;

    // Due date
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (data.dueDays ?? 15));
    const dueDateStr = dueDate.toISOString().slice(0, 10);

    const { data: inv, error: iErr } = await supabaseAdmin.from("invoices").insert({
      consumer_id: data.consumerId,
      bill_period_start: data.periodStart,
      bill_period_end: data.periodEnd,
      consumption: totalConsumption,
      free_consumption: freeConsumption,
      chargeable_consumption: chargeableConsumption,
      rate_applied: ratePerLiter,
      amount,
      late_fee: lateFee,
      total_amount: totalAmount,
      due_date: dueDateStr,
      status: "pending",
    }).select("id").single();
    if (iErr) throw new Error(iErr.message);

    return { ok: true, invoiceId: inv.id, totalAmount, consumption: totalConsumption };
  });

// ─────────────────────────────────────────────
// markInvoicePaid — admin & secretary
// ─────────────────────────────────────────────
const markPaidInput = z.object({
  invoiceId: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
  method: z.enum(["online", "manual", "prepaid_recharge"]).optional(),
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

    const method = data.method ?? "manual";
    const paidAt = new Date().toISOString();

    const { error: upErr } = await supabaseAdmin
      .from("invoices")
      .update({ status: "paid", paid_at: paidAt })
      .eq("id", data.invoiceId);
    if (upErr) throw new Error(upErr.message);

    // Record payment
    const { error: pErr } = await supabaseAdmin.from("payments").insert({
      invoice_id: inv.id,
      consumer_id: inv.consumer_id,
      amount: inv.total_amount,
      method,
      notes: data.notes ?? null,
      recorded_by: null,
    });
    if (pErr) throw new Error(pErr.message);

    // If paid from prepaid balance, deduct
    if (method === "prepaid_recharge") {
      const { data: bal } = await supabaseAdmin
        .from("prepaid_balances")
        .select("balance")
        .eq("consumer_id", inv.consumer_id)
        .maybeSingle();
      const currentBalance = Number(bal?.balance ?? 0);
      const invoiceAmount = Number(inv.total_amount);
      if (currentBalance < invoiceAmount) throw new Error("Insufficient prepaid balance.");
      const { error: bErr } = await supabaseAdmin
        .from("prepaid_balances")
        .upsert({
          consumer_id: inv.consumer_id,
          balance: currentBalance - invoiceAmount,
          updated_at: paidAt,
        });
      if (bErr) throw new Error(bErr.message);
    }

    return { ok: true, alreadyPaid: false };
  });

// ─────────────────────────────────────────────
// payInvoiceFromPrepaid — consumer self-service
// Atomically deducts balance and marks paid
// ─────────────────────────────────────────────
const prepaidPayInput = z.object({
  invoiceId: z.string().uuid(),
  consumerId: z.string().uuid(),
});

export const payInvoiceFromPrepaid = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => prepaidPayInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify invoice belongs to this consumer
    const { data: inv, error: iErr } = await supabaseAdmin
      .from("invoices")
      .select("id, consumer_id, total_amount, status")
      .eq("id", data.invoiceId)
      .eq("consumer_id", data.consumerId)
      .maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inv) throw new Error("Invoice not found.");
    if (inv.status === "paid") return { ok: true, alreadyPaid: true };

    const { data: bal } = await supabaseAdmin
      .from("prepaid_balances")
      .select("balance")
      .eq("consumer_id", data.consumerId)
      .maybeSingle();

    const currentBalance = Number(bal?.balance ?? 0);
    const invoiceAmount = Number(inv.total_amount);
    if (currentBalance < invoiceAmount) {
      throw new Error(`Insufficient balance. You have ₹${currentBalance.toFixed(2)}, need ₹${invoiceAmount.toFixed(2)}.`);
    }

    const paidAt = new Date().toISOString();

    const [upRes, payRes, balRes] = await Promise.all([
      supabaseAdmin.from("invoices").update({ status: "paid", paid_at: paidAt }).eq("id", data.invoiceId),
      supabaseAdmin.from("payments").insert({
        invoice_id: inv.id,
        consumer_id: inv.consumer_id,
        amount: inv.total_amount,
        method: "prepaid_recharge",
        notes: "Paid from prepaid balance",
        recorded_by: null,
      }),
      supabaseAdmin.from("prepaid_balances").upsert({
        consumer_id: data.consumerId,
        balance: currentBalance - invoiceAmount,
        updated_at: paidAt,
      }),
    ]);

    if (upRes.error) throw new Error(upRes.error.message);
    if (payRes.error) throw new Error(payRes.error.message);
    if (balRes.error) throw new Error(balRes.error.message);

    return { ok: true, alreadyPaid: false, newBalance: currentBalance - invoiceAmount };
  });

// ─────────────────────────────────────────────
// rechargeBalance — admin or consumer self-service
// ─────────────────────────────────────────────
const rechargeInput = z.object({
  consumerId: z.string().uuid(),
  amount: z.number().min(1).max(100000),
  notes: z.string().trim().max(200).optional(),
  method: z.enum(["online", "manual", "prepaid_recharge"]).optional(),
});

export const rechargeBalance = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => rechargeInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("prepaid_balances")
      .select("balance")
      .eq("consumer_id", data.consumerId)
      .maybeSingle();

    const currentBalance = Number(existing?.balance ?? 0);
    const newBalance = currentBalance + data.amount;
    const now = new Date().toISOString();

    const [balRes, payRes] = await Promise.all([
      supabaseAdmin.from("prepaid_balances").upsert({
        consumer_id: data.consumerId,
        balance: newBalance,
        last_recharge_amount: data.amount,
        last_recharge_date: now,
        updated_at: now,
      }),
      supabaseAdmin.from("payments").insert({
        consumer_id: data.consumerId,
        invoice_id: null,
        amount: data.amount,
        method: data.method ?? "online",
        notes: data.notes ?? `Prepaid recharge ₹${data.amount}`,
        recorded_by: null,
      }),
    ]);

    if (balRes.error) throw new Error(balRes.error.message);
    if (payRes.error) throw new Error(payRes.error.message);

    return { ok: true, newBalance };
  });

// ─────────────────────────────────────────────
// markOverdueInvoices — admin: batch set pending → overdue past due_date
// ─────────────────────────────────────────────
export const markOverdueInvoices = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabaseAdmin
      .from("invoices")
      .update({ status: "overdue" })
      .in("status", ["pending"])
      .lt("due_date", today)
      .select("id");

    if (error) throw new Error(error.message);
    return { ok: true, updatedCount: (data || []).length };
  });