import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SENSEFLOW_BASE = "https://apps.samasth.io:8090/api/Senseflow/Flowmeter/latest";

function toIST(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString();
}

export const fetchAndStoreLatestReading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ consumerId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // Authorization: admin, the consumer themselves, or secretary who manages them.
    const [{ data: isAdmin }, { data: isSec }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "secretary" }),
    ]);
    let allowed = !!isAdmin || context.userId === data.consumerId;
    if (!allowed && isSec) {
      const { data: mgr } = await context.supabase.rpc("secretary_manages_consumer", {
        _secretary_id: context.userId, _consumer_id: data.consumerId,
      });
      allowed = !!mgr;
    }
    if (!allowed) throw new Error("Forbidden");

    const token = process.env.SENSEFLOW_API_TOKEN;
    if (!token) throw new Error("SENSEFLOW_API_TOKEN not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: details, error: dErr } = await supabaseAdmin
      .from("consumer_details")
      .select("device_id, meter_id, serial_number")
      .eq("user_id", data.consumerId).maybeSingle();
    if (dErr) throw new Error(dErr.message);
    // Senseflow API needs the meter identifier (e.g. USFL_WM0003).
    // Prefer meter_id (matches the MERN model's meterId); fall back to device_id.
    const device = details?.meter_id || details?.device_id;
    if (!device) throw new Error("This consumer has no meter_id (or device_id) configured.");

    const url = `${SENSEFLOW_BASE}?device=${encodeURIComponent(device)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Senseflow API ${resp.status}: ${text.slice(0, 300)}`);
    let api: any;
    try { api = JSON.parse(text); } catch { throw new Error("Senseflow API returned invalid JSON."); }
    if (!api) throw new Error("Empty Senseflow response.");

    const reading = Number(api.meter_reading ?? 0);
    const flowRate = Number(api.flow_rate ?? 0);
    const rssi = api.rssi != null ? parseInt(String(api.rssi), 10) : null;
    const readingDate = toIST(api.reading_datetime) ?? new Date().toISOString();
    const lastActive = toIST(api.last_active);
    const serial = api.serial_number || details?.serial_number || null;

    // Previous reading for consumption
    const { data: prev } = await supabaseAdmin
      .from("meter_readings")
      .select("reading")
      .eq("consumer_id", data.consumerId)
      .order("reading_date", { ascending: false })
      .limit(1).maybeSingle();
    const previous = prev?.reading != null ? Number(prev.reading) : null;
    const consumption = previous != null ? Math.max(0, reading - previous) : 0;

    const row = {
      consumer_id: data.consumerId,
      meter_id: device,
      reading,
      previous_reading: previous,
      consumption,
      reading_date: readingDate,
      source: "api",
      recorded_by: context.userId,
      flow_rate: flowRate,
      rssi,
      last_active: lastActive,
      serial_number: serial,
    };

    const { data: existing } = await supabaseAdmin
      .from("meter_readings")
      .select("id")
      .eq("consumer_id", data.consumerId)
      .eq("reading_date", readingDate).maybeSingle();
    if (existing) return { skipped: true, id: existing.id };

    const { data: inserted, error: iErr } = await supabaseAdmin
      .from("meter_readings").insert(row as any).select("*").single();
    if (iErr) throw new Error(iErr.message);
    return { skipped: false, reading: inserted };
  });