import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type AppSetting = {
  key: string;
  value: string | null;
  description: string | null;
  is_secret: boolean;
  updated_at: string;
};

// ─────────────────────────────────────────────
// getAppSettings — admin: read all settings
// ─────────────────────────────────────────────
export const getAppSettings = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("key, value, description, is_secret, updated_at")
      .order("key");
    if (error) throw new Error(error.message);
    return (data || []) as AppSetting[];
  });

// ─────────────────────────────────────────────
// upsertAppSettings — admin: save one or many settings
// ─────────────────────────────────────────────
const upsertInput = z.object({
  settings: z.array(
    z.object({
      key: z.string().min(1).max(100),
      value: z.string().max(2000),
    }),
  ),
});

export const upsertAppSettings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => upsertInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const rows = data.settings.map((s) => ({
      key: s.key,
      value: s.value,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert(rows, { onConflict: "key" });

    if (error) throw new Error(error.message);
    return { ok: true, count: rows.length };
  });

// ─────────────────────────────────────────────
// getSettingByKey — internal helper used by server functions
// Reads a single setting value; returns null if not set
// ─────────────────────────────────────────────
export async function getSettingByKey(key: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value || null;
}

// ─────────────────────────────────────────────
// testRazorpayConnection — admin: validates keys by hitting Razorpay API
// ─────────────────────────────────────────────
export const testRazorpayConnection = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin
      .from("app_settings")
      .select("key, value")
      .in("key", ["razorpay_key_id", "razorpay_key_secret"]);

    const settingsMap = new Map((rows || []).map((r: any) => [r.key, r.value]));
    const keyId =
      settingsMap.get("razorpay_key_id") || process.env.RAZORPAY_KEY_ID || "";
    const keySecret =
      settingsMap.get("razorpay_key_secret") || process.env.RAZORPAY_KEY_SECRET || "";

    if (!keyId || !keySecret) {
      return { ok: false, error: "Keys not configured." };
    }

    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
      // Use the lightweight /payments endpoint with limit=1 to just verify auth
      const res = await fetch("https://api.razorpay.com/v1/payments?count=1", {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (res.status === 401) return { ok: false, error: "Invalid credentials — check Key ID and Secret." };
      if (!res.ok) return { ok: false, error: `Razorpay responded with ${res.status}.` };
      const isLive = keyId.startsWith("rzp_live_");
      return { ok: true, mode: isLive ? "live" : "test" };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? "Network error." };
    }
  });
