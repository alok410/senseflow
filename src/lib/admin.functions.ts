import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const roleSchema = z.enum(["admin", "secretary", "consumer"]);
const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone (use +<country><number>)");
const optionalPhone = phoneSchema.optional().or(z.literal("").transform(() => undefined));
const optionalEmail = z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined));

// Auth is temporarily disabled.

// Ensure a phone number isn't already used by a DIFFERENT account (checks both
// the primary and the secondary number columns).
async function assertPhoneFree(supabaseAdmin: any, phone: string, exceptUserId?: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .or(`phone.eq.${phone},phone_secondary.eq.${phone}`);
  const clash = (data || []).some((r: any) => r.id !== exceptUserId);
  if (clash) throw new Error(`Phone ${phone} is already used by another account.`);
}

const createUserInput = z.object({
  fullName: z.string().trim().min(1, "Name required").max(120),
  phone: phoneSchema,
  phoneSecondary: optionalPhone,
  email: optionalEmail,
  roles: z.array(roleSchema).min(1, "Pick at least one role"),
});

export const createUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createUserInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.phoneSecondary && data.phoneSecondary === data.phone) {
      throw new Error("Second number must be different from the primary number.");
    }
    await assertPhoneFree(supabaseAdmin, data.phone);
    if (data.phoneSecondary) await assertPhoneFree(supabaseAdmin, data.phoneSecondary);

    const digits = data.phone.replace(/\D/g, "");
    const authEmail = data.email && data.email.length > 0
      ? data.email
      : `phone-${digits}@sensorflow.local`;

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      phone: digits,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (createErr || !created?.user) throw new Error(createErr?.message || "Failed to create user");
    const newId = created.user.id;

    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .update({
        full_name: data.fullName,
        phone: data.phone,
        phone_secondary: data.phoneSecondary ?? null,
        email: data.email ?? null,
      })
      .eq("id", newId);
    if (upErr) throw new Error(upErr.message);

    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId);
    const rows = data.roles.map((role) => ({ user_id: newId, role }));
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert(rows);
    if (rErr) throw new Error(rErr.message);

    return { id: newId };
  });

const setRolesInput = z.object({
  userId: z.string().uuid(),
  roles: z.array(roleSchema).min(1, "Pick at least one role"),
});

export const setUserRoles = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => setRolesInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const rows = data.roles.map((role) => ({ user_id: data.userId, role }));
    const { error } = await supabaseAdmin.from("user_roles").insert(rows);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

// Edit an account: name, email, roles, secondary number, and (for non-admin
// accounts) the primary number directly. An ADMIN account's PRIMARY number must
// be changed through the OTP flow in otp.functions.ts, so callers should omit
// `phone` for admins and use adminStartNumberChange instead.
const updateUserInput = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120).optional(),
  email: optionalEmail,
  phone: optionalPhone,
  phoneSecondary: optionalPhone,
  clearSecondary: z.boolean().optional(),
  roles: z.array(roleSchema).min(1, "Pick at least one role").optional(),
});

export const updateUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateUserInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: current, error: curErr } = await supabaseAdmin
      .from("profiles").select("phone, phone_secondary").eq("id", data.userId).maybeSingle();
    if (curErr) throw new Error(curErr.message);
    if (!current) throw new Error("Account not found.");

    const nextPrimary = data.phone ?? current.phone;
    if (data.phone) await assertPhoneFree(supabaseAdmin, data.phone, data.userId);
    if (data.phoneSecondary) {
      if (data.phoneSecondary === nextPrimary) {
        throw new Error("Second number must be different from the primary number.");
      }
      await assertPhoneFree(supabaseAdmin, data.phoneSecondary, data.userId);
    }

    const patch: Record<string, unknown> = {};
    if (data.fullName !== undefined) patch.full_name = data.fullName;
    if (data.email !== undefined) patch.email = data.email ?? null;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.clearSecondary) patch.phone_secondary = null;
    else if (data.phoneSecondary !== undefined) patch.phone_secondary = data.phoneSecondary;

    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from("profiles").update(patch as any).eq("id", data.userId);
      if (error) throw new Error(error.message);
    }

    if (data.roles) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
      const rows = data.roles.map((role) => ({ user_id: data.userId, role }));
      const { error } = await supabaseAdmin.from("user_roles").insert(rows);
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });
