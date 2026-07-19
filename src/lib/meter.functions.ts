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
type DashboardConsumer = {
  user_id: string;
  device_id: string;
  serial_number: string | null;
  block_id: string | null;
  location_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean | null;
};

function isValidDashboardConsumer(c: DashboardConsumer): boolean {
  const block = (c.block_id ?? "").trim();
  const device = (c.device_id ?? "").trim();
  return !!device
    && block !== "00"
    && device !== MAIN_METER_DEVICE
    && device !== "MAIN"
    && device !== "0"
    && c.is_active !== false;
}

function canonicalizeConsumers(rows: DashboardConsumer[]): DashboardConsumer[] {
  const byExactMeter = new Map<string, DashboardConsumer>();
  for (const row of rows) {
    const key = [row.device_id, row.block_id ?? "", row.serial_number ?? ""].join("|");
    const current = byExactMeter.get(key);
    if (!current) {
      byExactMeter.set(key, row);
      continue;
    }
    const currentScore = (current.email ? 2 : 0) + (current.phone ? 1 : 0);
    const nextScore = (row.email ? 2 : 0) + (row.phone ? 1 : 0);
    if (nextScore > currentScore) byExactMeter.set(key, row);
  }
  return Array.from(byExactMeter.values()).sort((a, b) => {
    const aBlock = a.block_id ?? "";
    const bBlock = b.block_id ?? "";
    const aNum = Number.parseInt(aBlock, 10);
    const bNum = Number.parseInt(bBlock, 10);
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) return aNum - bNum;
    return aBlock.localeCompare(bBlock, undefined, { numeric: true }) || a.device_id.localeCompare(b.device_id);
  });
}

function consumptionKl(day: HistoryDay): number {
  return Math.max(0, Number(day.consumption || 0));
}

