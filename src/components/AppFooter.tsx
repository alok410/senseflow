// Global footer shown on every page (dashboards via DashboardLayout, plus the
// landing and auth pages).
export function AppFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative z-10 border-t border-white/20 bg-background/40 py-6 text-center backdrop-blur-xl">
      <p className="text-sm text-muted-foreground">
        Powered by{" "}
        <span className="font-bold tracking-wide text-foreground">
          SENSEFLOW INSTRUMENTS PRIVATE LIMITED
        </span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground/70">
        © {year} All Rights Reserved
      </p>
    </footer>
  );
}
