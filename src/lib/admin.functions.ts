import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleSchema = z.enum(["admin", "secretary", "consumer"]);
const phoneSchema = z.string().trim().regex(/^\+\d{8,15}$/, "Invalid phone (use +<country><number>)");

const createUserInput = z.object({
  fullName: z.string().trim().min(1, "Name required").max(120),
  phone: phoneSchema,
  email: z.string().trim().email().max(255).optional().or(z.literal("").transform(() => undefined)),
  role: roleSchema,
});

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createUserInput.parse(data))
  .handler(async ({ data, context }) => {
    // Verify caller is admin via RLS-scoped client
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Phone must be unique
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

    // Trigger handle_new_user() populated profiles + user_roles with defaults; fix them up.
    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .update({ full_name: data.fullName, phone: data.phone, email: data.email ?? null })
      .eq("id", newId);
    if (upErr) throw new Error(upErr.message);

    // Overwrite role
    await supabaseAdmin.from("user_roles").delete().eq("user_id", newId);
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newId, role: data.role });
    if (rErr) throw new Error(rErr.message);

    return { id: newId };
  });