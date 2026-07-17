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
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { createLocation, updateLocation, deleteLocation } from "@/lib/locations.functions";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/locations")({
  component: AdminLocations,
});

type Loc = { id: string; code: string; name: string; is_active: boolean };

function AdminLocations() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Loc | null>(null);
  const [form, setForm] = useState({ code: "", name: "", is_active: true });

  const list = useQuery({
    queryKey: ["admin-locations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("locations").select("*").order("code");
      if (error) throw error;
      return data as Loc[];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => createLocation({ data: form }),
    onSuccess: () => {
      toast.success("Location created.");
      setOpen(false); setForm({ code: "", name: "", is_active: true });
      qc.invalidateQueries({ queryKey: ["admin-locations"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("");
      return updateLocation({ data: { id: editing.id, code: editing.code, name: editing.name, is_active: editing.is_active } });
    },
    onSuccess: () => {
      toast.success("Saved.");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin-locations"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => deleteLocation({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted.");
      qc.invalidateQueries({ queryKey: ["admin-locations"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <DashboardLayout navItems={ADMIN_NAV} title="Locations" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <div className="mb-4 flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Add location</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New location</DialogTitle><DialogDescription>Unique code identifies the location.</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}>
              <div className="space-y-2"><Label>Code</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="flex items-center gap-2"><Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /><Label>Active</Label></div>
              <DialogFooter><Button type="submit" disabled={createMut.isPending}>{createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(list.data || []).map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3 font-mono text-xs">{l.code}</td>
                  <td className="px-4 py-3 font-medium">{l.name}</td>
                  <td className="px-4 py-3">{l.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(l)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete ${l.name}?`)) delMut.mutate(l.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </td>
                </tr>
              ))}
              {!list.data?.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No locations yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit location</DialogTitle></DialogHeader>
          {editing && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); updateMut.mutate(); }}>
              <div className="space-y-2"><Label>Code</Label><Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></div>
              <div className="flex items-center gap-2"><Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} /><Label>Active</Label></div>
              <DialogFooter><Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}