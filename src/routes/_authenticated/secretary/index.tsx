import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Gauge, MapPin, FileText } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatsCard } from "@/components/StatsCard";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";

export const Route = createFileRoute("/_authenticated/secretary/")({
  component: SecretaryDashboard,
});

const navItems = [
  { label: "Dashboard", href: "/secretary" },
  { label: "My consumers", href: "/secretary/users" },
];

function SecretaryDashboard() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);

  const stats = useQuery({
    queryKey: ["secretary-dashboard", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [locs, consumers, readings, invoices] = await Promise.all([
        supabase.from("secretary_locations").select("location_id", { count: "exact", head: true }).eq("secretary_id", user!.id),
        supabase.from("consumer_details").select("user_id", { count: "exact", head: true }),
        supabase.from("meter_readings").select("id", { count: "exact", head: true }),
        supabase.from("invoices").select("status"),
      ]);
      const pending = (invoices.data || []).filter((i) => i.status === "pending").length;
      return {
        locations: locs.count ?? 0,
        consumers: consumers.count ?? 0,
        readings: readings.count ?? 0,
        pending,
      };
    },
  });

  const s = stats.data;

  return (
    <DashboardLayout
      navItems={navItems}
      title="Secretary dashboard"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="My locations" value={s?.locations ?? "—"} icon={MapPin} />
        <StatsCard label="Consumers" value={s?.consumers ?? "—"} icon={Users} />
        <StatsCard label="Readings recorded" value={s?.readings ?? "—"} icon={Gauge} tone="success" />
        <StatsCard label="Pending invoices" value={s?.pending ?? "—"} icon={FileText} tone="warning" />
      </div>
    </DashboardLayout>
  );
}