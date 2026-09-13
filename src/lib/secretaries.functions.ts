import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone (use +<country><number>)");

// Auth is temporarily disabled.

const createInput = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  locationId: z.string().uuid().nullable().optional(),
});

export const createSecretary = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Look up existing profile by phone (primary or secondary)
    let { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone, email")
      .or(`phone.eq.${data.phone},phone_secondary.eq.${data.phone}`)
      .limit(1)
      .maybeSingle();

    if (!existingProfile) {
      const { data: pSingle } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, phone, email")
        .eq("phone", data.phone)
        .limit(1)
        .maybeSingle();
      existingProfile = pSingle;
    }

    let uid: string;

    if (existingProfile) {
      uid = existingProfile.id;
      const patch: Record<string, unknown> = { is_active: true };
      if (data.fullName) patch.full_name = data.fullName;
      if (data.email) patch.email = data.email;
      await supabaseAdmin.from("profiles").update(patch as any).eq("id", uid);
    } else {
      const digits = data.phone.replace(/\D/g, "");
      const authEmail = data.email && data.email.length > 0
        ? data.email : `phone-${digits}@sensorflow.local`;

      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        phone: digits,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { full_name: data.fullName },
      });

      if (createErr || !created?.user) {
        const { data: list } = await supabaseAdmin.auth.admin.listUsers().catch(() => ({ data: { users: [] } }));
        const found = (list?.users || []).find(
          (u: any) => u.phone === digits || (u.phone && u.phone.endsWith(digits)) || u.email === authEmail
        );
        if (found) {
          uid = found.id;
        } else {
          throw new Error(createErr?.message || "Failed to create user");
        }
      } else {
        uid = created.user.id;
      }

      await supabaseAdmin.from("profiles").upsert({
        id: uid,
        full_name: data.fullName,
        phone: data.phone,
        email: data.email ?? null,
        is_active: true,
      }, { onConflict: "id" });
    }

    // Add secretary role without clearing existing roles
    await supabaseAdmin.from("user_roles").upsert(
      { user_id: uid, role: "secretary" },
      { onConflict: "user_id, role" }
    );

    if (data.locationId !== undefined) {
      await supabaseAdmin.from("secretary_locations").delete().eq("secretary_id", uid);
      if (data.locationId) {
        await supabaseAdmin.from("secretary_locations")
          .insert({ secretary_id: uid, location_id: data.locationId });
      }
    }
    return { id: uid };
  });

const updateInput = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  phone: phoneSchema.optional(),
  locationId: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

export const updateSecretary = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const patch: Record<string, unknown> = {};
    if (data.fullName !== undefined) patch.full_name = data.fullName;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.email !== undefined) patch.email = data.email ?? null;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from("profiles").update(patch as any).eq("id", data.userId);
      if (error) throw new Error(error.message);
    }
    if (data.locationId !== undefined) {
      await supabaseAdmin.from("secretary_locations").delete().eq("secretary_id", data.userId);
      if (data.locationId) {
        const { error } = await supabaseAdmin.from("secretary_locations")
          .insert({ secretary_id: data.userId, location_id: data.locationId });
        if (error) throw new Error(error.message);
      }
    }
    return { ok: true };
  });

export const deleteSecretary = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("secretary_locations").delete().eq("secretary_id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).eq("role", "secretary");

    // Only deactivate profile if no remaining roles exist
    const { data: remaining } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    if (!remaining || remaining.length === 0) {
      await supabaseAdmin.from("profiles").update({ is_active: false }).eq("id", data.userId);
    }
    return { ok: true };
  });

// ---- List all secretaries (uses supabaseAdmin to bypass RLS) ----

export const listSecretaries = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Get all user IDs that have the secretary role OR have a secretary_locations entry
  const [{ data: roles }, { data: secLocs }] = await Promise.all([
    supabaseAdmin.from("user_roles").select("user_id").eq("role", "secretary"),
    supabaseAdmin.from("secretary_locations").select("secretary_id"),
  ]);

  const ids = Array.from(new Set([
    ...(roles || []).map((r) => r.user_id),
    ...(secLocs || []).map((sl) => sl.secretary_id),
  ]));

  if (!ids.length) return [];

  const [{ data: profiles }, { data: secretaryLocations }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone, email, is_active, created_at")
      .in("id", ids)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("secretary_locations")
      .select("secretary_id, location_id")
      .in("secretary_id", ids),
  ]);

  const locMap = new Map<string, { location_id: string }[]>();
  (secretaryLocations || []).forEach((sl) => {
    const list = locMap.get(sl.secretary_id) || [];
    list.push({ location_id: sl.location_id });
    locMap.set(sl.secretary_id, list);
  });

  // Only return users who actually have the secretary role (not just secretary_locations orphans)
  const secretaryIdSet = new Set((roles || []).map((r) => r.user_id));
  return (profiles || [])
    .filter((p) => secretaryIdSet.has(p.id))
    .map((p) => ({
      id: p.id,
      full_name: p.full_name,
      phone: p.phone,
      email: p.email,
      is_active: p.is_active,
      secretary_locations: locMap.get(p.id) || [],
    }));
});