import { createFileRoute } from "@tanstack/react-router";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
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

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  component: () => {
    const { user } = useSession();
    const { data: profile } = useMyProfile(user);
    return (
      <DashboardLayout navItems={NAV} title="Analytics" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
        <Card><CardContent className="p-8 text-sm text-muted-foreground">Charts and analytics coming next.</CardContent></Card>
      </DashboardLayout>
    );
  },
});