import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  Search,
  ArrowUpDown,
  BarChart3,
  Sparkles,
  Droplets,
  RotateCcw,
  Power,
  CheckSquare,
  Square,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import {
  createConsumer,
  updateConsumer,
  deleteConsumer,
  seedDemoConsumers,
  getAdminConsumersList,
} from "@/lib/consumers.functions";
import { fetchAndStoreLatestReading } from "@/lib/meter.functions";
import { getDeviceStates, ValveStatus } from "@/lib/device-control.functions";
import { ValveControlDialog } from "@/components/ValveControlDialog";
import { ResetDeviceDialog } from "@/components/ResetDeviceDialog";
import { BatchValveControlDialog } from "@/components/BatchValveControlDialog";
import { ADMIN_NAV } from "@/lib/nav";
import { AdminTabNav } from "@/components/AdminTabNav";

export const Route = createFileRoute("/_authenticated/admin/consumers")({
  component: AdminConsumers,
});

type Row = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  consumer_details: {
    meter_id: string | null;
    serial_number: string | null;
    device_id: string | null;
    block_id: string | null;
    location_id: string | null;
    assigned_secretary_id: string | null;
  } | null;
};

const NONE = "__none__";
const ALL = "__all__";
type SortKey = "name" | "phone" | "block" | "device";

function AdminConsumers() {
  const matchRoute = useMatchRoute();
  if (matchRoute({ to: "/admin/consumers/$id" })) {
    return <Outlet />;
  }
  return <AdminConsumersList />;
}

