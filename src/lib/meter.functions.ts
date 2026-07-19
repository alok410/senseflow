import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SENSEFLOW_BASE = "https://apps.samasth.io:8090/api/Senseflow/Flowmeter/latest";
const SENSEFLOW_HISTORY = "https://apps.samasth.io:8090/api/Senseflow/Flowmeter/history";
const MAIN_METER_DEVICE = "USFL_FL7053";

function toIST(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString();
}

export const fetchAndStoreLatestReading = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ consumerId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    // Auth is temporarily disabled — anyone can trigger a reading fetch.
    const token = process.env.SENSEFLOW_API_TOKEN;
    if (!token) throw new Error("SENSEFLOW_API_TOKEN not configured");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: details, error: dErr } = await supabaseAdmin
      .from("consumer_details")
      .select("device_id, serial_number")
      .eq("user_id", data.consumerId).maybeSingle();
    if (dErr) throw new Error(dErr.message);
    // Senseflow API takes the device identifier (e.g. USFL_WM0003) as the `device` param.
    const device = details?.device_id;
    if (!device) throw new Error("This consumer has no Senseflow device_id (USFL_WMxxxx) configured.");

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
      recorded_by: null,
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

export const listSenseflowDevices = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: details, error } = await supabaseAdmin
    .from("consumer_details")
    .select("user_id, device_id, serial_number, block_id")
    .not("device_id", "is", null);
  if (error) throw new Error(error.message);
  const ids = (details ?? []).map((d) => d.user_id);
  const { data: profiles } = ids.length
    ? await supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", ids)
    : { data: [] as any[] };
  const pmap = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  const rows = (details ?? []).map((d: any) => ({
    consumerId: d.user_id,
    deviceId: d.device_id as string,
    serialNumber: d.serial_number as string | null,
    block: d.block_id as string | null,
    name: (pmap.get(d.user_id) as any)?.full_name ?? null,
    phone: (pmap.get(d.user_id) as any)?.phone ?? null,
  }));
  rows.sort((a, b) => (a.block ?? "").localeCompare(b.block ?? "", undefined, { numeric: true }));
  return rows;
});

// ---- Dashboard aggregation from live Senseflow API ----

type LatestApi = {
  flow_rate?: string | number;
  meter_reading?: string | number;
  reading_datetime?: string;
  last_active?: string;
  rssi?: string | number;
  serial_number?: string | null;
};
type HistoryDay = {
  opening_reading: string | number;
  closing_reading: string | number;
  reading_date: string; // yyyy-mm-dd
  consumption: string | number;
};
type HistoryApi = { data?: HistoryDay[]; last_active?: string; serial_number?: string | null };

async function sfLatest(device: string, token: string): Promise<LatestApi | null> {
  try {
    const r = await fetch(`${SENSEFLOW_BASE}?device=${encodeURIComponent(device)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return (await r.json()) as LatestApi;
  } catch { return null; }
}
async function sfHistory(device: string, startIso: string, endIso: string, token: string): Promise<HistoryDay[]> {
  try {
    const url = `${SENSEFLOW_HISTORY}?device=${encodeURIComponent(device)}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return [];
    const j = (await r.json()) as HistoryApi;
    return j.data ?? [];
  } catch { return []; }
}

export const getAdminDashboardStats = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    start: z.string(), // yyyy-mm-dd
    end: z.string(),   // yyyy-mm-dd
    locationId: z.string().uuid().optional().nullable(),
  }).parse(d))
  .handler(async ({ data }) => {
    const token = process.env.SENSEFLOW_API_TOKEN;
    if (!token) throw new Error("SENSEFLOW_API_TOKEN not configured");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [consumersRes, secretariesRes, locationsRes, detailsRes] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "consumer"),
      supabaseAdmin.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "secretary"),
      supabaseAdmin.from("locations").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("consumer_details").select("user_id, device_id, block_id, location_id").not("device_id", "is", null),
    ]);
    let details = (detailsRes.data ?? []) as Array<{ user_id: string; device_id: string; block_id: string | null; location_id: string | null }>;
    if (data.locationId) details = details.filter((d) => d.location_id === data.locationId);

    const startIso = `${data.start}T00:00:00Z`;
    const endIso = `${data.end}T23:59:59Z`;

    // Analytics devices exclude the Main Meter (avoid double-count with sub meters)
    const analyticsDevices = details.map((d) => d.device_id).filter((id) => id !== MAIN_METER_DEVICE);
    const mainInSet = details.some((d) => d.device_id === MAIN_METER_DEVICE);

    // Fetch histories for analytics + main meter in parallel
    const [mainHistory, analyticsHistories, mainLatest] = await Promise.all([
      sfHistory(MAIN_METER_DEVICE, startIso, endIso, token),
      Promise.all(analyticsDevices.map((d) => sfHistory(d, startIso, endIso, token))),
      sfLatest(MAIN_METER_DEVICE, token),
    ]);

    // Main meter overview (values in kilolitres -> convert to litres)
    const todayStr = new Date().toISOString().slice(0, 10);
    const monthPrefix = todayStr.slice(0, 7); // yyyy-mm
    let todaysUsageKl = 0;
    let thisMonthKl = 0;
    for (const d of mainHistory) {
      const c = Number(d.consumption || 0);
      if (d.reading_date === todayStr) todaysUsageKl += c;
      if (d.reading_date.startsWith(monthPrefix)) thisMonthKl += c;
    }
    // For "This Month" we may need broader range than requested; fetch a month-wide slice if needed
    let monthFull = thisMonthKl;
    if (!data.start.startsWith(monthPrefix) || data.start > `${monthPrefix}-01`) {
      const mHist = await sfHistory(MAIN_METER_DEVICE, `${monthPrefix}-01T00:00:00Z`, `${todayStr}T23:59:59Z`, token);
      monthFull = mHist.reduce((s, r) => s + Number(r.consumption || 0), 0);
      if (!todaysUsageKl) {
        const t = mHist.find((r) => r.reading_date === todayStr);
        todaysUsageKl = t ? Number(t.consumption || 0) : 0;
      }
    }
    const totalUsageKl = mainLatest?.meter_reading != null ? Number(mainLatest.meter_reading) : 0;
    const flowRate = mainLatest?.flow_rate != null ? Number(mainLatest.flow_rate) : 0;

    // Daily consumption trend (sum across analytics devices per day)
    const byDay = new Map<string, number>();
    for (const days of analyticsHistories) {
      for (const d of days) {
        byDay.set(d.reading_date, (byDay.get(d.reading_date) || 0) + Number(d.consumption || 0));
      }
    }
    const trend = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, kl]) => ({ date, consumption: Math.round(kl * 1000) }));
    const totalConsumptionL = Math.round(
      analyticsHistories.reduce((s, days) => s + days.reduce((a, d) => a + Number(d.consumption || 0), 0), 0) * 1000,
    );

    // Leaderboard (top consumers in range)
    const perDevice = analyticsDevices.map((dev, i) => ({
      device_id: dev,
      total_l: Math.round(analyticsHistories[i].reduce((a, d) => a + Number(d.consumption || 0), 0) * 1000),
    }));
    perDevice.sort((a, b) => b.total_l - a.total_l);
    const top = perDevice.slice(0, 20);
    const topDetails = details.filter((d) => top.some((t) => t.device_id === d.device_id));
    const profiles = topDetails.length
      ? (await supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", topDetails.map((d) => d.user_id))).data || []
      : [];
    const pMap = new Map(profiles.map((p: any) => [p.id, p]));
    const dMap = new Map(details.map((d) => [d.device_id, d]));
    const leaders = top.map((t) => {
      const det = dMap.get(t.device_id);
      const p = det ? pMap.get(det.user_id) : null;
      return {
        id: det?.user_id || t.device_id,
        name: (p as any)?.full_name || `Block ${det?.block_id ?? "?"}`,
        device_id: t.device_id,
        consumption: t.total_l,
      };
    });

    return {
      consumers: consumersRes.count ?? 0,
      secretaries: secretariesRes.count ?? 0,
      locations: locationsRes.count ?? 0,
      mainMeter: {
        available: mainInSet && !!mainLatest,
        todaysUsageL: Math.round(todaysUsageKl * 1000),
        thisMonthL: Math.round(monthFull * 1000),
        totalUsageL: Math.round(totalUsageKl * 1000),
        lastReadingAt: mainLatest?.reading_datetime ?? null,
      },
      flowRate,
      totalConsumptionL,
      trend,
      leaders,
    };
  });