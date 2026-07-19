import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RefreshCw, Loader2, Search, ArrowUpDown, BarChart3, Sparkles } from "lucide-react";
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
import { createConsumer, updateConsumer, deleteConsumer, seedDemoConsumers } from "@/lib/consumers.functions";
import { fetchAndStoreLatestReading } from "@/lib/meter.functions";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/consumers")({
  component: AdminConsumers,
});

type Row = {
  id: string; full_name: string | null; phone: string | null; email: string | null; is_active: boolean;
  consumer_details: {
    meter_id: string | null; serial_number: string | null; device_id: string | null;
    block_id: string | null;
    location_id: string | null; assigned_secretary_id: string | null;
  } | null;
};

const NONE = "__none__";
const ALL = "__all__";
type SortKey = "name" | "phone" | "block" | "meter";

function AdminConsumers() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const initial = { fullName: "", phone: "", email: "", locationId: NONE, meterId: "", serialNumber: "", deviceId: "", blockId: "" };
  const [form, setForm] = useState(initial);
  const [search, setSearch] = useState("");
  const [filterLoc, setFilterLoc] = useState<string>(ALL);
  const [sortKey, setSortKey] = useState<SortKey>("block");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const locs = useQuery({
    queryKey: ["all-locations"],
    queryFn: async () => (await supabase.from("locations").select("id, name, code").order("name")).data || [],
  });

  const list = useQuery({
    queryKey: ["admin-consumers"],
    queryFn: async () => {
      const { data: roles, error: rolesError } = await supabase.from("user_roles").select("user_id").eq("role", "consumer");
      if (rolesError) throw rolesError;
      const ids = (roles || []).map((r) => r.user_id);
      if (!ids.length) return [] as Row[];
      const [{ data: profiles, error }, { data: details, error: detailsError }] = await Promise.all([
        supabase
        .from("profiles")
        .select("id, full_name, phone, email, is_active, created_at")
        .in("id", ids)
        .order("created_at", { ascending: false }),
        supabase
          .from("consumer_details")
          .select("user_id, meter_id, serial_number, device_id, block_id, location_id, assigned_secretary_id")
          .in("user_id", ids),
      ]);
      if (error) throw error;
      if (detailsError) throw detailsError;
      const detailMap = new Map((details || []).map((d) => [d.user_id, d]));
      return (profiles || []).map((p) => {
        const d = detailMap.get(p.id);
        return {
          id: p.id,
          full_name: p.full_name,
          phone: p.phone,
          email: p.email,
          is_active: p.is_active,
          consumer_details: d ? {
            meter_id: d.meter_id,
            serial_number: d.serial_number,
            device_id: d.device_id,
            block_id: d.block_id,
            location_id: d.location_id,
            assigned_secretary_id: d.assigned_secretary_id,
          } : null,
        };
      }) as Row[];
    },
  });

  const locName = useMemo(() => {
    const m = new Map<string, string>();
    (locs.data || []).forEach((l) => m.set(l.id, `${l.name} (${l.code})`));
    return m;
  }, [locs.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = (list.data || []).filter((c) => {
      if (filterLoc !== ALL && (c.consumer_details?.location_id ?? null) !== (filterLoc === NONE ? null : filterLoc)) return false;
      if (!q) return true;
      return (c.full_name || "").toLowerCase().includes(q)
        || (c.phone || "").toLowerCase().includes(q)
        || (c.email || "").toLowerCase().includes(q)
        || (c.consumer_details?.meter_id || "").toLowerCase().includes(q)
        || (c.consumer_details?.device_id || "").toLowerCase().includes(q)
        || (c.consumer_details?.block_id || "").toLowerCase().includes(q);
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (c: Row) => {
      switch (sortKey) {
        case "name": return (c.full_name || "").toLowerCase();
        case "phone": return c.phone || "";
        case "meter": return c.consumer_details?.meter_id || c.consumer_details?.device_id || "";
        case "block": return c.consumer_details?.block_id || "";
      }
    };
    rows = [...rows].sort((a, b) => val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0);
    return rows;
  }, [list.data, search, filterLoc, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
  };

  const createMut = useMutation({
    mutationFn: async () => createConsumer({ data: {
      fullName: form.fullName, phone: form.phone,
      email: form.email || undefined,
      locationId: form.locationId === NONE ? null : form.locationId,
      meterId: form.meterId || undefined,
      serialNumber: form.serialNumber || undefined,
      deviceId: form.deviceId || undefined,
      blockId: form.blockId || undefined,
    }}),
    onSuccess: () => {
      toast.success("Consumer created.");
      setOpen(false); setForm(initial);
      qc.invalidateQueries({ queryKey: ["admin-consumers"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("");
      const cd = editing.consumer_details ?? { meter_id: null, serial_number: null, device_id: null, block_id: null, location_id: null, assigned_secretary_id: null };
      return updateConsumer({ data: {
        userId: editing.id,
        fullName: editing.full_name ?? undefined,
        phone: editing.phone ?? undefined,
        email: editing.email ?? undefined,
        is_active: editing.is_active,
        locationId: cd.location_id,
        meterId: cd.meter_id,
        serialNumber: cd.serial_number,
        deviceId: cd.device_id,
        blockId: cd.block_id,
      }});
    },
    onSuccess: () => { toast.success("Saved."); setEditing(null); qc.invalidateQueries({ queryKey: ["admin-consumers"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: async (userId: string) => deleteConsumer({ data: { userId } }),
    onSuccess: () => { toast.success("Consumer deleted."); qc.invalidateQueries({ queryKey: ["admin-consumers"] }); qc.invalidateQueries({ queryKey: ["admin-users"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const seedMut = useMutation({
    mutationFn: async () => seedDemoConsumers({ data: {} }),
    onSuccess: (r) => { toast.success(`Seeded ${r.created} consumers (${r.skipped} skipped).`); qc.invalidateQueries({ queryKey: ["admin-consumers"] }); },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const fetchMut = useMutation({
    mutationFn: async (consumerId: string) => fetchAndStoreLatestReading({ data: { consumerId } }),
    onSuccess: (r) => toast.success(r.skipped ? "Reading already recorded." : "Latest reading pulled."),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <DashboardLayout navItems={ADMIN_NAV} title="Consumers" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, phone, block, meter…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterLoc} onValueChange={setFilterLoc}>
          <SelectTrigger className="w-56"><SelectValue placeholder="All locations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All locations</SelectItem>
            <SelectItem value={NONE}>— Unassigned —</SelectItem>
            {(locs.data || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={seedMut.isPending} onClick={() => { if (confirm("Seed 26 demo consumers with dummy phone numbers?")) seedMut.mutate(); }}>
          {seedMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />} Seed demo
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Add consumer</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create consumer</DialogTitle></DialogHeader>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2 col-span-2"><Label>Full name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} placeholder="+919876543210" onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-2 col-span-2">
                  <Label>Location</Label>
                  <Select value={form.locationId} onValueChange={(v) => setForm({ ...form, locationId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— None —</SelectItem>
                      {(locs.data || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Block ID</Label><Input value={form.blockId} placeholder="A1" onChange={(e) => setForm({ ...form, blockId: e.target.value })} /></div>
                <div className="space-y-2"><Label>Meter ID</Label><Input value={form.meterId} onChange={(e) => setForm({ ...form, meterId: e.target.value })} /></div>
                <div className="space-y-2"><Label>Serial number</Label><Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></div>
                <div className="space-y-2"><Label>Device ID (Senseflow)</Label><Input value={form.deviceId} placeholder="USFL_FL7053" onChange={(e) => setForm({ ...form, deviceId: e.target.value })} /></div>
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
                <tr>
                  <th className="px-4 py-3"><button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("block")}>Block <ArrowUpDown className="h-3 w-3" /></button></th>
                  <th className="px-4 py-3"><button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("name")}>Name <ArrowUpDown className="h-3 w-3" /></button></th>
                  <th className="px-4 py-3"><button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("phone")}>Phone <ArrowUpDown className="h-3 w-3" /></button></th>
                  <th className="px-4 py-3"><button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("meter")}>Meter / Device <ArrowUpDown className="h-3 w-3" /></button></th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3 font-mono text-xs">{c.consumer_details?.block_id || "—"}</td>
                    <td className="px-4 py-3 font-medium">{c.full_name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.phone || "—"}</td>
                    <td className="px-4 py-3">
                      <div>{c.consumer_details?.meter_id || "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">{c.consumer_details?.device_id || ""}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">{c.consumer_details?.location_id ? locName.get(c.consumer_details.location_id) : "—"}</td>
                    <td className="px-4 py-3">{c.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</td>
                    <td className="px-4 py-3 text-right">
                      <Link to="/admin/consumers/$id" params={{ id: c.id }}><Button size="sm" variant="ghost" title="Analysis"><BarChart3 className="h-3.5 w-3.5" /></Button></Link>
                      <Button size="sm" variant="ghost" disabled={fetchMut.isPending || !(c.consumer_details?.meter_id || c.consumer_details?.device_id)} onClick={() => fetchMut.mutate(c.id)} title="Fetch latest reading"><RefreshCw className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete ${c.full_name || c.phone}? This removes the user, meter, readings and invoices.`)) deleteMut.mutate(c.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No consumers found.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit consumer</DialogTitle></DialogHeader>
          {editing && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); updateMut.mutate(); }}>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2 col-span-2"><Label>Full name</Label><Input value={editing.full_name || ""} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} /></div>
                <div className="space-y-2"><Label>Phone</Label><Input value={editing.phone || ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" value={editing.email || ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
                <div className="space-y-2 col-span-2">
                  <Label>Location</Label>
                  <Select value={editing.consumer_details?.location_id ?? NONE} onValueChange={(v) => setEditing({ ...editing, consumer_details: { ...(editing.consumer_details || { meter_id: null, serial_number: null, device_id: null, block_id: null, location_id: null, assigned_secretary_id: null }), location_id: v === NONE ? null : v } })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— None —</SelectItem>
                      {(locs.data || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Block ID</Label><Input value={editing.consumer_details?.block_id || ""} onChange={(e) => setEditing({ ...editing, consumer_details: { ...(editing.consumer_details || { meter_id: null, serial_number: null, device_id: null, block_id: null, location_id: null, assigned_secretary_id: null }), block_id: e.target.value || null } })} /></div>
                <div className="space-y-2"><Label>Meter ID</Label><Input value={editing.consumer_details?.meter_id || ""} onChange={(e) => setEditing({ ...editing, consumer_details: { ...(editing.consumer_details || { meter_id: null, serial_number: null, device_id: null, block_id: null, location_id: null, assigned_secretary_id: null }), meter_id: e.target.value || null } })} /></div>
                <div className="space-y-2"><Label>Serial number</Label><Input value={editing.consumer_details?.serial_number || ""} onChange={(e) => setEditing({ ...editing, consumer_details: { ...(editing.consumer_details || { meter_id: null, serial_number: null, device_id: null, block_id: null, location_id: null, assigned_secretary_id: null }), serial_number: e.target.value || null } })} /></div>
                <div className="space-y-2 col-span-2"><Label>Device ID</Label><Input value={editing.consumer_details?.device_id || ""} onChange={(e) => setEditing({ ...editing, consumer_details: { ...(editing.consumer_details || { meter_id: null, serial_number: null, device_id: null, block_id: null, location_id: null, assigned_secretary_id: null }), device_id: e.target.value || null } })} /></div>
              </div>
              <DialogFooter><Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}