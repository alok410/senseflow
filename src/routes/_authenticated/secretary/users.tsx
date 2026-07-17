import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";

const NAV = [
  { label: "Dashboard", href: "/secretary" },
  { label: "My consumers", href: "/secretary/users" },
];

export const Route = createFileRoute("/_authenticated/secretary/users")({
  component: SecretaryUsers,
});

function SecretaryUsers() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const list = useQuery({
    queryKey: ["secretary-users", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumer_details")
        .select("user_id, meter_id, connection_date, account_type, location_id");
      if (error) throw error;
      return data;
    },
  });
  return (
    <DashboardLayout navItems={NAV} title="My consumers" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Consumer</th>
                <th className="px-4 py-3">Meter</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Since</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(list.data || []).map((c) => (
                <tr key={c.user_id}>
                  <td className="px-4 py-3 font-mono text-xs">{c.user_id.slice(0, 8)}…</td>
                  <td className="px-4 py-3">{c.meter_id || "—"}</td>
                  <td className="px-4 py-3">{c.account_type}</td>
                  <td className="px-4 py-3">{new Date(c.connection_date).toLocaleDateString()}</td>
                </tr>
              ))}
              {!list.data?.length && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No consumers assigned yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}