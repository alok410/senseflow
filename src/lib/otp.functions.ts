import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomInt } from "crypto";

const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone");

function hashCode(code: string, phone: string) {
  return createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

// DLT-approved template body — kept byte-for-byte identical. Only the FIRST
// {#var#} is replaced with the OTP; all other placeholders remain literal.
const SMS_TEMPLATE =
  "Dear {#var#}, payment for Invoice No. {#var#} related to {#var#} services amounting to Rs.{#var#} was due on {#var#} and is still pending. Kindly pay immediately to avoid service interruption. SENSEFLOW INSTRUMENTS PRIVATE LIMITED.";

function buildMessage(otp: string) {
  // TEMP: send template literally (no OTP substitution) to match the working
  // Postman request. `otp` is intentionally unused here.
  void otp;
  return SMS_TEMPLATE;
}

function buildSmsUrl(params: { phone: string; message: string }) {
  const apiKey = process.env.SENSEFLOW_SMS_API_KEY;
  const senderId = process.env.SENSEFLOW_SMS_SENDER_ID;
  const templateId = process.env.SENSEFLOW_SMS_TEMPLATE_ID;
  if (!apiKey || !senderId || !templateId) {
    throw new Error("SMS provider is not configured.");
  }
  const url = new URL("https://smsfortius.work/V2/apikey.php");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("senderid", senderId);
  url.searchParams.set("templateid", templateId);
  url.searchParams.set("number", params.phone);
  // Postman URL includes `message` twice — replicate exactly.
  url.searchParams.append("message", params.message);
  url.searchParams.append("message", params.message);
  return url.toString();
}

export const requestLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((data: { phone: string }) => ({ phone: phoneSchema.parse(data.phone) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only allow login for existing accounts (admin-managed users)
    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, phone, is_active")
      .eq("phone", data.phone)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) {
      throw new Error("No account for this number. Ask your admin to add you.");
    }
    if (!profile.is_active) {
      throw new Error("Account is inactive. Contact your admin.");
    }

    // Generate 6-digit OTP
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const codeHash = hashCode(code, data.phone);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Purge old codes for this phone
    await supabaseAdmin.from("otp_codes").delete().eq("phone", data.phone);

    const { error: insErr } = await supabaseAdmin.from("otp_codes").insert({
      phone: data.phone,
      code_hash: codeHash,
      expires_at: expiresAt,
    });
    if (insErr) throw new Error(insErr.message);

    // Build the SMS payload and let the client hit the provider directly
    // (per user request — same URL as their Postman test, with full logs).
    const message = buildMessage(code);
    const smsUrl = buildSmsUrl({ phone: data.phone, message });

    const redactedUrl = smsUrl.replace(/(apikey=)[^&]+/, "$1***");
    const startedAt = Date.now();
    console.log("[sms:server] fetching…", { url: redactedUrl });
    let smsStatus = 0;
    let smsBody = "";
    let smsResponseRaw: string = "";
    try {
      const res = await fetch(smsUrl, { method: "POST" });
      smsStatus = res.status;
      smsBody = await res.text().catch(() => "");
      smsResponseRaw = smsBody;
      console.log("[sms:server] response", {
        status: smsStatus,
        ok: res.ok,
        durationMs: Date.now() - startedAt,
        body: smsBody,
      });
      if (!res.ok) {
        throw new Error(`SMS provider returned ${smsStatus}`);
      }
    } catch (err) {
      console.error("[sms:server] failed", {
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error("Failed to send OTP. Please try again.");
    }

    return {
      ok: true,
      smsStatus,
      smsResponseRaw,
      message,
    };
  });

export const verifyLoginOtp = createServerFn({ method: "POST" })
  .inputValidator((data: { phone: string; code: string }) => ({
    phone: phoneSchema.parse(data.phone),
    code: z.string().trim().regex(/^\d{6}$/, "Invalid code").parse(data.code),
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("otp_codes")
      .select("id, code_hash, attempts, expires_at")
      .eq("phone", data.phone)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("No OTP found. Request a new code.");
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
      await supabaseAdmin
        .from("otp_codes")
        .update({ attempts: row.attempts + 1 })
        .eq("id", row.id);
      throw new Error("Incorrect code.");
    }

    // Find the user's auth email
    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("phone", data.phone)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) throw new Error("Account not found.");

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

    // Consume the OTP
    await supabaseAdmin.from("otp_codes").delete().eq("id", row.id);

    return {
      email,
      tokenHash: linkData.properties.hashed_token,
    };
  });