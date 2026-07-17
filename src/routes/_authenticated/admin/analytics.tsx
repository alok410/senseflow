import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  component: () => {
    const { user } = useSession();
    const { data: profile } = useMyProfile(user);
    return (
      <DashboardLayout navItems={ADMIN_NAV} title="Analytics" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
        <Card><CardContent className="p-8 text-sm text-muted-foreground">Charts and analytics coming next.</CardContent></Card>
      </DashboardLayout>
    );
  },
});