import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Auth is temporarily disabled — server functions run without a signed-in user.

const createInput = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  is_active: z.boolean().optional().default(true),
});

export const createLocation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: dup } = await supabaseAdmin
      .from("locations").select("id").eq("code", data.code).maybeSingle();
    if (dup) throw new Error("Location with this code already exists.");
    const { data: row, error } = await supabaseAdmin
      .from("locations")
      .insert({ code: data.code, name: data.name, is_active: data.is_active })
      .select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });

const updateInput = z.object({
  id: z.string().uuid(),
  code: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
});

export const updateLocation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...rest } = data;
    const { error } = await supabaseAdmin.from("locations").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLocation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("locations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });