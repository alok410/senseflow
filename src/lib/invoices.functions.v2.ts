import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────
export type InvoiceStatus =
  | "draft"
  | "published"
  | "pending"   // legacy — treat as published
  | "approved"  // legacy — treat as published
  | "paid"
  | "overdue"
  | "cancelled";

export type InvoiceMode = "ADMIN_APPROVAL" | "AUTO_PUBLISH";

export type FlagReason = "HIGH_USAGE" | "ZERO_USAGE" | "MISSING_READING";

export interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  billing_month: string | null;
  consumer_id: string;
  bill_period_start: string;
  bill_period_end: string;
  previous_reading: number | null;
  current_reading: number | null;
  units_consumed: number | null;
  consumption: number;
  free_consumption: number;
  chargeable_consumption: number;
  rate_applied: number;
  base_charge: number;
  other_charges: number;
  arrears: number;
  amount: number;
  late_fee: number;
  total_amount: number;
  due_date: string;
  status: InvoiceStatus;
  flagged: boolean;
  flag_reason: string | null;
  published_at: string | null;
  paid_at: string | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  // joined
  consumer_name: string | null;
  consumer_phone: string | null;
  block_id: string | null;
  location_id: string | null;
}

export interface AuditLogRow {
  id: string;
  invoice_id: string;
  action: string;
  performed_by: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  note: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
async function getInvoiceMode(supabaseAdmin: any): Promise<InvoiceMode> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "invoice_mode")
    .maybeSingle();
  const v = data?.value ?? "ADMIN_APPROVAL";
  return v === "AUTO_PUBLISH" ? "AUTO_PUBLISH" : "ADMIN_APPROVAL";
}

async function getSettingNum(supabaseAdmin: any, key: string, fallback: number): Promise<number> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("value").eq("key", key).maybeSingle();
  const n = parseFloat(data?.value ?? "");
  return isNaN(n) ? fallback : n;
}

async function writeAudit(
  supabaseAdmin: any,
  invoiceId: string,
  action: string,
  performedBy: string | null,
  opts?: { oldValue?: unknown; newValue?: unknown; note?: string }
) {
  await supabaseAdmin.from("invoice_audit_log").insert({
    invoice_id:   invoiceId,
    action,
    performed_by: performedBy,
    old_value:    opts?.oldValue ?? null,
    new_value:    opts?.newValue ?? null,
    note:         opts?.note ?? null,
  });
}

