import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useSession, useMyRole } from "@/hooks/use-session";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardRouter,
});

function DashboardRouter() {
  const { user } = useSession();
  const { data: role, isLoading } = useMyRole(user);
  const navigate = useNavigate();

  useEffect(() => {
    if (!role) return;
    if (role === "admin") navigate({ to: "/admin", replace: true });
    else if (role === "secretary") navigate({ to: "/secretary", replace: true });
    else navigate({ to: "/consumer", replace: true });
  }, [role, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      {!isLoading && !role && (
        <p className="ml-3 text-sm text-muted-foreground">Setting up your account…</p>
      )}
    </div>
  );
}