function AdminConsumersList() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const getConsumersFn = useServerFn(getAdminConsumersList);
  const getDeviceStatesFn = useServerFn(getDeviceStates);
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const initial = {
    fullName: "",
    phone: "",
    email: "",
    locationId: NONE,
    serialNumber: "",
    deviceId: "",
    blockId: "",
  };
  const [form, setForm] = useState(initial);
  const [search, setSearch] = useState("");
  const [filterLoc, setFilterLoc] = useState<string>(ALL);
  const [sortKey, setSortKey] = useState<SortKey>("block");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Selection for batch actions
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);

  // Dialog states
  const [valveDialog, setValveDialog] = useState<{
    open: boolean;
    deviceId: string;
    targetName: string;
    currentStatus: ValveStatus;
    targetAction: "on" | "off";
  } | null>(null);

  const [resetDialog, setResetDialog] = useState<{
    open: boolean;
    deviceId: string;
    targetName: string;
  } | null>(null);

  const [batchValveDialog, setBatchValveDialog] = useState<{
    open: boolean;
    targetAction: "on" | "off";
  } | null>(null);

  const locs = useQuery({
    queryKey: ["all-locations"],
    queryFn: async () => (await supabase.from("locations").select("id, name, code").order("name")).data || [],
  });

  const list = useQuery({
    queryKey: ["admin-consumers"],
    queryFn: async () => (await getConsumersFn()) as Row[],
  });

  // Query live/cached device states for all visible devices
  const allDeviceIds = useMemo(() => {
    return (list.data || [])
      .map((c) => c.consumer_details?.device_id)
      .filter(Boolean) as string[];
  }, [list.data]);

  const deviceStates = useQuery({
    queryKey: ["admin-device-states", allDeviceIds],
    queryFn: async () => (await getDeviceStatesFn({ data: { deviceIds: allDeviceIds } })),
    enabled: allDeviceIds.length > 0,
    refetchInterval: 30000,
  });

  const locName = useMemo(() => {
    const m = new Map<string, string>();
    (locs.data || []).forEach((l) => m.set(l.id, `${l.name} (${l.code})`));
    return m;
  }, [locs.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = (list.data || []).filter((c) => {
      if (
        filterLoc !== ALL &&
        (c.consumer_details?.location_id ?? null) !== (filterLoc === NONE ? null : filterLoc)
      )
        return false;
      if (!q) return true;
      return (
        (c.full_name || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.consumer_details?.device_id || "").toLowerCase().includes(q) ||
        (c.consumer_details?.serial_number || "").toLowerCase().includes(q) ||
        (c.consumer_details?.block_id || "").toLowerCase().includes(q)
      );
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (c: Row) => {
      switch (sortKey) {
        case "name":
          return (c.full_name || "").toLowerCase();
        case "phone":
          return c.phone || "";
        case "device":
          return c.consumer_details?.device_id || "";
        case "block":
          return c.consumer_details?.block_id || "";
      }
    };
    rows = [...rows].sort((a, b) => (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0));
    return rows;
  }, [list.data, search, filterLoc, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const createMut = useMutation({
    mutationFn: async () =>
      createConsumer({
        data: {
          fullName: form.fullName,
          phone: form.phone,
          email: form.email || undefined,
          locationId: form.locationId === NONE ? null : form.locationId,
          serialNumber: form.serialNumber || undefined,
          deviceId: form.deviceId || undefined,
          blockId: form.blockId || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Consumer created.");
      setOpen(false);
      setForm(initial);
      qc.invalidateQueries({ queryKey: ["admin-consumers"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      return updateConsumer({
        data: {
          userId: editing.id,
          fullName: editing.full_name || undefined,
          phone: editing.phone || undefined,
          email: editing.email || undefined,
          locationId: editing.consumer_details?.location_id ?? null,
          serialNumber: editing.consumer_details?.serial_number ?? undefined,
          deviceId: editing.consumer_details?.device_id ?? undefined,
          blockId: editing.consumer_details?.block_id ?? undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success("Consumer updated.");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin-consumers"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: async (userId: string) => deleteConsumer({ data: { userId } }),
    onSuccess: () => {
      toast.success("Consumer deleted.");
      qc.invalidateQueries({ queryKey: ["admin-consumers"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const seedMut = useMutation({
    mutationFn: async () => seedDemoConsumers({ data: {} }),
    onSuccess: (r) => {
      toast.success(`Seeded ${r.created} consumers (${r.skipped} skipped).`);
      qc.invalidateQueries({ queryKey: ["admin-consumers"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const fetchMut = useMutation({
    mutationFn: async (consumerId: string) => fetchAndStoreLatestReading({ data: { consumerId } }),
    onSuccess: (r) => toast.success(r.skipped ? "Reading already recorded." : "Latest reading pulled."),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const handleToggleSelectAll = () => {
    const selectableDevices = filtered
      .map((c) => c.consumer_details?.device_id)
      .filter(Boolean) as string[];
    if (selectedDevices.length === selectableDevices.length) {
      setSelectedDevices([]);
    } else {
      setSelectedDevices(selectableDevices);
    }
  };

  const handleToggleSelectRow = (devId: string) => {
    setSelectedDevices((prev) =>
      prev.includes(devId) ? prev.filter((id) => id !== devId) : [...prev, devId]
    );
  };

  const onControlSuccess = () => {
    qc.invalidateQueries({ queryKey: ["admin-device-states"] });
  };

  return (
    <DashboardLayout
      navItems={ADMIN_NAV}
      title="Consumers"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <AdminTabNav />

      {/* Top Filter and Search Bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, phone, block, device, serial…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterLoc} onValueChange={setFilterLoc}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All locations</SelectItem>
            <SelectItem value={NONE}>— Unassigned —</SelectItem>
            {(locs.data || []).map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name} ({l.code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={seedMut.isPending}
          onClick={() => {
            if (confirm("Seed 26 demo consumers with dummy phone numbers?")) seedMut.mutate();
          }}
        >
          {seedMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}{" "}
          Seed demo
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add consumer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create consumer</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                createMut.mutate();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2 col-span-2">
                  <Label>Full name</Label>
                  <Input
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={form.phone}
                    placeholder="+919876543210"
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Location</Label>
                  <Select
                    value={form.locationId}
                    onValueChange={(v) => setForm({ ...form, locationId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— None —</SelectItem>
                      {(locs.data || []).map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name} ({l.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Block ID</Label>
                  <Input
                    value={form.blockId}
                    placeholder="A1"
                    onChange={(e) => setForm({ ...form, blockId: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Device ID (Senseflow)</Label>
                  <Input
                    value={form.deviceId}
                    placeholder="USFL_WM0003"
                    onChange={(e) => setForm({ ...form, deviceId: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Serial number</Label>
                  <Input
                    value={form.serialNumber}
                    onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMut.isPending}>
                  {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Bulk Action Toolbar */}
      {selectedDevices.length > 0 && (
        <div className="mb-3 p-3 bg-muted rounded-lg flex flex-wrap items-center justify-between gap-3 border shadow-sm">
          <div className="text-sm font-medium flex items-center gap-2">
            <span className="bg-primary text-primary-foreground font-bold text-xs px-2 py-0.5 rounded-full">
              {selectedDevices.length}
            </span>
            meters selected
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-600/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => setBatchValveDialog({ open: true, targetAction: "on" })}
            >
              <Droplets className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
              Batch Turn Valves ON
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-red-600/30 text-red-700 dark:text-red-300 hover:bg-red-500/10"
              onClick={() => setBatchValveDialog({ open: true, targetAction: "off" })}
            >
              <Power className="mr-1.5 h-3.5 w-3.5 text-red-500" />
              Batch Turn Valves OFF
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedDevices([])}
              className="text-xs"
            >
              Deselect all
            </Button>
          </div>
        </div>
      )}

      {/* Main Consumers Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 w-10 text-center">
                    <Checkbox
                      checked={
                        filtered.length > 0 &&
                        selectedDevices.length ===
                          filtered.filter((c) => c.consumer_details?.device_id).length
                      }
                      onCheckedChange={handleToggleSelectAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-3">
                    <button
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("block")}
                    >
                      Block <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-3">
                    <button
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("name")}
                    >
                      Name <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-3">
                    <button
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("phone")}
                    >
                      Phone <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-3">
                    <button
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort("device")}
                    >
                      Device ID <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-3">Valve Status</th>
                  <th className="px-3 py-3">Location</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((c) => {
                  const devId = c.consumer_details?.device_id;
                  const st = devId ? deviceStates.data?.[devId] : null;
                  const isClosed = st?.valveStatus === "closed";
                  const isSelected = !!(devId && selectedDevices.includes(devId));

                  return (
                    <tr key={c.id} className={isSelected ? "bg-muted/30" : undefined}>
                      <td className="px-3 py-3 text-center">
                        {devId ? (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleToggleSelectRow(devId)}
                            aria-label={`Select ${c.full_name || devId}`}
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">
                        {c.consumer_details?.block_id || "—"}
                      </td>
                      <td className="px-3 py-3 font-medium">{c.full_name || "—"}</td>
                      <td className="px-3 py-3 text-muted-foreground">{c.phone || "—"}</td>
                      <td className="px-3 py-3 font-mono text-xs font-semibold text-foreground">
                        {devId || "—"}
                      </td>
                      <td className="px-3 py-3">
                        {devId ? (
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`valve-switch-${c.id}`}
                              checked={!isClosed}
                              onCheckedChange={(checked) =>
                                setValveDialog({
                                  open: true,
                                  deviceId: devId,
                                  targetName: c.full_name || "Consumer",
                                  currentStatus: isClosed ? "closed" : "open",
                                  targetAction: checked ? "on" : "off",
                                })
                              }
                              className={
                                !isClosed
                                  ? "data-[state=checked]:bg-emerald-600"
                                  : "data-[state=unchecked]:bg-slate-300 dark:data-[state=unchecked]:bg-slate-700"
                              }
                            />
                            <label
                              htmlFor={`valve-switch-${c.id}`}
                              className={`text-xs font-semibold flex items-center gap-1 cursor-pointer select-none ${
                                !isClosed
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-red-500 dark:text-red-400"
                              }`}
                            >
                              {!isClosed ? (
                                <>
                                  <Droplets className="h-3 w-3 text-emerald-500" />
                                  <span>Open</span>
                                </>
                              ) : (
                                <>
                                  <Power className="h-3 w-3 text-red-500" />
                                  <span>Closed</span>
                                </>
                              )}
                            </label>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {c.consumer_details?.location_id
                          ? locName.get(c.consumer_details.location_id)
                          : "—"}
                      </td>
                      <td className="px-3 py-3">
                        {c.is_active ? (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-600/30">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        {devId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Reset Device Hardware"
                            onClick={() =>
                              setResetDialog({
                                open: true,
                                deviceId: devId,
                                targetName: c.full_name || "Consumer",
                              })
                            }
                          >
                            <RotateCcw className="h-3.5 w-3.5 text-blue-500" />
                          </Button>
                        )}

                        <Link to="/admin/consumers/$id" params={{ id: c.id }}>
                          <Button size="sm" variant="ghost" title="Analysis & Meter Stats">
                            <BarChart3 className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={fetchMut.isPending || !c.consumer_details?.device_id}
                          onClick={() => fetchMut.mutate(c.id)}
                          title="Fetch latest reading"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (
                              confirm(
                                `Delete ${c.full_name || c.phone}? This removes the user, meter, readings and invoices.`
                              )
                            )
                              deleteMut.mutate(c.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                      No consumers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Consumer Dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit consumer</DialogTitle>
          </DialogHeader>
          {editing && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                updateMut.mutate();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2 col-span-2">
                  <Label>Full name</Label>
                  <Input
                    value={editing.full_name || ""}
                    onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={editing.phone || ""}
                    onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={editing.email || ""}
                    onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Location</Label>
                  <Select
                    value={editing.consumer_details?.location_id ?? NONE}
                    onValueChange={(v) =>
                      setEditing({
                        ...editing,
                        consumer_details: {
                          ...(editing.consumer_details || {
                            meter_id: null,
                            serial_number: null,
                            device_id: null,
                            block_id: null,
                            location_id: null,
                            assigned_secretary_id: null,
                          }),
                          location_id: v === NONE ? null : v,
                        },
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— None —</SelectItem>
                      {(locs.data || []).map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name} ({l.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Block ID</Label>
                  <Input
                    value={editing.consumer_details?.block_id || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        consumer_details: {
                          ...(editing.consumer_details || {
                            meter_id: null,
                            serial_number: null,
                            device_id: null,
                            block_id: null,
                            location_id: null,
                            assigned_secretary_id: null,
                          }),
                          block_id: e.target.value || null,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Device ID (Senseflow)</Label>
                  <Input
                    value={editing.consumer_details?.device_id || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        consumer_details: {
                          ...(editing.consumer_details || {
                            meter_id: null,
                            serial_number: null,
                            device_id: null,
                            block_id: null,
                            location_id: null,
                            assigned_secretary_id: null,
                          }),
                          device_id: e.target.value || null,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Serial number</Label>
                  <Input
                    value={editing.consumer_details?.serial_number || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        consumer_details: {
                          ...(editing.consumer_details || {
                            meter_id: null,
                            serial_number: null,
                            device_id: null,
                            block_id: null,
                            location_id: null,
                            assigned_secretary_id: null,
                          }),
                          serial_number: e.target.value || null,
                        },
                      })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateMut.isPending}>
                  {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Valve Control Dialog */}
      {valveDialog && (
        <ValveControlDialog
          open={valveDialog.open}
          onOpenChange={(open) => !open && setValveDialog(null)}
          deviceId={valveDialog.deviceId}
          targetName={valveDialog.targetName}
          currentStatus={valveDialog.currentStatus}
          targetAction={valveDialog.targetAction}
          onSuccess={onControlSuccess}
        />
      )}

      {/* Reset Device Dialog */}
      {resetDialog && (
        <ResetDeviceDialog
          open={resetDialog.open}
          onOpenChange={(open) => !open && setResetDialog(null)}
          deviceId={resetDialog.deviceId}
          targetName={resetDialog.targetName}
          onSuccess={onControlSuccess}
        />
      )}

      {/* Batch Valve Control Dialog */}
      {batchValveDialog && (
        <BatchValveControlDialog
          open={batchValveDialog.open}
          onOpenChange={(open) => !open && setBatchValveDialog(null)}
          deviceIds={selectedDevices}
          targetAction={batchValveDialog.targetAction}
          onSuccess={() => {
            setSelectedDevices([]);
            onControlSuccess();
          }}
        />
      )}
    </DashboardLayout>
  );
}