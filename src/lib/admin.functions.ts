import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const roleSchema = z.enum(["admin", "secretary", "consumer"]);
const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone (use +<country><number>)");
const optionalPhone = phoneSchema.optional().or(z.literal("").transform(() => undefined));
const optionalEmail = z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined));

// Auth is temporarily disabled.

// Ensure a phone number isn't already used by a DIFFERENT account (checks both
// the primary and the secondary number columns). Falls back to primary-only if
// the phone_secondary column hasn't been migrated yet.
async function assertPhoneFree(supabaseAdmin: any, phone: string, exceptUserId?: string) {
  let res = await supabaseAdmin
    .from("profiles")
    .select("id")
    .or(`phone.eq.${phone},phone_secondary.eq.${phone}`);
  if (res.error && /phone_secondary/i.test(res.error.message || "")) {
    res = await supabaseAdmin.from("profiles").select("id").eq("phone", phone);
  }
  const clash = (res.data || []).some((r: any) => r.id !== exceptUserId);
  if (clash) throw new Error(`Phone ${phone} is already used by another account.`);
}

// Update a profile, retrying without phone_secondary if that column isn't
// migrated yet (so single-number accounts still save before the migration).
async function updateProfileTolerant(supabaseAdmin: any, id: string, patch: Record<string, unknown>) {
  let res = await supabaseAdmin.from("profiles").update(patch).eq("id", id);
  if (res.error && /phone_secondary/i.test(res.error.message || "") && "phone_secondary" in patch) {
    const { phone_secondary, ...rest } = patch;
    res = await supabaseAdmin.from("profiles").update(rest).eq("id", id);
  }
  if (res.error) throw new Error(res.error.message);
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

    await updateProfileTolerant(supabaseAdmin, newId, {
      full_name: data.fullName,
      phone: data.phone,
      phone_secondary: data.phoneSecondary ?? null,
      email: data.email ?? null,
    });

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

    let curRes = await supabaseAdmin
      .from("profiles").select("phone, phone_secondary").eq("id", data.userId).maybeSingle();
    if (curRes.error && /phone_secondary/i.test(curRes.error.message || "")) {
      curRes = await supabaseAdmin.from("profiles").select("phone").eq("id", data.userId).maybeSingle();
    }
    if (curRes.error) throw new Error(curRes.error.message);
    const current = curRes.data;
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
      await updateProfileTolerant(supabaseAdmin, data.userId, patch);
    }

    if (data.roles) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
      const rows = data.roles.map((role) => ({ user_id: data.userId, role }));
      const { error } = await supabaseAdmin.from("user_roles").insert(rows);
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

export const getAdminUsersList = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Ensure primary admin account exists
    const adminPhone = "+918780488532";
    let { data: adminProf } = await supabaseAdmin.from("profiles").select("id").eq("phone", adminPhone).maybeSingle();
    let adminId = adminProf?.id;

    if (!adminId) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers().catch(() => ({ data: { users: [] } }));
      const found = (list?.users || []).find((u: any) => u.phone === "918780488532" || (u.phone && u.phone.endsWith("8780488532")) || u.email?.includes("8780488532"));
      if (found?.id) {
        adminId = found.id;
      } else {
        const { data: created } = await supabaseAdmin.auth.admin.createUser({
          email: "admin+918780488532@sensorflow.local",
          phone: "918780488532",
          email_confirm: true,
          phone_confirm: true,
          user_metadata: { full_name: "Admin" },
        }).catch(() => ({ data: null }));
        if (created?.user?.id) adminId = created.user.id;
      }
    }

    if (adminId) {
      await supabaseAdmin.from("profiles").upsert({
        id: adminId,
        full_name: "Admin",
        phone: adminPhone,
        is_active: true,
      }, { onConflict: "id" });

      await supabaseAdmin.from("user_roles").upsert({
        user_id: adminId,
        role: "admin",
      }, { onConflict: "user_id, role" });
    }

    // 2. Fetch profiles
    let res = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone, phone_secondary, email, is_active, created_at")
      .order("created_at", { ascending: false });
    if (res.error && /phone_secondary/i.test(res.error.message || "")) {
      res = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, phone, email, is_active, created_at")
        .order("created_at", { ascending: false });
    }
    const profiles = res.data || [];
    const ids = profiles.map((p: any) => p.id);

    const { data: roles } = ids.length
      ? await supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids)
      : { data: [] };

    const roleMap = new Map<string, { role: string }[]>();
    (roles || []).forEach((r: any) => {
      const arr = roleMap.get(r.user_id) || [];
      arr.push({ role: r.role });
      roleMap.set(r.user_id, arr);
    });

    return profiles.map((p: any) => ({
      ...p,
      user_roles: roleMap.get(p.id) || [],
    }));
  });
