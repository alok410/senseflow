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

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth", replace: true });
      return;
    }

    const stored = typeof window !== "undefined" ? window.sessionStorage.getItem("sf_active_role") : null;
    const validRoles: AppRole[] = ["admin", "secretary", "consumer"];
    const validStored = stored && validRoles.includes(stored as AppRole) ? (stored as AppRole) : null;

    // If we have a stored role from sign-in, navigate immediately
    if (validStored) {
      navigate({ to: `/${validStored}`, replace: true });
      return;
    }

    // If roles query has resolved with data
    if (!rolesQ.isLoading && roles.length > 0) {
      const pick = (["admin", "secretary", "consumer"] as AppRole[]).find((r) => roles.includes(r)) || roles[0];
      window.sessionStorage.setItem("sf_active_role", pick);
      navigate({ to: `/${pick}`, replace: true });
      return;
    }

    // Fallback if query finished with no roles found
    if (!rolesQ.isLoading && roles.length === 0) {
      window.sessionStorage.setItem("sf_active_role", "admin");
      navigate({ to: "/admin", replace: true });
    }
  }, [loading, rolesQ.isLoading, user, roles, navigate, rolesQ.data]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
