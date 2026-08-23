import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomInt } from "crypto";

const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone");
const roleSchema = z.enum(["admin", "secretary", "consumer"]);

function hashCode(code: string, phone: string) {
  return createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

function genCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// ---- SMS provider: txtguru (DLT registered) ----
// Values can be overridden with env/secrets; defaults let it work out of the box.
// NOTE: move these to Supabase secrets when convenient (SMS_* env vars below).
const TXTGURU = {
  base: "https://www.txtguru.in/imobile/api.php",
  username: process.env.SMS_USERNAME || "senseflowinstruments1",
  password: process.env.SMS_PASSWORD || "Sense2026",
  source: process.env.SMS_SOURCE || "SENSFW",
  dltEntityId: process.env.SMS_DLT_ENTITY_ID || "1701178118345882032",
  dltHeaderId: process.env.SMS_DLT_HEADER_ID || "SENSFW",
  dltTemplateId: process.env.SMS_DLT_TEMPLATE_ID || "1707178402334602849",
};

// Must match the registered DLT template exactly (two variables: name, otp).
function buildOtpMessage(name: string, otp: string) {
  const who = (name || "Customer").trim() || "Customer";
  return `Dear ${who}, Your OTP for verification is ${otp}. Do not share this OTP with anyone. SENSEFLOW INSTRUMENTS PRIVATE LIMITED`;
}

function buildSmsUrl(phone: string, message: string) {
  const digits = phone.replace(/\D/g, ""); // txtguru dmobile expects digits (e.g. 9188...)
  const p = new URLSearchParams({
    username: TXTGURU.username,
    password: TXTGURU.password,
    source: TXTGURU.source,
    dmobile: digits,
    dltentityid: TXTGURU.dltEntityId,
    dltheaderid: TXTGURU.dltHeaderId,
    dlttempid: TXTGURU.dltTemplateId,
    message,
  });
  return `${TXTGURU.base}?${p.toString()}`;
}

async function sendOtpSms(phone: string, name: string, code: string) {
  const message = buildOtpMessage(name, code);
  const url = buildSmsUrl(phone, message);
  const redacted = url.replace(/(password=)[^&]+/, "$1***");
  const startedAt = Date.now();
  console.log("[sms:server] sending", { url: redacted });
  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch (err) {
    console.error("[sms:server] network error", { error: err instanceof Error ? err.message : String(err) });
    throw new Error("Failed to send OTP. Please try again.");
  }
  const body = await res.text().catch(() => "");
  console.log("[sms:server] response", { status: res.status, ok: res.ok, durationMs: Date.now() - startedAt, body: body.slice(0, 300) });
  if (!res.ok) throw new Error(`SMS provider returned ${res.status}`);
  // txtguru returns a plain-text id on success; surface clear failure strings.
  const low = body.toLowerCase();
  if (low.includes("invalid") || low.includes("error") || low.includes("insufficient") || low.includes("fail")) {
    throw new Error(body.trim() || "SMS provider rejected the request.");
  }
  return { smsResponseRaw: body };
}

// Look up a profile by EITHER the primary or the secondary phone number.
// Falls back to primary-only if the phone_secondary column hasn't been migrated
// yet, so login keeps working before the migration is applied.
async function findProfileByPhone(supabaseAdmin: any, phone: string) {
  let res = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, phone, phone_secondary, is_active")
    .or(`phone.eq.${phone},phone_secondary.eq.${phone}`)
    .limit(1)
    .maybeSingle();
  if (res.error && /phone_secondary/i.test(res.error.message || "")) {
    res = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone, is_active")
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();
  }
  if (res.error) throw new Error(res.error.message);
  return res.data as
    | { id: string; full_name: string | null; phone: string | null; phone_secondary?: string | null; is_active: boolean | null }
    | null;
}

// ==================== LOGIN OTP ====================

export const requestLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((data: { phone: string; role: string }) => ({
    phone: phoneSchema.parse(data.phone),
    role: roleSchema.parse(data.role),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const profile = await findProfileByPhone(supabaseAdmin, data.phone);
    if (!profile) {
      throw new Error("No account for this number. Ask your admin to add you.");
    }
    if (profile.is_active === false) {
      throw new Error("Account is inactive. Contact your admin.");
    }

    const { data: roleRow, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.id)
      .eq("role", data.role)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!roleRow) throw new Error(`This number has no ${data.role} access.`);

    const code = genCode();
    const codeHash = hashCode(code, data.phone);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await supabaseAdmin.from("otp_codes").delete().eq("phone", data.phone);
    const { error: insErr } = await supabaseAdmin.from("otp_codes").insert({
      phone: data.phone,
      code_hash: codeHash,
      expires_at: expiresAt,
      role: data.role,
    });
    if (insErr) throw new Error(insErr.message);

    const { smsResponseRaw } = await sendOtpSms(data.phone, profile.full_name || "", code);
    return { ok: true, smsResponseRaw };
  });

export const verifyLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((data: { phone: string; code: string; role: string }) => ({
    phone: phoneSchema.parse(data.phone),
    code: z.string().trim().regex(/^\d{6}$/, "Invalid code").parse(data.code),
    role: roleSchema.parse(data.role),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("otp_codes")
      .select("id, code_hash, attempts, expires_at, role")
      .eq("phone", data.phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("No OTP found. Request a new code.");
    if (row.role !== data.role) throw new Error("OTP was issued for a different role. Request a new code.");
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await supabaseAdmin.from("otp_codes").delete().eq("id", row.id);
      throw new Error("OTP expired. Request a new code.");
    }
    if (row.attempts >= 5) {
      await supabaseAdmin.from("otp_codes").delete().eq("id", row.id);
      throw new Error("Too many attempts. Request a new code.");
    }

    const expected = hashCode(data.code, data.phone);
    if (expected !== row.code_hash) {
      await supabaseAdmin.from("otp_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      throw new Error("Incorrect code.");
    }

    const profile = await findProfileByPhone(supabaseAdmin, data.phone);
    if (!profile) throw new Error("Account not found.");

    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", profile.id)
      .eq("role", data.role)
      .maybeSingle();
    if (!roleRow) throw new Error(`This number has no ${data.role} access.`);

    const { data: userLookup, error: uErr } = await supabaseAdmin.auth.admin.getUserById(profile.id);
    if (uErr || !userLookup?.user?.email) {
      throw new Error("Account is missing a login email. Contact your admin.");
    }
    const email = userLookup.user.email;

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      throw new Error(linkErr?.message || "Could not issue session.");
    }

    await supabaseAdmin.from("otp_codes").delete().eq("id", row.id);

    return { email, tokenHash: linkData.properties.hashed_token, role: data.role };
  });

// ==================== ADMIN SECURE NUMBER CHANGE ====================
// Changing an ADMIN account's number requires: OTP to the CURRENT number, then
// OTP to the NEW number. (Secretaries / consumers cannot change their own number
// — an admin edits it for them directly.)

const mask = (p: string) => (p.length > 4 ? `${p.slice(0, 3)}••••${p.slice(-3)}` : p);

// Step 1 — send an OTP to the account's current primary number.
export const adminStartNumberChange = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    userId: z.string().uuid(),
    newPhone: phoneSchema,
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile, error } = await supabaseAdmin
      .from("profiles").select("id, full_name, phone").eq("id", data.userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile?.phone) throw new Error("This account has no current number on file.");
    if (profile.phone === data.newPhone) throw new Error("New number is the same as the current number.");

    // New number must not already belong to another account.
    const existing = await findProfileByPhone(supabaseAdmin, data.newPhone);
    if (existing && existing.id !== data.userId) throw new Error("That number is already used by another account.");

    const code = genCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await (supabaseAdmin as any).from("phone_change_requests").delete().eq("user_id", data.userId);
    const { error: insErr } = await (supabaseAdmin as any).from("phone_change_requests").insert({
      user_id: data.userId,
      stage: "old",
      target_phone: profile.phone,
      new_phone: data.newPhone,
      code_hash: hashCode(code, profile.phone),
      expires_at: expiresAt,
    });
    if (insErr) throw new Error(insErr.message);

    await sendOtpSms(profile.phone, profile.full_name || "", code);
    return { ok: true, sentTo: mask(profile.phone) };
  });

// Step 2 — verify the OLD-number OTP, then send an OTP to the NEW number.
export const adminVerifyOldSendNew = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    userId: z.string().uuid(),
    code: z.string().trim().regex(/^\d{6}$/, "Invalid code"),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req } = await (supabaseAdmin as any)
      .from("phone_change_requests")
      .select("id, stage, target_phone, new_phone, code_hash, attempts, expires_at")
      .eq("user_id", data.userId).eq("stage", "old")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!req) throw new Error("Start the number change again.");
    if (new Date(req.expires_at).getTime() < Date.now()) {
      await (supabaseAdmin as any).from("phone_change_requests").delete().eq("id", req.id);
      throw new Error("OTP expired. Start again.");
    }
    if (req.attempts >= 5) {
      await (supabaseAdmin as any).from("phone_change_requests").delete().eq("id", req.id);
      throw new Error("Too many attempts. Start again.");
    }
    if (hashCode(data.code, req.target_phone) !== req.code_hash) {
      await (supabaseAdmin as any).from("phone_change_requests").update({ attempts: req.attempts + 1 }).eq("id", req.id);
      throw new Error("Incorrect code.");
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("full_name").eq("id", data.userId).maybeSingle();

    const code = genCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await (supabaseAdmin as any).from("phone_change_requests").delete().eq("user_id", data.userId);
    const { error: insErr } = await (supabaseAdmin as any).from("phone_change_requests").insert({
      user_id: data.userId,
      stage: "new",
      target_phone: req.new_phone,
      new_phone: req.new_phone,
      code_hash: hashCode(code, req.new_phone),
      expires_at: expiresAt,
    });
    if (insErr) throw new Error(insErr.message);

    await sendOtpSms(req.new_phone, profile?.full_name || "", code);
    return { ok: true, sentTo: mask(req.new_phone) };
  });

