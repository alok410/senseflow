import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useSession, useMyRoles, useActiveRole } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardRouter,
});

function DashboardRouter() {
  const { user } = useSession();
  const { data: roles, isLoading } = useMyRoles(user);
  const { activeRole } = useActiveRole(roles);
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!roles || roles.length === 0) {
      // No role assigned — never leave the user stranded here. Sign out and bounce.
      (async () => {
        try {
          if (typeof window !== "undefined") {
            window.sessionStorage.removeItem("sf_active_role");
          }
          await supabase.auth.signOut();
        } finally {
          navigate({
            to: "/auth",
            replace: true,
            search: { error: "no-role" } as never,
          });
        }
      })();
      return;
    }
    if (!activeRole) return;
    if (activeRole === "admin") navigate({ to: "/admin", replace: true });
    else if (activeRole === "secretary") navigate({ to: "/secretary", replace: true });
    else navigate({ to: "/consumer", replace: true });
  }, [activeRole, roles, isLoading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