async function fetchWithTimeout(url: string, token: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const deadline = new Promise<Response>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("Senseflow request timed out"));
      }, timeoutMs);
    });
    return await Promise.race([request, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const current = next++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function withDeadline<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

async function sfLatest(device: string, token: string): Promise<LatestApi | null> {
  try {
    const r = await fetchWithTimeout(`${SENSEFLOW_BASE}?device=${encodeURIComponent(device)}`, token, 30000);
    if (!r.ok) return null;
    return (await r.json()) as LatestApi;
  } catch { return null; }
}
async function sfHistory(device: string, startIso: string, endIso: string, token: string): Promise<HistoryDay[]> {
  try {
    const url = `${SENSEFLOW_HISTORY}?device=${encodeURIComponent(device)}&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
    const r = await fetchWithTimeout(url, token, 30000);
    if (!r.ok) return [];
    const j = (await r.json()) as HistoryApi | HistoryDay[];
    if (Array.isArray(j)) return j;
    return Array.isArray(j.data) ? j.data : [];
  } catch { return []; }
}

export const getAdminDashboardStats = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    start: z.string(), // yyyy-mm-dd
    end: z.string(),   // yyyy-mm-dd
    locationId: z.string().uuid().optional().nullable(),
    userId: z.string().uuid().optional().nullable(),
    topLimit: z.number().int().min(1).max(50).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const token = process.env.SENSEFLOW_API_TOKEN;
    if (!token) throw new Error("SENSEFLOW_API_TOKEN not configured");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [consumerRolesRes, secretaryRolesRes, locationsRes] = await Promise.all([
      supabaseAdmin.from("user_roles").select("user_id").eq("role", "consumer"),
      supabaseAdmin.from("user_roles").select("user_id").eq("role", "secretary"),
      supabaseAdmin.from("locations").select("id", { count: "exact", head: true }),
    ]);
    if (consumerRolesRes.error) throw new Error(consumerRolesRes.error.message);
    if (secretaryRolesRes.error) throw new Error(secretaryRolesRes.error.message);

    const consumerIds = Array.from(new Set((consumerRolesRes.data ?? []).map((r) => r.user_id)));
    const [detailsRes, profilesRes, secretaryLocationsRes] = await Promise.all([
      consumerIds.length
        ? supabaseAdmin
          .from("consumer_details")
          .select("user_id, device_id, serial_number, block_id, location_id")
          .in("user_id", consumerIds)
          .not("device_id", "is", null)
        : Promise.resolve({ data: [] as any[], error: null }),
      consumerIds.length
        ? supabaseAdmin
          .from("profiles")
          .select("id, full_name, phone, email, is_active")
          .in("id", consumerIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      data.locationId
        ? supabaseAdmin.from("secretary_locations").select("secretary_id").eq("location_id", data.locationId)
        : Promise.resolve({ data: null as any, error: null }),
    ]);
    if (detailsRes.error) throw new Error(detailsRes.error.message);
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (secretaryLocationsRes.error) throw new Error(secretaryLocationsRes.error.message);

    const profileMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p]));
    const allConsumerDetails = ((detailsRes.data ?? []) as any[]).map((d) => {
      const p = profileMap.get(d.user_id) as any | undefined;
      return {
        user_id: d.user_id,
        device_id: d.device_id,
        serial_number: d.serial_number,
        block_id: d.block_id,
        location_id: d.location_id,
        full_name: p?.full_name ?? null,
        phone: p?.phone ?? null,
        email: p?.email ?? null,
        is_active: p?.is_active ?? true,
      } satisfies DashboardConsumer;
    });

    const mainInSet = allConsumerDetails.some((d) => d.device_id === MAIN_METER_DEVICE && d.is_active !== false);
    let details = canonicalizeConsumers(allConsumerDetails.filter(isValidDashboardConsumer));
    if (data.locationId) details = details.filter((d) => d.location_id === data.locationId);
    if (data.userId) details = details.filter((d) => d.user_id === data.userId);

    let secretaryCount = (secretaryRolesRes.data ?? []).length;
    if (data.locationId) {
      secretaryCount = new Set(((secretaryLocationsRes.data ?? []) as any[]).map((s) => s.secretary_id)).size;
    }

    const startIso = `${data.start}T00:00:00Z`;
    const endIso = `${data.end}T23:59:59Z`;

    // Analytics devices exclude the Main Meter (avoid double-count with sub meters)
    const analyticsDevices = details.map((d) => d.device_id).filter((id) => id !== MAIN_METER_DEVICE);
    const fastEmpty = {
      consumers: details.length,
      secretaries: secretaryCount,
      locations: locationsRes.count ?? 0,
      mainMeter: {
        available: mainInSet,
        todaysUsageL: 0,
        thisMonthL: 0,
        totalUsageL: 0,
        lastReadingAt: null as string | null,
      },
      flowRate: 0,
      totalConsumptionL: 0,
      trend: [] as Array<{ date: string; consumption: number }>,
      leaders: [] as Array<{ id: string; name: string; device_id: string; consumption: number }>,
    };

    // Keep dashboard values partial and responsive: one slow sub-meter must not zero the main meter.
    const [mainHistory, mainLatest] = await Promise.all([
      withDeadline(sfHistory(MAIN_METER_DEVICE, startIso, endIso, token), [] as HistoryDay[], 35000),
      withDeadline(sfLatest(MAIN_METER_DEVICE, token), null as LatestApi | null, 35000),
    ] as const);
    const analyticsHistories = await withDeadline(
      mapWithConcurrency(analyticsDevices, Math.max(1, analyticsDevices.length), (d) => sfHistory(d, startIso, endIso, token)),
      analyticsDevices.map(() => [] as HistoryDay[]),
      40000,
    );

    // Main meter overview (values in kilolitres -> convert to litres)
    const todayStr = new Date().toISOString().slice(0, 10);
    const monthPrefix = todayStr.slice(0, 7); // yyyy-mm
    let todaysUsageKl = 0;
    let thisMonthKl = 0;
    for (const d of mainHistory) {
      const c = consumptionKl(d);
      if (d.reading_date === todayStr) todaysUsageKl += c;
      if (d.reading_date.startsWith(monthPrefix)) thisMonthKl += c;
    }
    // For "This Month" we may need broader range than requested; fetch a month-wide slice if needed
    let monthFull = thisMonthKl;
    if (!data.start.startsWith(monthPrefix) || data.start > `${monthPrefix}-01`) {
      const mHist = await withDeadline(
        sfHistory(MAIN_METER_DEVICE, `${monthPrefix}-01T00:00:00Z`, `${todayStr}T23:59:59Z`, token),
        [] as HistoryDay[],
        35000,
      );
      monthFull = mHist.length ? mHist.reduce((s, r) => s + consumptionKl(r), 0) : monthFull;
      if (!todaysUsageKl) {
        const t = mHist.find((r) => r.reading_date === todayStr);
        todaysUsageKl = t ? consumptionKl(t) : 0;
      }
    }
    const latestMainHistory = mainHistory.at(-1);
    const totalUsageKl = mainLatest?.meter_reading != null
      ? Number(mainLatest.meter_reading)
      : Number(latestMainHistory?.closing_reading || 0);
    const flowRate = Number(mainLatest?.flow_rate || 0);

    // Daily consumption trend (sum across analytics devices per day)
    const byDay = new Map<string, number>();
    for (const days of analyticsHistories) {
      for (const d of days) {
        byDay.set(d.reading_date, (byDay.get(d.reading_date) || 0) + consumptionKl(d));
      }
    }
    const trend = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, kl]) => ({ date, consumption: Math.round(kl * 1000) }));
    const totalConsumptionL = Math.round(
      analyticsHistories.reduce((s, days) => s + days.reduce((a, d) => a + consumptionKl(d), 0), 0) * 1000,
    );

    // Leaderboard (top consumers in range)
    const groupedByDevice = new Map<string, { device_id: string; total_l: number; detail: DashboardConsumer }>();
    analyticsDevices.forEach((dev, i) => {
      const total = Math.round(analyticsHistories[i].reduce((a, d) => a + consumptionKl(d), 0) * 1000);
      const existing = groupedByDevice.get(dev);
      if (existing) existing.total_l += total;
      else groupedByDevice.set(dev, { device_id: dev, total_l: total, detail: details[i] });
    });
    const top = Array.from(groupedByDevice.values())
      .sort((a, b) => b.total_l - a.total_l)
      .slice(0, data.topLimit ?? 20);
    const leaders = top.map((t) => {
      const det = t.detail;
      const labelName = det.full_name || det.phone || t.device_id;
      return {
        id: det?.user_id || t.device_id,
        name: det?.block_id ? `${det.block_id} · ${labelName}` : labelName,
        device_id: t.device_id,
        consumption: t.total_l,
      };
    });

    return {
      consumers: details.length,
      secretaries: secretaryCount,
      locations: locationsRes.count ?? 0,
      mainMeter: {
        available: mainInSet && (!!mainLatest || mainHistory.length > 0),
        todaysUsageL: Math.round(todaysUsageKl * 1000),
        thisMonthL: Math.round(monthFull * 1000),
        totalUsageL: Math.round(totalUsageKl * 1000),
        lastReadingAt: mainLatest?.reading_datetime ?? latestMainHistory?.reading_date ?? null,
      },
      flowRate,
      totalConsumptionL,
      trend,
      leaders,
    };
  });