function joinConsumers(rows: any[], profileMap: Map<string, any>, detailMap: Map<string, any>): InvoiceRow[] {
  return rows.map((r: any) => {
    const profile = profileMap.get(r.consumer_id) as any;
    const detail  = detailMap.get(r.consumer_id) as any;
    return {
      ...r,
      base_charge:   Number(r.base_charge ?? 0),
      other_charges: Number(r.other_charges ?? 0),
      arrears:       Number(r.arrears ?? 0),
      flagged:       r.flagged ?? false,
      consumer_name:  profile?.full_name ?? null,
      consumer_phone: profile?.phone ?? null,
      block_id:       detail?.block_id ?? null,
      location_id:    detail?.location_id ?? null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────
// listInvoices — admin & secretary
// ─────────────────────────────────────────────────────────────────
const listInput = z.object({
  status:      z.string().optional(),
  billingMonth: z.string().optional(),   // YYYY-MM
  locationId:  z.string().uuid().nullable().optional(),
  consumerId:  z.string().uuid().nullable().optional(),
  secretaryId: z.string().uuid().nullable().optional(),
  flagged:     z.boolean().optional(),
  page:        z.number().int().min(1).optional(),
  pageSize:    z.number().int().min(1).max(200).optional(),
});

export const listInvoices = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => listInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let allowedLocationIds: string[] | null = null;
    if (data.secretaryId) {
      const { data: secLocs } = await supabaseAdmin
        .from("secretary_locations")
        .select("location_id")
        .eq("secretary_id", data.secretaryId);
      allowedLocationIds = (secLocs || []).map((r: any) => r.location_id);
      if (!allowedLocationIds.length) return { rows: [] as InvoiceRow[], total: 0 };
    }

    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 100;
    const from = (page - 1) * pageSize;
    const to   = from + pageSize - 1;

    let query = supabaseAdmin
      .from("invoices")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (data.status && data.status !== "all") query = query.eq("status", data.status as any);
    if (data.billingMonth) query = query.eq("billing_month", data.billingMonth);
    if (data.consumerId)   query = query.eq("consumer_id", data.consumerId);
    if (data.flagged !== undefined) query = query.eq("flagged", data.flagged);

    const { data: rows, error, count } = await query;
    if (error) throw new Error(error.message);
    if (!rows?.length) return { rows: [] as InvoiceRow[], total: 0 };

    const consumerIds = Array.from(new Set(rows.map((r: any) => r.consumer_id)));
    const [profilesRes, detailsRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", consumerIds),
      supabaseAdmin.from("consumer_details").select("user_id, block_id, location_id").in("user_id", consumerIds),
    ]);
    const profileMap = new Map((profilesRes.data || []).map((p: any) => [p.id, p]));
    const detailMap  = new Map((detailsRes.data || []).map((d: any) => [d.user_id, d]));

    let result = joinConsumers(rows, profileMap, detailMap);

    // Location filters
    const locationFilter = data.locationId;
    if (locationFilter && locationFilter !== "all") {
      result = result.filter((r) => r.location_id === locationFilter);
    } else if (allowedLocationIds) {
      result = result.filter((r) => allowedLocationIds!.includes(r.location_id ?? ""));
    }

    return { rows: result, total: count ?? result.length };
  });

// ─────────────────────────────────────────────────────────────────
// getInvoice — single invoice with audit log
// ─────────────────────────────────────────────────────────────────
export const getInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [invRes, auditRes] = await Promise.all([
      supabaseAdmin.from("invoices").select("*").eq("id", data.invoiceId).maybeSingle(),
      supabaseAdmin.from("invoice_audit_log").select("*")
        .eq("invoice_id", data.invoiceId).order("created_at", { ascending: false }),
    ]);
    if (invRes.error) throw new Error(invRes.error.message);
    if (!invRes.data)  throw new Error("Invoice not found.");

    const r = invRes.data;
    const [profileRes, detailRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, phone").eq("id", r.consumer_id).maybeSingle(),
      supabaseAdmin.from("consumer_details").select("user_id, block_id, location_id").eq("user_id", r.consumer_id).maybeSingle(),
    ]);
    const inv: InvoiceRow = {
      ...r,
      base_charge:   Number(r.base_charge ?? 0),
      other_charges: Number(r.other_charges ?? 0),
      arrears:       Number(r.arrears ?? 0),
      flagged:       r.flagged ?? false,
      consumer_name:  profileRes.data?.full_name ?? null,
      consumer_phone: profileRes.data?.phone ?? null,
      block_id:       detailRes.data?.block_id ?? null,
      location_id:    detailRes.data?.location_id ?? null,
    };
    return { invoice: inv, auditLog: (auditRes.data ?? []) as AuditLogRow[] };
  });

// ─────────────────────────────────────────────────────────────────
// generateMonthlyBatch — admin only; idempotent bulk generation
// ─────────────────────────────────────────────────────────────────
const batchInput = z.object({
  billingMonth: z.string().regex(/^\d{4}-\d{2}$/, "Must be YYYY-MM"),
  dueDays:      z.number().int().min(1).max(90).optional(),
  performedBy:  z.string().uuid().optional(),
});

