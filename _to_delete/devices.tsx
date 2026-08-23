import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { ADMIN_NAV } from "@/lib/nav";
import { listSenseflowDevices, fetchAndStoreLatestReading } from "@/lib/meter.functions";

export const Route = createFileRoute("/_authenticated/admin/devices")({
  component: AdminDevices,
});

function AdminDevices() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["senseflow-devices"],
    queryFn: () => listSenseflowDevices(),
  });

  const fetchMut = useMutation({
    mutationFn: (consumerId: string) => fetchAndStoreLatestReading({ data: { consumerId } }),
    onSuccess: (r: any) => {
      toast.success(r?.skipped ? "Already up to date." : "Reading fetched.");
      qc.invalidateQueries({ queryKey: ["senseflow-devices"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Fetch failed"),
  });

  return (
    <DashboardLayout navItems={ADMIN_NAV} title="Senseflow Devices" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <p className="mb-4 text-sm text-muted-foreground">
        These are the <code>device_id</code> values sent as the <code>device</code> parameter to the Senseflow API when fetching water readings.
      </p>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Block</th>
                <th className="px-4 py-3">Consumer</th>
                <th className="px-4 py-3">Senseflow device_id</th>
                <th className="px-4 py-3">Serial number</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(list.data || []).map((d) => (
                <tr key={d.consumerId}>
                  <td className="px-4 py-3">{d.block || "—"}</td>
                  <td className="px-4 py-3 font-medium">{d.name || "—"}<div className="text-xs text-muted-foreground">{d.phone || ""}</div></td>
                  <td className="px-4 py-3 font-mono text-xs">{d.deviceId}</td>
                  <td className="px-4 py-3 font-mono text-xs">{d.serialNumber || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => fetchMut.mutate(d.consumerId)} disabled={fetchMut.isPending && fetchMut.variables === d.consumerId}>
                      {fetchMut.isPending && fetchMut.variables === d.consumerId
                        ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                      Fetch now
                    </Button>
                  </td>
                </tr>
              ))}
              {list.isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>}
              {!list.isLoading && !list.data?.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No Senseflow device IDs configured yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}