// Step 3 — verify the NEW-number OTP and set it as the account's primary number.
export const adminConfirmNewNumber = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    userId: z.string().uuid(),
    code: z.string().trim().regex(/^\d{6}$/, "Invalid code"),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: req } = await (supabaseAdmin as any)
      .from("phone_change_requests")
      .select("id, target_phone, new_phone, code_hash, attempts, expires_at")
      .eq("user_id", data.userId).eq("stage", "new")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!req) throw new Error("Start the number change again.");
    if (new Date(req.expires_at).getTime() < Date.now()) {
      await (supabaseAdmin as any).from("phone_change_requests").delete().eq("id", req.id);
      throw new Error("OTP expired. Start again.");
    }
    if (req.attempts >= 5) {
      await (supabaseAdmin as any).from("phone_change_requests").delete().eq("id", req.id);
      throw new Error("Too many attempts. Start again.");
    }
    if (hashCode(data.code, req.target_phone) !== req.code_hash) {
      await (supabaseAdmin as any).from("phone_change_requests").update({ attempts: req.attempts + 1 }).eq("id", req.id);
      throw new Error("Incorrect code.");
    }

    const newPhone = req.new_phone as string;
    const existing = await findProfileByPhone(supabaseAdmin, newPhone);
    if (existing && existing.id !== data.userId) throw new Error("That number is already used by another account.");

    const { error: upErr } = await supabaseAdmin
      .from("profiles").update({ phone: newPhone }).eq("id", data.userId);
    if (upErr) throw new Error(upErr.message);

    await (supabaseAdmin as any).from("phone_change_requests").delete().eq("user_id", data.userId);
    return { ok: true, phone: newPhone };
  });
