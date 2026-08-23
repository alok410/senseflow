import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyRoles, type AppRole } from "@/hooks/use-session";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardRouter,
});

// After login, send the user to the dashboard for their active role — the
// last-picked role if they still have it, otherwise their highest role.
function DashboardRouter() {
  const navigate = useNavigate();
  const { user, loading } = useSession();
  const rolesQ = useMyRoles(user);
  const roles = rolesQ.data ?? [];
  const noRole = !loading && !rolesQ.isLoading && !!user && roles.length === 0;

  useEffect(() => {
    if (loading || rolesQ.isLoading || !user) return;
    if (!roles.length) return;
    const stored = typeof window !== "undefined" ? window.sessionStorage.getItem("sf_active_role") : null;
    const order: AppRole[] = ["admin", "secretary", "consumer"];
    const pick = (stored && roles.includes(stored as AppRole))
      ? (stored as AppRole)
      : order.find((r) => roles.includes(r))!;
    window.sessionStorage.setItem("sf_active_role", pick);
    navigate({ to: `/${pick}`, replace: true });
  }, [loading, rolesQ.isLoading, user, roles, navigate]);

  if (noRole) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground">Your account has no role assigned yet. Please contact your admin.</p>
        <Button
          variant="outline"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/auth", replace: true });
          }}
        >
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
