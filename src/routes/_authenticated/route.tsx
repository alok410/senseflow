import { createFileRoute, Outlet } from "@tanstack/react-router";

// Auth intentionally disabled for now. Kept as a pathless layout so the
// existing /_authenticated/* route tree keeps working without any gate.
// Re-enable by restoring the beforeLoad session check when auth is added back.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: () => <Outlet />,
});