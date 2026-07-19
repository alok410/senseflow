import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Search } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const NONE = "__none__";
const ALL = "__all__";

function AdminSecretaries() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<{ fullName: string; phone: string; email: string; locationId: string }>(
    { fullName: "", phone: "", email: "", locationId: NONE },
  );
  const [editLoc, setEditLoc] = useState<string>(NONE);
  const [search, setSearch] = useState("");
  const [filterLoc, setFilterLoc] = useState<string>(ALL);

  const locs = useQuery({
    queryKey: ["all-locations"],
    queryFn: async () => (await supabase.from("locations").select("id, name, code").order("name")).data || [],
  });
  const locName = useMemo(() => {
    const m = new Map<string, string>();
    (locs.data || []).forEach((l) => m.set(l.id, `${l.name} (${l.code})`));
    return m;
  }, [locs.data]);

  const list = useQuery({
    queryKey: ["admin-secretaries"],
    queryFn: async () => {
      const { data: roles, error: rolesError } = await supabase.from("user_roles").select("user_id").eq("role", "secretary");
      if (rolesError) throw rolesError;
      const ids = (roles || []).map((r) => r.user_id);
      if (!ids.length) return [] as Row[];
      const [{ data: profiles, error }, { data: secretaryLocations, error: locationError }] = await Promise.all([
        supabase
        .from("profiles")
        .select("id, full_name, phone, email, is_active, created_at")
        .in("id", ids)
        .order("created_at", { ascending: false }),
        supabase
          .from("secretary_locations")
          .select("secretary_id, location_id")
          .in("secretary_id", ids),
      ]);
      if (error) throw error;
      if (locationError) throw locationError;
      const locMap = new Map<string, { location_id: string }[]>();
      (secretaryLocations || []).forEach((sl) => {
        const list = locMap.get(sl.secretary_id) || [];
        list.push({ location_id: sl.location_id });
        locMap.set(sl.secretary_id, list);
      });
      return (profiles || []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        phone: p.phone,
        email: p.email,
        is_active: p.is_active,
        secretary_locations: locMap.get(p.id) || [],
      })) as Row[];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => createSecretary({ data: {
      fullName: form.fullName, phone: form.phone,
      email: form.email || undefined,
      locationId: form.locationId === NONE ? null : form.locationId,
    }}),
    onSuccess: () => {
      toast.success("Secretary created.");
      setOpen(false); setForm({ fullName: "", phone: "", email: "", locationId: NONE });
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
        locationId: editLoc === NONE ? null : editLoc,
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data || []).filter((s) => {
      const locId = s.secretary_locations?.[0]?.location_id ?? null;
      if (filterLoc !== ALL && locId !== filterLoc) return false;
      if (!q) return true;
      return (s.full_name || "").toLowerCase().includes(q)
        || (s.phone || "").toLowerCase().includes(q)
        || (s.email || "").toLowerCase().includes(q);
    });
  }, [list.data, search, filterLoc]);

  return (
    <DashboardLayout navItems={ADMIN_NAV} title="Secretaries" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, phone, email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterLoc} onValueChange={setFilterLoc}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All locations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All locations</SelectItem>
            <SelectItem value={NONE}>— Unassigned —</SelectItem>
            {(locs.data || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
          </SelectContent>
        </Select>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Add secretary</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create secretary</DialogTitle></DialogHeader>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}>
              <div className="space-y-2"><Label>Full name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Phone (+91…)</Label><Input value={form.phone} placeholder="+919876543210" onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Email (optional)</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Assigned location</Label>
                <Select value={form.locationId} onValueChange={(v) => setForm({ ...form, locationId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— None —</SelectItem>
                    {(locs.data || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
                  </SelectContent>
                </Select>
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
                <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((s) => {
                  const locId = s.secretary_locations?.[0]?.location_id ?? null;
                  return (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-medium">{s.full_name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.phone || s.email || "—"}</td>
                    <td className="px-4 py-3">{locId ? (locName.get(locId) || "—") : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3">{s.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(s); setEditLoc(locId ?? NONE); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove secretary role from ${s.full_name || s.phone}?`)) delMut.mutate(s.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                );
                })}
                {!filtered.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No secretaries found.</td></tr>}
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
                <Label>Assigned location</Label>
                <Select value={editLoc} onValueChange={setEditLoc}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— None —</SelectItem>
                    {(locs.data || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter><Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}