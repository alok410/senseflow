import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";

const NAV = [
  { label: "Dashboard", href: "/admin" },
  { label: "Users", href: "/admin/users" },
  { label: "Secretaries", href: "/admin/secretaries" },
  { label: "Locations", href: "/admin/locations" },
  { label: "Rates", href: "/admin/rates" },
  { label: "Invoices", href: "/admin/invoices" },
  { label: "Analytics", href: "/admin/analytics" },
];

export const Route = createFileRoute("/_authenticated/admin/rates")({
  component: AdminRates,
});

function AdminRates() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const list = useQuery({
    queryKey: ["admin-rates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("water_rates").select("*").order("effective_from", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  return (
    <DashboardLayout navItems={NAV} title="Water rates" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-3">Effective from</th><th className="px-4 py-3">Rate / L</th><th className="px-4 py-3">Free tier (L)</th></tr>
            </thead>
            <tbody className="divide-y">
              {(list.data || []).map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">{new Date(r.effective_from).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium">₹{Number(r.rate_per_liter).toFixed(4)}</td>
                  <td className="px-4 py-3">{Number(r.free_tier_liters).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}