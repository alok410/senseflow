import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SENSEFLOW_BASE_URL = "https://apps.samasth.io:8090";
const RESET_ENDPOINT = `${SENSEFLOW_BASE_URL}/api/senseflow/reset`;
const VALVE_ON_ENDPOINT = `${SENSEFLOW_BASE_URL}/api/senseflow/valve/on`;
const VALVE_OFF_ENDPOINT = `${SENSEFLOW_BASE_URL}/api/senseflow/valve/off`;

export type ValveStatus = "open" | "closed" | "unknown";

export interface DeviceStateRecord {
  deviceId: string;
  valveStatus: ValveStatus;
  lastAction?: "on" | "off" | "reset";
  lastActionAt?: string;
  lastActionReason?: string;
  lastResetAt?: string;
  lastActionBy?: string;
}

// Store in os.tmpdir() which is guaranteed to be writable in all environments (Linux, Lambda, Docker, Windows)
const STORAGE_FILE = path.join(os.tmpdir(), "senseflow_device_states.json");

// In-memory global store to guarantee fast access within node process
declare global {
  var __senseflow_device_states: Record<string, DeviceStateRecord> | undefined;
}
if (!globalThis.__senseflow_device_states) {
  globalThis.__senseflow_device_states = {};
}

function readStoredStates(): Record<string, DeviceStateRecord> {
  if (globalThis.__senseflow_device_states && Object.keys(globalThis.__senseflow_device_states).length > 0) {
    return { ...globalThis.__senseflow_device_states };
  }
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const content = fs.readFileSync(STORAGE_FILE, "utf-8");
      const parsed = JSON.parse(content || "{}");
      globalThis.__senseflow_device_states = { ...parsed };
      return parsed;
    }
  } catch (err) {
    console.warn("Could not read from tmp device states:", err);
  }
  return {};
}

function saveStoredState(record: DeviceStateRecord): void {
  if (!globalThis.__senseflow_device_states) {
    globalThis.__senseflow_device_states = {};
  }
  globalThis.__senseflow_device_states[record.deviceId] = {
    ...(globalThis.__senseflow_device_states[record.deviceId] || {}),
    ...record,
  };
  try {
    fs.writeFileSync(
      STORAGE_FILE,
      JSON.stringify(globalThis.__senseflow_device_states, null, 2),
      "utf-8"
    );
  } catch (err) {
    // Ignore tmp write issues in read-only setups
  }
}

/**
 * Reset a SenseFlow device (clears fault state / restarts device logic)
 */
export const resetDevice = createServerFn({ method: "POST" })
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          deviceId: z.string().min(1, "Device ID is required"),
          consumerId: z.string().uuid().optional(),
          reason: z.string().optional(),
        })
        .parse(d)
  )
  .handler(async ({ data }) => {
    const token = process.env.SENSEFLOW_API_TOKEN;
    if (!token) {
      throw new Error("SENSEFLOW_API_TOKEN not configured in .env");
    }

    const payload = { Device_Name: data.deviceId.trim() };

    let resp: Response;
    try {
      resp = await fetch(RESET_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (fetchErr: any) {
      throw new Error(`Failed to reach SenseFlow API: ${fetchErr?.message || String(fetchErr)}`);
    }

    const text = await resp.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      // not json
    }

    if (!resp.ok) {
      const errMsg = body?.message || body?.error || text || `HTTP ${resp.status}`;
      throw new Error(`Device Reset failed (${resp.status}): ${errMsg}`);
    }

    // Persist reset timestamp
    const now = new Date().toISOString();
    const existing = readStoredStates()[data.deviceId];
    saveStoredState({
      deviceId: data.deviceId,
      valveStatus: existing?.valveStatus || "open", // reset doesn't change valve position
      lastAction: "reset",
      lastActionAt: now,
      lastResetAt: now,
      lastActionReason: data.reason || "Device reset requested",
    });

    return {
      success: true,
      deviceId: data.deviceId,
      message: body?.message || "Device reset command sent successfully",
      status: body?.status || "success",
    };
  });

/**
 * Control valve (turn ON or OFF)
 */
export const setDeviceValveState = createServerFn({ method: "POST" })
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          deviceId: z.string().min(1, "Device ID is required"),
          action: z.enum(["on", "off"]),
          consumerId: z.string().uuid().optional(),
          reason: z.string().optional(),
          actionBy: z.string().optional(),
        })
        .parse(d)
  )
  .handler(async ({ data }) => {
    const token = process.env.SENSEFLOW_API_TOKEN;
    if (!token) {
      throw new Error("SENSEFLOW_API_TOKEN not configured in .env");
    }

    const endpoint = data.action === "on" ? VALVE_ON_ENDPOINT : VALVE_OFF_ENDPOINT;
    const payload = { Device_Name: data.deviceId.trim() };

    let resp: Response;
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (fetchErr: any) {
      throw new Error(`Failed to reach SenseFlow API: ${fetchErr?.message || String(fetchErr)}`);
    }

    const text = await resp.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      // not json
    }

    if (!resp.ok) {
      const errMsg = body?.message || body?.error || text || `HTTP ${resp.status}`;
      throw new Error(`Valve control failed (${resp.status}): ${errMsg}`);
    }

    const newStatus: ValveStatus = data.action === "on" ? "open" : "closed";
    const now = new Date().toISOString();

    // 1. Save in-memory and in tmp storage
    saveStoredState({
      deviceId: data.deviceId,
      valveStatus: newStatus,
      lastAction: data.action,
      lastActionAt: now,
      lastActionReason: data.reason || (data.action === "on" ? "Valve opened" : "Valve closed"),
      lastActionBy: data.actionBy || "Admin/Secretary",
    });

    // 2. Persist audit trail in Supabase meter_readings if possible
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      let cid = data.consumerId;
      if (!cid) {
        const { data: cDetail } = await supabaseAdmin
          .from("consumer_details")
          .select("user_id")
          .eq("device_id", data.deviceId)
          .limit(1)
          .maybeSingle();
        cid = cDetail?.user_id;
      }
      if (cid) {
        await supabaseAdmin.from("meter_readings").insert({
          consumer_id: cid,
          meter_id: data.deviceId,
          reading: 0,
          previous_reading: 0,
          consumption: 0,
          reading_date: now,
          source: "manual",
          notes: `VALVE:${data.action}|REASON:${data.reason || ""}|TIME:${now}`,
        });
      }
    } catch (dbErr) {
      // Non-blocking log failure
      console.warn("Could not log valve change to Supabase:", dbErr);
    }

    return {
      success: true,
      deviceId: data.deviceId,
      valveStatus: newStatus,
      message: body?.message || (data.action === "on" ? "Valve turned ON" : "Valve turned OFF"),
      status: body?.status || "success",
    };
  });

