import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, MapPin, FileText, IndianRupee, AlertCircle, Droplets } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatsCard } from "@/components/StatsCard";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

const navItems = [
  { label: "Dashboard", href: "/admin" },
  { label: "Users", href: "/admin/users" },
  { label: "Secretaries", href: "/admin/secretaries" },
  { label: "Locations", href: "/admin/locations" },
  { label: "Rates", href: "/admin/rates" },
  { label: "Invoices", href: "/admin/invoices" },
  { label: "Analytics", href: "/admin/analytics" },
];

function AdminDashboard() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);

  const stats = useQuery({
    queryKey: ["admin-dashboard-stats"],
    queryFn: async () => {
      const [consumers, secretaries, locations, invoices, readings] = await Promise.all([
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "consumer"),
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "secretary"),
        supabase.from("locations").select("id", { count: "exact", head: true }),
        supabase.from("invoices").select("total_amount, status"),
        supabase.from("meter_readings").select("consumption"),
      ]);
      const invs = invoices.data || [];
      const totalRevenue = invs
        .filter((i) => i.status === "paid")
        .reduce((s, i) => s + Number(i.total_amount || 0), 0);
      const pending = invs.filter((i) => i.status === "pending").length;
      const overdue = invs.filter((i) => i.status === "overdue").length;
      const totalConsumption = (readings.data || []).reduce(
        (s, r) => s + Number(r.consumption || 0),
        0,
      );
      return {
        consumers: consumers.count ?? 0,
        secretaries: secretaries.count ?? 0,
        locations: locations.count ?? 0,
        totalRevenue,
        pending,
        overdue,
        totalConsumption,
      };
    },
  });

  const s = stats.data;

  return (
    <DashboardLayout
      navItems={navItems}
      title="Admin dashboard"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Consumers" value={s?.consumers ?? "—"} icon={Users} />
        <StatsCard label="Secretaries" value={s?.secretaries ?? "—"} icon={Users} tone="success" />
        <StatsCard label="Locations" value={s?.locations ?? "—"} icon={MapPin} />
        <StatsCard
          label="Revenue"
          value={s ? `₹${s.totalRevenue.toLocaleString("en-IN")}` : "—"}
          icon={IndianRupee}
          tone="success"
        />
        <StatsCard label="Pending invoices" value={s?.pending ?? "—"} icon={FileText} tone="warning" />
        <StatsCard label="Overdue" value={s?.overdue ?? "—"} icon={AlertCircle} tone="danger" />
        <StatsCard
          label="Total consumption"
          value={s ? `${s.totalConsumption.toLocaleString("en-IN")} L` : "—"}
          icon={Droplets}
        />
      </div>
      <p className="mt-8 text-sm text-muted-foreground">
        Use the navigation above to manage users, locations, rates, invoices, and analytics.
      </p>
    </DashboardLayout>
  );
}