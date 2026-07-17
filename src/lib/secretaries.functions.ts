import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone (use +<country><number>)");

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId, _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

const createInput = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  locationId: z.string().uuid().nullable().optional(),
});

export const createSecretary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: dup } = await supabaseAdmin
      .from("profiles").select("id").eq("phone", data.phone).maybeSingle();
    if (dup) throw new Error("A user with this phone number already exists.");

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
    if (createErr || !created?.user) throw new Error(createErr?.message || "Failed to create user");
    const uid = created.user.id;

    await supabaseAdmin.from("profiles")
      .update({ full_name: data.fullName, phone: data.phone, email: data.email ?? null })
      .eq("id", uid);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "secretary" });
    if (data.locationId) {
      await supabaseAdmin.from("secretary_locations")
        .insert({ secretary_id: uid, location_id: data.locationId });
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("secretary_locations").delete().eq("secretary_id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).eq("role", "secretary");
    await supabaseAdmin.from("profiles").update({ is_active: false }).eq("id", data.userId);
    return { ok: true };
  });