/**
 * Get device states for a list of devices (or all stored devices)
 */
export const getDeviceStates = createServerFn({ method: "POST" })
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          deviceIds: z.array(z.string()).optional(),
        })
        .parse(d)
  )
  .handler(async ({ data }) => {
    const all = readStoredStates();

    // Query Supabase meter_readings for any persisted valve states
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: valveLogs } = await supabaseAdmin
        .from("meter_readings")
        .select("meter_id, notes, reading_date")
        .ilike("notes", "VALVE:%")
        .order("reading_date", { ascending: false })
        .limit(150);

      if (valveLogs && valveLogs.length > 0) {
        for (const log of valveLogs) {
          const dev = log.meter_id;
          if (dev && !all[dev]) {
            const isOff = log.notes?.startsWith("VALVE:off");
            const reason = log.notes?.split("|REASON:")[1]?.split("|TIME:")[0] || "";
            all[dev] = {
              deviceId: dev,
              valveStatus: isOff ? "closed" : "open",
              lastAction: isOff ? "off" : "on",
              lastActionAt: log.reading_date,
              lastActionReason: reason,
            };
            saveStoredState(all[dev]);
          }
        }
      }
    } catch (dbErr) {
      // ignore
    }

    if (!data.deviceIds || data.deviceIds.length === 0) {
      return all;
    }

    const result: Record<string, DeviceStateRecord> = {};
    for (const id of data.deviceIds) {
      if (all[id]) {
        result[id] = all[id];
      } else {
        result[id] = {
          deviceId: id,
          valveStatus: "open",
        };
      }
    }
    return result;
  });

/**
 * Batch toggle valves for multiple devices
 */
export const batchSetDeviceValveState = createServerFn({ method: "POST" })
  .inputValidator(
    (d: unknown) =>
      z
        .object({
          deviceIds: z.array(z.string().min(1)).min(1, "At least one device required"),
          action: z.enum(["on", "off"]),
          reason: z.string().optional(),
          actionBy: z.string().optional(),
        })
        .parse(d)
  )
  .handler(async ({ data }) => {
    const token = process.env.SENSEFLOW_API_TOKEN;
    if (!token) {
      throw new Error("SENSEFLOW_API_TOKEN not configured in .env");
    }

    const endpoint = data.action === "on" ? VALVE_ON_ENDPOINT : VALVE_OFF_ENDPOINT;
    const succeeded: string[] = [];
    const failed: Array<{ deviceId: string; error: string }> = [];
    const newStatus: ValveStatus = data.action === "on" ? "open" : "closed";
    const now = new Date().toISOString();

    for (const id of data.deviceIds) {
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ Device_Name: id.trim() }),
        });
        if (resp.ok) {
          succeeded.push(id);
          saveStoredState({
            deviceId: id,
            valveStatus: newStatus,
            lastAction: data.action,
            lastActionAt: now,
            lastActionReason: data.reason || `Batch ${data.action.toUpperCase()}`,
            lastActionBy: data.actionBy || "Admin/Secretary",
          });
        } else {
          const txt = await resp.text();
          failed.push({ deviceId: id, error: `HTTP ${resp.status}: ${txt.slice(0, 100)}` });
        }
      } catch (err: any) {
        failed.push({ deviceId: id, error: err?.message || String(err) });
      }
    }

    return {
      success: failed.length === 0,
      action: data.action,
      succeeded,
      failed,
      total: data.deviceIds.length,
    };
  });
