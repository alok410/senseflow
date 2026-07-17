import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useSession, useMyRoles, useActiveRole } from "@/hooks/use-session";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardRouter,
});

function DashboardRouter() {
  const { user } = useSession();
  const { data: roles, isLoading } = useMyRoles(user);
  const { activeRole } = useActiveRole(roles);
  const navigate = useNavigate();

  useEffect(() => {
    if (!activeRole) return;
    if (activeRole === "admin") navigate({ to: "/admin", replace: true });
    else if (activeRole === "secretary") navigate({ to: "/secretary", replace: true });
    else navigate({ to: "/consumer", replace: true });
  }, [activeRole, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      {!isLoading && !roles?.length && (
        <p className="ml-3 text-sm text-muted-foreground">
          No role assigned. Contact your admin.
        </p>
      )}
    </div>
  );
}
