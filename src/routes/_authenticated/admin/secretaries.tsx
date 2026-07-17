import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { createSecretary, updateSecretary, deleteSecretary } from "@/lib/secretaries.functions";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/secretaries")({
  component: AdminSecretaries,
});

type Row = {
  id: string; full_name: string | null; phone: string | null; email: string | null; is_active: boolean;
  secretary_locations: { location_id: string }[] | null;
};

function AdminSecretaries() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<{ fullName: string; phone: string; email: string; locationIds: string[] }>(
    { fullName: "", phone: "", email: "", locationIds: [] },
  );
  const [editLocs, setEditLocs] = useState<string[]>([]);

  const locs = useQuery({
    queryKey: ["all-locations"],
    queryFn: async () => (await supabase.from("locations").select("id, name, code").order("name")).data || [],
  });

  const list = useQuery({
    queryKey: ["admin-secretaries"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "secretary");
      const ids = (roles || []).map((r) => r.user_id);
      if (!ids.length) return [] as Row[];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, email, is_active, secretary_locations!secretary_locations_secretary_id_fkey(location_id)")
        .in("id", ids)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const createMut = useMutation({
    mutationFn: async () => createSecretary({ data: form }),
    onSuccess: () => {
      toast.success("Secretary created.");
      setOpen(false); setForm({ fullName: "", phone: "", email: "", locationIds: [] });
      qc.invalidateQueries({ queryKey: ["admin-secretaries"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("");
      return updateSecretary({ data: {
        userId: editing.id,
        fullName: editing.full_name ?? undefined,
        email: editing.email ?? undefined,
        phone: editing.phone ?? undefined,
        is_active: editing.is_active,
        locationIds: editLocs,
      }});
    },
    onSuccess: () => {
      toast.success("Saved.");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin-secretaries"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const delMut = useMutation({
    mutationFn: async (userId: string) => deleteSecretary({ data: { userId } }),
    onSuccess: () => {
      toast.success("Removed secretary role.");
      qc.invalidateQueries({ queryKey: ["admin-secretaries"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <DashboardLayout navItems={ADMIN_NAV} title="Secretaries" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <div className="mb-4 flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Add secretary</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create secretary</DialogTitle></DialogHeader>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}>
              <div className="space-y-2"><Label>Full name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Phone (+91…)</Label><Input value={form.phone} placeholder="+919876543210" onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Email (optional)</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Assigned locations</Label>
                <div className="max-h-40 space-y-2 overflow-auto rounded-md border p-3">
                  {(locs.data || []).map((l) => (
                    <label key={l.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={form.locationIds.includes(l.id)} onCheckedChange={() => setForm({ ...form, locationIds: toggle(form.locationIds, l.id) })} />
                      {l.name} <span className="text-xs text-muted-foreground">({l.code})</span>
                    </label>
                  ))}
                  {!locs.data?.length && <p className="text-xs text-muted-foreground">No locations yet.</p>}
                </div>
              </div>
              <DialogFooter><Button type="submit" disabled={createMut.isPending}>{createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Locations</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y">
                {(list.data || []).map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-medium">{s.full_name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.phone || s.email || "—"}</td>
                    <td className="px-4 py-3">{s.secretary_locations?.length ?? 0}</td>
                    <td className="px-4 py-3">{s.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(s); setEditLocs((s.secretary_locations || []).map((x) => x.location_id)); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove secretary role from ${s.full_name || s.phone}?`)) delMut.mutate(s.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                ))}
                {!list.data?.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No secretaries yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit secretary</DialogTitle></DialogHeader>
          {editing && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); updateMut.mutate(); }}>
              <div className="space-y-2"><Label>Full name</Label><Input value={editing.full_name || ""} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={editing.phone || ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={editing.email || ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Assigned locations</Label>
                <div className="max-h-40 space-y-2 overflow-auto rounded-md border p-3">
                  {(locs.data || []).map((l) => (
                    <label key={l.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={editLocs.includes(l.id)} onCheckedChange={() => setEditLocs(toggle(editLocs, l.id))} />
                      {l.name} <span className="text-xs text-muted-foreground">({l.code})</span>
                    </label>
                  ))}
                </div>
              </div>
              <DialogFooter><Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}