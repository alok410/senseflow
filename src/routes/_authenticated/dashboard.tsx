import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardRouter,
});

// Auth is temporarily disabled. Route by the last-picked role from sessionStorage,
// or send the user back to the landing role picker if nothing is selected yet.
function DashboardRouter() {
  const navigate = useNavigate();

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("sf_active_role")
        : null;
    if (stored === "admin") navigate({ to: "/admin", replace: true });
    else if (stored === "secretary") navigate({ to: "/secretary", replace: true });
    else if (stored === "consumer") navigate({ to: "/consumer", replace: true });
    else navigate({ to: "/", replace: true });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