export const generateMonthlyBatch = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => batchInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [year, month] = data.billingMonth.split("-").map(Number);
    const periodStart = `${data.billingMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const periodEnd = `${data.billingMonth}-${String(lastDay).padStart(2, "0")}`;

    // Settings
    const mode = await getInvoiceMode(supabaseAdmin);
    const lateFeeDefault = await getSettingNum(supabaseAdmin, "invoice_late_fee", 50);
    const baseCharge     = await getSettingNum(supabaseAdmin, "invoice_base_charge", 0);

    // Rate
    const { data: rate, error: rateErr } = await supabaseAdmin
      .from("water_rates")
      .select("rate_per_liter, free_tier_liters")
      .lte("effective_from", periodEnd)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rateErr) throw new Error(rateErr.message);
    if (!rate)   throw new Error("No water rate configured.");

    const ratePerLiter = Number(rate.rate_per_liter);
    const freePerMonth = Number(rate.free_tier_liters);
    const daysInMonth  = lastDay;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (data.dueDays ?? 15));
    const dueDateStr = dueDate.toISOString().slice(0, 10);

    // All consumer IDs
    const { data: consumerRoles, error: cErr } = await supabaseAdmin
      .from("user_roles").select("user_id").eq("role", "consumer");
    if (cErr) throw new Error(cErr.message);
    const consumerIds = Array.from(new Set((consumerRoles ?? []).map((r: any) => r.user_id)));

    // Already-have-invoice set
    const { data: existing } = await supabaseAdmin
      .from("invoices").select("consumer_id")
      .eq("billing_month", data.billingMonth)
      .in("consumer_id", consumerIds)
      .not("status", "eq", "cancelled");
    const alreadyHas = new Set((existing ?? []).map((r: any) => r.consumer_id));

    // All readings for the period (batch)
    const { data: allReadings } = await supabaseAdmin
      .from("meter_readings")
      .select("consumer_id, consumption, reading")
      .in("consumer_id", consumerIds)
      .gte("reading_date", `${periodStart}T00:00:00Z`)
      .lte("reading_date", `${periodEnd}T23:59:59Z`);

    const readingsByConsumer = new Map<string, { total: number; hasReading: boolean }>();
    for (const r of allReadings ?? []) {
      const prev = readingsByConsumer.get(r.consumer_id) ?? { total: 0, hasReading: false };
      readingsByConsumer.set(r.consumer_id, {
        total: prev.total + Number(r.consumption ?? 0),
        hasReading: true,
      });
    }

    // 3-month avg for anomaly detection (look back 3 months before billing_month)
    const threeMonthsAgoStart = new Date(year, month - 4, 1).toISOString().slice(0, 10);
    const threeMonthsAgoEnd   = new Date(year, month - 1, 0).toISOString().slice(0, 10);
    const { data: historicReadings } = await supabaseAdmin
      .from("meter_readings")
      .select("consumer_id, consumption")
      .in("consumer_id", consumerIds)
      .gte("reading_date", `${threeMonthsAgoStart}T00:00:00Z`)
      .lte("reading_date", `${threeMonthsAgoEnd}T23:59:59Z`);

    const historic3m = new Map<string, number[]>();
    for (const r of historicReadings ?? []) {
      const arr = historic3m.get(r.consumer_id) ?? [];
      arr.push(Number(r.consumption ?? 0));
      historic3m.set(r.consumer_id, arr);
    }

    // Carry-forward arrears: sum of unpaid (overdue/pending/published) invoices
    const { data: unpaidInvoices } = await supabaseAdmin
      .from("invoices")
      .select("consumer_id, total_amount")
      .in("consumer_id", consumerIds)
      .in("status", ["overdue", "pending", "published"])
      .lt("billing_month", data.billingMonth);
    const arrearsByConsumer = new Map<string, number>();
    for (const inv of unpaidInvoices ?? []) {
      const prev = arrearsByConsumer.get(inv.consumer_id) ?? 0;
      arrearsByConsumer.set(inv.consumer_id, prev + Number(inv.total_amount ?? 0));
    }

    // Build invoices per consumer
    const results = { created: 0, skipped: 0, flagged: 0, failed: 0, errors: [] as string[] };

    for (const consumerId of consumerIds) {
      if (alreadyHas.has(consumerId)) { results.skipped++; continue; }

      try {
        const info     = readingsByConsumer.get(consumerId);
        const hasData  = !!info?.hasReading;
        const totalCons = info?.total ?? 0;

        // Anomaly detection
        let flagged     = false;
        let flagReason: FlagReason | null = null;

        if (!hasData) {
          flagged = true;
          flagReason = "MISSING_READING";
        } else if (totalCons === 0) {
          flagged = true;
          flagReason = "ZERO_USAGE";
        } else {
          const h = historic3m.get(consumerId) ?? [];
          if (h.length > 0) {
            const avg = h.reduce((s, v) => s + v, 0) / h.length;
            if (avg > 0 && totalCons > avg * 3) {
              flagged = true;
              flagReason = "HIGH_USAGE";
            }
          }
        }

        // For MISSING_READING, skip invoice generation (do not create a wrong bill)
        if (flagReason === "MISSING_READING") {
          results.flagged++;
          results.errors.push(`Consumer ${consumerId}: MISSING_READING — no invoice created`);
          continue;
        }

        const proratedFree       = Math.round(freePerMonth * (daysInMonth / daysInMonth)); // = freePerMonth for full month
        const freeConsumption    = Math.min(totalCons, proratedFree);
        const chargeableCons     = Math.max(0, totalCons - freeConsumption);
        // All money in rupees (2dp), never floats passed through
        const waterCharge        = Math.round(chargeableCons * ratePerLiter * 100) / 100;
        const arrears            = Math.round((arrearsByConsumer.get(consumerId) ?? 0) * 100) / 100;
        const totalAmount        = Math.round((waterCharge + baseCharge + arrears) * 100) / 100;

        // Status depends on mode and anomaly flag
        const status: InvoiceStatus =
          mode === "AUTO_PUBLISH" && !flagged ? "published" : "draft";
        const publishedAt = status === "published" ? new Date().toISOString() : null;

        const { data: inv, error: iErr } = await supabaseAdmin
          .from("invoices")
          .insert({
            consumer_id:            consumerId,
            billing_month:          data.billingMonth,
            bill_period_start:      periodStart,
            bill_period_end:        periodEnd,
            consumption:            totalCons,
            free_consumption:       freeConsumption,
            chargeable_consumption: chargeableCons,
            units_consumed:         chargeableCons,
            rate_applied:           ratePerLiter,
            base_charge:            baseCharge,
            other_charges:          0,
            arrears,
            amount:                 waterCharge,
            late_fee:               0,
            total_amount:           totalAmount,
            due_date:               dueDateStr,
            status,
            published_at:           publishedAt,
            flagged,
            flag_reason:            flagReason,
            created_by:             data.performedBy ?? "SYSTEM",
          })
          .select("id")
          .single();

        if (iErr) throw new Error(iErr.message);

        await writeAudit(supabaseAdmin, inv.id, flagged ? "DRAFT_FLAGGED" : `DRAFT_CREATED`, data.performedBy ?? null, {
          newValue: { status, flagReason, totalAmount },
        });

        if (flagged) results.flagged++;
        results.created++;
      } catch (e: any) {
        results.failed++;
        results.errors.push(`Consumer ${consumerId}: ${e?.message ?? "unknown error"}`);
      }
    }

    return { ...results, total: consumerIds.length, billingMonth: data.billingMonth, mode };
  });

// ─────────────────────────────────────────────────────────────────
// approveInvoice — admin or secretary with permission
// ─────────────────────────────────────────────────────────────────
const approveInput = z.object({
  invoiceId:   z.string().uuid(),
  performedBy: z.string().uuid(),
});

export const approveInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => approveInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check permission
    const { data: perm } = await supabaseAdmin.rpc("can_approve_invoice", { _user_id: data.performedBy });
    if (!perm) throw new Error("You do not have permission to approve invoices.");

    const { data: inv, error: iErr } = await supabaseAdmin
      .from("invoices").select("id, status, flagged").eq("id", data.invoiceId).maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inv) throw new Error("Invoice not found.");
    if (inv.status !== "draft") throw new Error(`Cannot approve invoice with status: ${inv.status}`);

    const now = new Date().toISOString();
    const { error: upErr } = await supabaseAdmin
      .from("invoices")
      .update({
        status:       "published",
        published_at: now,
        approved_by:  data.performedBy,
        approved_at:  now,
        flagged:      false,  // admin reviewed and approved despite flag
      })
      .eq("id", data.invoiceId);
    if (upErr) throw new Error(upErr.message);

    await writeAudit(supabaseAdmin, data.invoiceId, "APPROVED", data.performedBy, {
      oldValue: { status: "draft" },
      newValue: { status: "published" },
    });

    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────────
// bulkApproveInvoices — admin or permitted secretary
// ─────────────────────────────────────────────────────────────────
const bulkApproveInput = z.object({
  invoiceIds:   z.array(z.string().uuid()).optional(),
  billingMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  skipFlagged:  z.boolean().optional(),
  performedBy:  z.string().uuid(),
});

export const bulkApproveInvoices = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => bulkApproveInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: perm } = await supabaseAdmin.rpc("can_approve_invoice", { _user_id: data.performedBy });
    if (!perm) throw new Error("No permission to approve invoices.");

    let ids = data.invoiceIds ?? [];

    if (!ids.length && data.billingMonth) {
      let q = supabaseAdmin
        .from("invoices").select("id")
        .eq("billing_month", data.billingMonth)
        .eq("status", "draft");
      if (data.skipFlagged) q = q.eq("flagged", false);
      const { data: drafts } = await q;
      ids = (drafts ?? []).map((r: any) => r.id);
    }
    if (!ids.length) return { approved: 0 };

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("invoices")
      .update({ status: "published", published_at: now, approved_by: data.performedBy, approved_at: now })
      .in("id", ids)
      .eq("status", "draft");
    if (error) throw new Error(error.message);

    // Audit each
    for (const id of ids) {
      await writeAudit(supabaseAdmin, id, "BULK_APPROVED", data.performedBy, {
        newValue: { status: "published" },
      });
    }
    return { approved: ids.length };
  });

// ─────────────────────────────────────────────────────────────────
// cancelInvoice — admin only
// ─────────────────────────────────────────────────────────────────
const cancelInput = z.object({
  invoiceId:   z.string().uuid(),
  reason:      z.string().trim().min(3, "Reason required").max(500),
  performedBy: z.string().uuid(),
});

export const cancelInvoice = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => cancelInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inv, error: iErr } = await supabaseAdmin
      .from("invoices").select("id, status").eq("id", data.invoiceId).maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inv) throw new Error("Invoice not found.");
    if (inv.status === "paid") throw new Error("Cannot cancel a paid invoice.");
    if (inv.status === "cancelled") return { ok: true, alreadyCancelled: true };

    const now = new Date().toISOString();
    const { error: upErr } = await supabaseAdmin
      .from("invoices")
      .update({ status: "cancelled", cancelled_at: now, cancel_reason: data.reason })
      .eq("id", data.invoiceId);
    if (upErr) throw new Error(upErr.message);

    await writeAudit(supabaseAdmin, data.invoiceId, "CANCELLED", data.performedBy, {
      oldValue: { status: inv.status },
      newValue: { status: "cancelled", cancel_reason: data.reason },
    });
    return { ok: true, alreadyCancelled: false };
  });

// ─────────────────────────────────────────────────────────────────
// editInvoiceDraft — admin: patch charges on DRAFT invoices only
// ─────────────────────────────────────────────────────────────────
const editInput = z.object({
  invoiceId:    z.string().uuid(),
  performedBy:  z.string().uuid(),
  baseCharge:   z.number().min(0).optional(),
  otherCharges: z.number().min(0).optional(),
  lateFee:      z.number().min(0).optional(),
  arrears:      z.number().min(0).optional(),
  note:         z.string().max(500).optional(),
});

export const editInvoiceDraft = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => editInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: inv, error: iErr } = await supabaseAdmin
      .from("invoices")
      .select("id, status, amount, base_charge, other_charges, late_fee, arrears")
      .eq("id", data.invoiceId).maybeSingle();
    if (iErr) throw new Error(iErr.message);
    if (!inv) throw new Error("Invoice not found.");
    if (inv.status !== "draft") throw new Error("Only DRAFT invoices can be edited.");

    const patch: Record<string, number> = {};
    if (data.baseCharge   !== undefined) patch.base_charge   = data.baseCharge;
    if (data.otherCharges !== undefined) patch.other_charges = data.otherCharges;
    if (data.lateFee      !== undefined) patch.late_fee      = data.lateFee;
    if (data.arrears      !== undefined) patch.arrears       = data.arrears;

    if (!Object.keys(patch).length) return { ok: true };

    // Recalculate total
    const baseCharge   = data.baseCharge   ?? Number(inv.base_charge   ?? 0);
    const otherCharges = data.otherCharges ?? Number(inv.other_charges ?? 0);
    const lateFee      = data.lateFee      ?? Number(inv.late_fee      ?? 0);
    const arrears      = data.arrears      ?? Number(inv.arrears       ?? 0);
    const totalAmount  = Math.round((Number(inv.amount) + baseCharge + otherCharges + lateFee + arrears) * 100) / 100;
    patch.total_amount = totalAmount;

    const { error: upErr } = await supabaseAdmin
      .from("invoices").update(patch).eq("id", data.invoiceId);
    if (upErr) throw new Error(upErr.message);

    await writeAudit(supabaseAdmin, data.invoiceId, "FIELD_EDITED", data.performedBy, {
      oldValue: { base_charge: inv.base_charge, other_charges: inv.other_charges, late_fee: inv.late_fee, arrears: inv.arrears },
      newValue: { ...patch },
      note: data.note,
    });
    return { ok: true, totalAmount };
  });

// ─────────────────────────────────────────────────────────────────
// runOverdueJob — admin: PUBLISHED/pending past due → OVERDUE + late fee
// ─────────────────────────────────────────────────────────────────
export const runOverdueJob = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date().toISOString().slice(0, 10);
    const lateFee = await getSettingNum(supabaseAdmin, "invoice_late_fee", 50);

    // Fetch overdue candidates — only where late_fee not yet applied (late_fee == 0)
    const { data: candidates, error: fErr } = await supabaseAdmin
      .from("invoices")
      .select("id, total_amount, late_fee")
      .in("status", ["published", "pending", "approved"])
      .lt("due_date", today);
    if (fErr) throw new Error(fErr.message);
    if (!candidates?.length) return { updated: 0 };

    let updated = 0;
    for (const inv of candidates) {
      const existingLateFee = Number(inv.late_fee ?? 0);
      const addLateFee = existingLateFee === 0 ? lateFee : 0; // apply once
      const newTotal = Math.round((Number(inv.total_amount) + addLateFee) * 100) / 100;

      const { error } = await supabaseAdmin
        .from("invoices")
        .update({ status: "overdue", late_fee: existingLateFee + addLateFee, total_amount: newTotal })
        .eq("id", inv.id);
      if (!error) {
        await writeAudit(supabaseAdmin, inv.id, "OVERDUE_FLAGGED", null, {
          newValue: { status: "overdue", late_fee: addLateFee, total_amount: newTotal },
        });
        updated++;
      }
    }
    return { updated };
  });

// ─────────────────────────────────────────────────────────────────
// getMyInvoices — consumer: only published/paid/overdue, never draft
// ─────────────────────────────────────────────────────────────────
const myInvoicesInput = z.object({
  consumerId: z.string().uuid(),
  page:       z.number().int().min(1).optional(),
  pageSize:   z.number().int().min(1).max(50).optional(),
});

export const getMyInvoices = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => myInvoicesInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 20;

    const { data: rows, error, count } = await supabaseAdmin
      .from("invoices")
      .select("*", { count: "exact" })
      .eq("consumer_id", data.consumerId)
      .in("status", ["published", "pending", "approved", "paid", "overdue"])
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((r: any) => ({
        ...r,
        base_charge:   Number(r.base_charge   ?? 0),
        other_charges: Number(r.other_charges ?? 0),
        arrears:       Number(r.arrears       ?? 0),
        flagged:       false, // consumers never see flagged details
        consumer_name: null,
        consumer_phone: null,
        block_id:       null,
        location_id:    null,
      })) as InvoiceRow[],
      total: count ?? 0,
    };
  });

// ─────────────────────────────────────────────────────────────────
// getMyInvoiceDetail — consumer: single invoice ownership check
// ─────────────────────────────────────────────────────────────────
export const getMyInvoiceDetail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid(), consumerId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv, error } = await supabaseAdmin
      .from("invoices")
      .select("*")
      .eq("id", data.invoiceId)
      .eq("consumer_id", data.consumerId)
      .in("status", ["published", "pending", "approved", "paid", "overdue"])
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv)  throw new Error("Invoice not found.");

    // Fetch payment history for this invoice
    const { data: payments } = await supabaseAdmin
      .from("dummy_payments")
      .select("*")
      .eq("invoice_id", data.invoiceId)
      .order("created_at", { ascending: false });

    return {
      invoice: {
        ...inv,
        base_charge:   Number(inv.base_charge   ?? 0),
        other_charges: Number(inv.other_charges ?? 0),
        arrears:       Number(inv.arrears       ?? 0),
        flagged:       false,
      } as InvoiceRow,
      payments: payments ?? [],
    };
  });

// ─────────────────────────────────────────────────────────────────
// getUserPermissions — read a user's permission flags
// ─────────────────────────────────────────────────────────────────
export const getUserPermissions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("user_permissions").select("*").eq("user_id", data.userId).maybeSingle();
    return { can_approve_invoices: row?.can_approve_invoices ?? false };
  });

// ─────────────────────────────────────────────────────────────────
// setUserPermissions — admin: grant/revoke can_approve_invoices
// ─────────────────────────────────────────────────────────────────
export const setUserPermissions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    userId:             z.string().uuid(),
    canApproveInvoices: z.boolean(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_permissions")
      .upsert({ user_id: data.userId, can_approve_invoices: data.canApproveInvoices, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────────
// getInvoiceAuditLog
// ─────────────────────────────────────────────────────────────────
export const getInvoiceAuditLog = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ invoiceId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("invoice_audit_log")
      .select("*")
      .eq("invoice_id", data.invoiceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as AuditLogRow[];
  });

// ─────────────────────────────────────────────────────────────────
// Re-export existing functions so callers don't break
// ─────────────────────────────────────────────────────────────────
export { generateInvoice, bulkGenerateMonthlyInvoices, markInvoicePaid, markOverdueInvoices,
         payInvoiceFromPrepaid, rechargeBalance, getPaymentAnalytics } from "./invoices.functions.legacy";
export type { MonthlyTrend, PaymentAnalytics } from "./invoices.functions.legacy";
