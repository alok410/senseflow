import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Droplets, BarChart3, Users, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GradientWave } from "@/components/ui/gradient-wave";
import { AppFooter } from "@/components/AppFooter";
import { useSession } from "@/hooks/use-session";

export const Route = createFileRoute("/")({
  component: Landing,
});

type Role = "admin" | "secretary" | "consumer";

function Landing() {
  const navigate = useNavigate();
  const { session, loading } = useSession();

  useEffect(() => {
    if (!loading && session) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [session, loading, navigate]);

  // Auth ON: choosing a role sends the user to OTP sign-in with that role
  // preselected. They only reach the dashboard after verifying their number.
  const enter = (role: Role) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("sf_login_role", role);
    }
    navigate({ to: "/auth" });
  };

  const cards: { role: Role; icon: typeof Shield; title: string; desc: string }[] = [
    { role: "admin", icon: Shield, title: "Admin", desc: "Manage users, locations, rates and view analytics." },
    { role: "secretary", icon: Users, title: "Secretary", desc: "Record readings and manage your consumers." },
    { role: "consumer", icon: BarChart3, title: "Consumer", desc: "View readings, invoices and pay bills online." },
  ];

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <GradientWave className="opacity-70" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-background/60 to-background" />
      <header className="relative z-10 border-b border-white/20 bg-background/40 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <Droplets className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">SensorFlow</span>
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto w-full flex-1 px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
            Smart water meter management,
            <span className="text-primary"> made simple.</span>
          </h1>
          <p className="mt-6 text-lg text-foreground/70">
            Choose a role and sign in with your mobile number.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {cards.map((f) => (
            <button
              key={f.role}
              onClick={() => enter(f.role)}
              className="group rounded-xl border border-white/30 bg-card/60 p-6 text-left shadow-lg backdrop-blur-xl transition-all hover:-translate-y-1 hover:border-primary/60 hover:bg-card/80 hover:shadow-xl"
            >
              <f.icon className="h-8 w-8 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              <span className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
                Sign in as {f.title}
              </span>
            </button>
          ))}
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
