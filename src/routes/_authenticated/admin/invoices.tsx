import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_authenticated/admin/invoices")({
  component: AdminInvoices,
});

function AdminInvoices() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const list = useQuery({
    queryKey: ["admin-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <DashboardLayout navItems={NAV} title="Invoices" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Consumption</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(list.data || []).map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-3">
                      {new Date(i.bill_period_start).toLocaleDateString()} – {new Date(i.bill_period_end).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">{Number(i.consumption).toLocaleString("en-IN")} L</td>
                    <td className="px-4 py-3 font-medium">₹{Number(i.total_amount).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3">{new Date(i.due_date).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <Badge variant={i.status === "paid" ? "default" : i.status === "overdue" ? "destructive" : "secondary"}>
                        {i.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {!list.data?.length && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No invoices yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}