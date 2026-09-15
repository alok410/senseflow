import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  Loader2,
  Droplets,
  Power,
  RotateCcw,
  Search,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { fetchAndStoreLatestReading } from "@/lib/meter.functions";
import { getDeviceStates, ValveStatus } from "@/lib/device-control.functions";
import { ValveControlDialog } from "@/components/ValveControlDialog";
import { ResetDeviceDialog } from "@/components/ResetDeviceDialog";
import { SECRETARY_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/secretary/users")({
  component: SecretaryUsers,
});

type Row = {
  user_id: string;
  meter_id: string | null;
  device_id: string | null;
  connection_date: string;
  account_type: string;
  location_id: string | null;
  profiles: { full_name: string | null; phone: string | null } | null;
  locations: { name: string; code: string } | null;
};

function SecretaryUsers() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterValve, setFilterValve] = useState<"all" | "open" | "closed">("all");

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

  const getDeviceStatesFn = useServerFn(getDeviceStates);

  const list = useQuery({
    queryKey: ["secretary-users", user?.id ?? "no-auth"],
    queryFn: async () => {
      let locIds: string[] | null = null;
      if (user) {
        const { data: myLocs, error: locsError } = await supabase
          .from("secretary_locations")
          .select("location_id")
          .eq("secretary_id", user.id);
        if (locsError) throw locsError;
        locIds = (myLocs || []).map((l) => l.location_id);
        if (!locIds.length) return [] as Row[];
      }
      let query = supabase
        .from("consumer_details")
        .select("user_id, meter_id, device_id, connection_date, account_type, location_id");
      if (locIds) query = query.in("location_id", locIds);
      const { data, error } = await query;
      if (error) throw error;
      const consumerIds = (data || []).map((c) => c.user_id);
      const locationIds = Array.from(
        new Set((data || []).map((c) => c.location_id).filter(Boolean))
      ) as string[];
      const [{ data: profiles, error: profilesError }, { data: locations, error: locationsError }] =
        await Promise.all([
          consumerIds.length
            ? supabase.from("profiles").select("id, full_name, phone").in("id", consumerIds)
            : Promise.resolve({ data: [], error: null }),
          locationIds.length
            ? supabase.from("locations").select("id, name, code").in("id", locationIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
      if (profilesError) throw profilesError;
      if (locationsError) throw locationsError;
      const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
      const locationMap = new Map((locations || []).map((l) => [l.id, l]));
      return (data || []).map((c) => ({
        ...c,
        profiles: profileMap.get(c.user_id) || null,
        locations: c.location_id ? locationMap.get(c.location_id) || null : null,
      })) as Row[];
    },
  });

  // Query device states for all visible devices
  const deviceIds = useMemo(() => {
    return (list.data || [])
      .map((c) => c.device_id || c.meter_id)
      .filter(Boolean) as string[];
  }, [list.data]);

  const deviceStatesQuery = useQuery({
    queryKey: ["secretary-device-states", deviceIds],
    queryFn: async () => await getDeviceStatesFn({ data: { deviceIds } }),
    enabled: deviceIds.length > 0,
    refetchInterval: 25000,
  });

  const fetchMut = useMutation({
    mutationFn: async (consumerId: string) => fetchAndStoreLatestReading({ data: { consumerId } }),
    onSuccess: (r) => {
      toast.success(r.skipped ? "Reading already recorded." : "Latest reading pulled.");
      qc.invalidateQueries({ queryKey: ["secretary-users"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data || []).filter((c) => {
      const devId = c.device_id || c.meter_id;
      const st = devId ? deviceStatesQuery.data?.[devId] : null;
      const isClosed = st?.valveStatus === "closed";

      if (filterValve === "open" && isClosed) return false;
      if (filterValve === "closed" && !isClosed) return false;

      if (!q) return true;
      return (
        (c.profiles?.full_name || "").toLowerCase().includes(q) ||
        (c.profiles?.phone || "").toLowerCase().includes(q) ||
        (c.device_id || "").toLowerCase().includes(q) ||
        (c.meter_id || "").toLowerCase().includes(q) ||
        (c.locations?.name || "").toLowerCase().includes(q)
      );
    });
  }, [list.data, search, filterValve, deviceStatesQuery.data]);

  const onControlSuccess = () => {
    qc.invalidateQueries({ queryKey: ["secretary-device-states"] });
  };

  return (
    <DashboardLayout
      navItems={SECRETARY_NAV}
      title="My consumers"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      {/* Top Search & Filter Bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search consumer, phone, device ID, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={filterValve}
          onValueChange={(v) => setFilterValve(v as "all" | "open" | "closed")}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Valve filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Valves</SelectItem>
            <SelectItem value="open">🟢 Valves Open</SelectItem>
            <SelectItem value="closed">🔴 Valves Shut OFF</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Consumer</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Device / Meter</th>
                  <th className="px-4 py-3">Valve Status</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRows.map((c) => {
                  const devId = c.device_id || c.meter_id;
                  const st = devId ? deviceStatesQuery.data?.[devId] : null;
                  const isClosed = st?.valveStatus === "closed";

                  return (
                    <tr key={c.user_id}>
                      <td className="px-4 py-3 font-medium">{c.profiles?.full_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.profiles?.phone || "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{devId || "—"}</td>
                      <td className="px-4 py-3">
                        {devId ? (
                          isClosed ? (
                            <Badge
                              variant="destructive"
                              className="cursor-pointer gap-1"
                              title={st?.lastActionReason || "Valve closed"}
                              onClick={() =>
                                setValveDialog({
                                  open: true,
                                  deviceId: devId,
                                  targetName: c.profiles?.full_name || "Consumer",
                                  currentStatus: "closed",
                                  targetAction: "on",
                                })
                              }
                            >
                              <Power className="h-3 w-3" />
                              Closed
                            </Badge>
                          ) : (
                            <Badge
                              className="bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer gap-1"
                              title={st?.lastActionReason || "Valve open and running"}
                              onClick={() =>
                                setValveDialog({
                                  open: true,
                                  deviceId: devId,
                                  targetName: c.profiles?.full_name || "Consumer",
                                  currentStatus: "open",
                                  targetAction: "off",
                                })
                              }
                            >
                              <Droplets className="h-3 w-3" />
                              Open
                            </Badge>
                          )
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            No Device
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">{c.locations?.name || "—"}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {devId && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              className={
                                isClosed
                                  ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                                  : "text-red-500 hover:text-red-600 hover:bg-red-500/10"
                              }
                              title={isClosed ? "Turn Valve ON" : "Turn Valve OFF"}
                              onClick={() =>
                                setValveDialog({
                                  open: true,
                                  deviceId: devId,
                                  targetName: c.profiles?.full_name || "Consumer",
                                  currentStatus: isClosed ? "closed" : "open",
                                  targetAction: isClosed ? "on" : "off",
                                })
                              }
                            >
                              {isClosed ? (
                                <Droplets className="h-3.5 w-3.5" />
                              ) : (
                                <Power className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Reset Hardware Logic"
                              onClick={() =>
                                setResetDialog({
                                  open: true,
                                  deviceId: devId,
                                  targetName: c.profiles?.full_name || "Consumer",
                                })
                              }
                            >
                              <RotateCcw className="h-3.5 w-3.5 text-blue-500" />
                            </Button>
                          </>
                        )}

                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={fetchMut.isPending || !(c.device_id || c.meter_id)}
                          onClick={() => fetchMut.mutate(c.user_id)}
                          title="Fetch reading"
                        >
                          {fetchMut.isPending ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-1 h-3.5 w-3.5" />
                          )}
                          Fetch reading
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!filteredRows.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No consumers match the filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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
    </DashboardLayout>
  );
}