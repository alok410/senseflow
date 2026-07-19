import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Droplets, BarChart3, Users, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Landing,
});

type Role = "admin" | "secretary" | "consumer";

function Landing() {
  const navigate = useNavigate();

  // Auth is temporarily disabled. Users pick a role and jump straight in.
  const enter = (role: Role) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("sf_active_role", role);
    }
    if (role === "admin") navigate({ to: "/admin" });
    else if (role === "secretary") navigate({ to: "/secretary" });
    else navigate({ to: "/consumer" });
  };

  const cards: { role: Role; icon: typeof Shield; title: string; desc: string }[] = [
    { role: "admin", icon: Shield, title: "Admin", desc: "Manage users, locations, rates and view analytics." },
    { role: "secretary", icon: Users, title: "Secretary", desc: "Record readings and manage your consumers." },
    { role: "consumer", icon: BarChart3, title: "Consumer", desc: "View readings, invoices and pay bills online." },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <Droplets className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">SensorFlow</span>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight md:text-6xl">
            Smart water meter management,
            <span className="text-primary"> made simple.</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Choose a role below to open its dashboard.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {cards.map((f) => (
            <button
              key={f.role}
              onClick={() => enter(f.role)}
              className="rounded-lg border bg-card p-6 text-left transition-colors hover:border-primary hover:bg-accent"
            >
              <f.icon className="h-8 w-8 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              <Button className="mt-4" size="sm">Open {f.title}</Button>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
