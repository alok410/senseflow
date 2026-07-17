import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone (use +<country><number>)");

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}

const createInput = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  locationId: z.string().uuid().optional().nullable(),
  meterId: z.string().trim().max(64).optional(),
  serialNumber: z.string().trim().max(64).optional(),
  deviceId: z.string().trim().max(64).optional(),
  assignedSecretaryId: z.string().uuid().optional().nullable(),
});

export const createConsumer = createServerFn({ method: "POST" })
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
    await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "consumer" });

    // consumer_details: upsert (trigger may or may not have created a row)
    await supabaseAdmin.from("consumer_details").upsert({
      user_id: uid,
      meter_id: data.meterId ?? null,
      serial_number: data.serialNumber ?? null,
      device_id: data.deviceId ?? null,
      location_id: data.locationId ?? null,
      assigned_secretary_id: data.assignedSecretaryId ?? null,
      connection_date: new Date().toISOString().slice(0, 10),
    }, { onConflict: "user_id" });

    return { id: uid };
  });

const updateInput = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: phoneSchema.optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  is_active: z.boolean().optional(),
  locationId: z.string().uuid().optional().nullable(),
  meterId: z.string().trim().max(64).optional().nullable(),
  serialNumber: z.string().trim().max(64).optional().nullable(),
  deviceId: z.string().trim().max(64).optional().nullable(),
  assignedSecretaryId: z.string().uuid().optional().nullable(),
});

export const updateConsumer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const p: Record<string, unknown> = {};
    if (data.fullName !== undefined) p.full_name = data.fullName;
    if (data.phone !== undefined) p.phone = data.phone;
    if (data.email !== undefined) p.email = data.email ?? null;
    if (data.is_active !== undefined) p.is_active = data.is_active;
    if (Object.keys(p).length) {
      const { error } = await supabaseAdmin.from("profiles").update(p as any).eq("id", data.userId);
      if (error) throw new Error(error.message);
    }

    const d: Record<string, unknown> = {};
    if (data.locationId !== undefined) d.location_id = data.locationId;
    if (data.meterId !== undefined) d.meter_id = data.meterId;
    if (data.serialNumber !== undefined) d.serial_number = data.serialNumber;
    if (data.deviceId !== undefined) d.device_id = data.deviceId;
    if (data.assignedSecretaryId !== undefined) d.assigned_secretary_id = data.assignedSecretaryId;
    if (Object.keys(d).length) {
      const { error } = await supabaseAdmin.from("consumer_details")
        .upsert({ user_id: data.userId, ...d } as any, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deactivateConsumer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("profiles")
      .update({ is_active: false }).eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });