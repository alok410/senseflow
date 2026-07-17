import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleSchema = z.enum(["admin", "secretary", "consumer"]);
const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone (use +<country><number>)");

const createUserInput = z.object({
  fullName: z.string().trim().min(1, "Name required").max(120),
  phone: phoneSchema,
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  roles: z.array(roleSchema).min(1, "Pick at least one role"),
});

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Forbidden");
}

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createUserInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: dup } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("phone", data.phone)
      .maybeSingle();
    if (dup) throw new Error("A user with this phone number already exists.");

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
      .update({ full_name: data.fullName, phone: data.phone, email: data.email ?? null })
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
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => setRolesInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    // Prevent self-lockout: if caller is editing themselves, keep admin.
    if (data.userId === context.userId && !data.roles.includes("admin")) {
      throw new Error("You cannot remove your own admin role.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const rows = data.roles.map((role) => ({ user_id: data.userId, role }));
    const { error } = await supabaseAdmin.from("user_roles").insert(rows);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
