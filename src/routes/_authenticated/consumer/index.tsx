import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gauge, IndianRupee, FileText, Wallet, RefreshCw, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { fetchAndStoreLatestReading } from "@/lib/meter.functions";
import { CONSUMER_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/consumer/")({
  component: ConsumerDashboard,
});

function ConsumerDashboard() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const refreshMut = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No session");
      return fetchAndStoreLatestReading({ data: { consumerId: user.id } });
    },
    onSuccess: (r) => {
      toast.success(r.skipped ? "Already up to date." : "Reading refreshed.");
      qc.invalidateQueries({ queryKey: ["consumer-dashboard"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const data = useQuery({
    queryKey: ["consumer-dashboard", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [readings, invoices, balance, payments] = await Promise.all([
        supabase
          .from("meter_readings")
          .select("*")
          .eq("consumer_id", user!.id)
          .order("reading_date", { ascending: false })
          .limit(5),
        supabase
          .from("invoices")
          .select("*")
          .eq("consumer_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase.from("prepaid_balances").select("*").eq("consumer_id", user!.id).maybeSingle(),
        supabase.from("payments").select("amount").eq("consumer_id", user!.id),
      ]);
      const lastReading = readings.data?.[0];
      const latestInvoice = invoices.data?.[0];
      const pendingAmount = (invoices.data || [])
        .filter((i) => i.status !== "paid")
        .reduce((s, i) => s + Number(i.total_amount || 0), 0);
      const totalPaid = (payments.data || []).reduce((s, p) => s + Number(p.amount || 0), 0);
      return {
        readings: readings.data || [],
        invoices: invoices.data || [],
        lastReading,
        latestInvoice,
        pendingAmount,
        totalPaid,
        balance: balance.data?.balance ?? 0,
      };
    },
  });

  const s = data.data;

  const statusColor = (status: string) => {
    switch (status) {
      case "paid": return "default";
      case "pending": return "secondary";
      case "overdue": return "destructive";
      default: return "outline";
    }
  };

  return (
    <DashboardLayout
      navItems={CONSUMER_NAV}
      title={`Hi${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <div className="mb-4 flex justify-end">
        <Button size="sm" variant="outline" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
          {refreshMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh reading
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          label="Last reading"
          value={s?.lastReading ? `${Number(s.lastReading.reading).toLocaleString("en-IN")} L` : "—"}
          hint={s?.lastReading ? new Date(s.lastReading.reading_date).toLocaleDateString() : undefined}
          icon={Gauge}
        />
        <StatsCard
          label="Latest bill"
          value={s?.latestInvoice ? `₹${Number(s.latestInvoice.total_amount).toLocaleString("en-IN")}` : "—"}
          icon={FileText}
        />
        <StatsCard
          label="Pending amount"
          value={s ? `₹${s.pendingAmount.toLocaleString("en-IN")}` : "—"}
          icon={IndianRupee}
          tone="warning"
        />
        <StatsCard
          label="Prepaid balance"
          value={s ? `₹${Number(s.balance).toLocaleString("en-IN")}` : "—"}
          icon={Wallet}
          tone="success"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent readings</CardTitle></CardHeader>
          <CardContent>
            {s?.readings.length ? (
              <ul className="divide-y">
                {s.readings.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <div className="font-medium">{Number(r.reading).toLocaleString("en-IN")} L</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.reading_date).toLocaleDateString()} · {r.source}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      +{Number(r.consumption).toLocaleString("en-IN")} L
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No readings yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent invoices</CardTitle></CardHeader>
          <CardContent>
            {s?.invoices.length ? (
              <ul className="divide-y">
                {s.invoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <div className="font-medium">₹{Number(i.total_amount).toLocaleString("en-IN")}</div>
                      <div className="text-xs text-muted-foreground">
                        Due {new Date(i.due_date).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant={statusColor(i.status) as any}>{i.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}