import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { fetchAndStoreLatestReading } from "@/lib/meter.functions";
import { SECRETARY_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/secretary/users")({
  component: SecretaryUsers,
});

type Row = {
  user_id: string; meter_id: string | null; device_id: string | null;
  connection_date: string; account_type: string; location_id: string | null;
  profiles: { full_name: string | null; phone: string | null } | null;
  locations: { name: string; code: string } | null;
};

function SecretaryUsers() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["secretary-users", user?.id ?? "no-auth"],
    queryFn: async () => {
      let locIds: string[] | null = null;
      if (user) {
        const { data: myLocs, error: locsError } = await supabase
          .from("secretary_locations").select("location_id").eq("secretary_id", user.id);
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
      const locationIds = Array.from(new Set((data || []).map((c) => c.location_id).filter(Boolean))) as string[];
      const [{ data: profiles, error: profilesError }, { data: locations, error: locationsError }] = await Promise.all([
        consumerIds.length ? supabase.from("profiles").select("id, full_name, phone").in("id", consumerIds) : Promise.resolve({ data: [], error: null }),
        locationIds.length ? supabase.from("locations").select("id, name, code").in("id", locationIds) : Promise.resolve({ data: [], error: null }),
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

  const fetchMut = useMutation({
    mutationFn: async (consumerId: string) => fetchAndStoreLatestReading({ data: { consumerId } }),
    onSuccess: (r) => {
      toast.success(r.skipped ? "Reading already recorded." : "Latest reading pulled.");
      qc.invalidateQueries({ queryKey: ["secretary-users"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <DashboardLayout navItems={SECRETARY_NAV} title="My consumers" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Consumer</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Meter</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(list.data || []).map((c) => (
                  <tr key={c.user_id}>
                    <td className="px-4 py-3 font-medium">{c.profiles?.full_name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.profiles?.phone || "—"}</td>
                    <td className="px-4 py-3">{c.meter_id || c.device_id || "—"}</td>
                    <td className="px-4 py-3">{c.locations?.name || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" disabled={fetchMut.isPending || !(c.device_id || c.meter_id)} onClick={() => fetchMut.mutate(c.user_id)}>
                        {fetchMut.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                        Fetch reading
                      </Button>
                    </td>
                  </tr>
                ))}
                {!list.data?.length && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No consumers in your assigned locations.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}