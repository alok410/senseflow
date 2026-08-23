import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import {
  ArrowLeft, Gauge, TrendingUp, BarChart3, Droplets, Activity, Clock,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { getMainMeterDashboardStats } from "@/lib/meter.functions";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/main-meter")({
  component: MainMeterDashboard,
});

// Full main-meter (USFL_FL7053) analysis — same usage view as the consumer
// dashboard, but for the site's main meter (no invoices / billing).
function MainMeterDashboard() {
  const { user } = useSession();
  const { data: adminProfile } = useMyProfile(user);

  const [quick, setQuick] = useState<0 | 1 | 7 | 15 | 30>(30);
  const [start, setStart] = useState<string>(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [end, setEnd] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const setRange = (d: 7 | 15 | 30) => {
    setQuick(d);
    setStart(format(subDays(new Date(), d), "yyyy-MM-dd"));
    setEnd(format(new Date(), "yyyy-MM-dd"));
  };
  const setToday = () => {
    setQuick(1);
    const t = format(new Date(), "yyyy-MM-dd");
    setStart(t);
    setEnd(t);
  };

  const live = useQuery({
    queryKey: ["admin-main-meter", start, end],
    queryFn: async () => getMainMeterDashboardStats({ data: { start, end } }),
  });

  const latest = live.data?.latest;
  const rows = live.data?.history || [];
  const total = rows.reduce((a, r) => a + Number(r.consumption || 0), 0);
  const values = rows.map((r) => Number(r.consumption || 0));
  const avg = values.length ? Math.round(total / values.length) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;

  const chartData = (live.data?.trend || []).map((r) => ({
    date: r.date,
    label: format(parseISO(r.date), "dd MMM"),
    consumption: Number(r.consumption || 0),
  }));

  return (
    <DashboardLayout
      navItems={ADMIN_NAV}
      title="Main Meter dashboard"
      userName={adminProfile?.full_name || null}
      userPhone={adminProfile?.phone || null}
    >
      <div className="mb-4 flex items-center gap-2">
        <Link to="/admin"><Button variant="ghost" size="sm"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button></Link>
        <Badge variant="outline">Main Meter · {live.data?.device_id || "USFL_FL7053"}</Badge>
      </div>

      {/* Date range */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={quick === 1 ? "default" : "outline"} onClick={setToday}>Today</Button>
        {([7, 15, 30] as const).map((d) => (
          <Button key={d} size="sm" variant={quick === d ? "default" : "outline"} onClick={() => setRange(d)}>Last {d} days</Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Input type="date" value={start} onChange={(e) => { setQuick(0); setStart(e.target.value); }} className="w-40" />
          <span className="text-muted-foreground text-sm">to</span>
          <Input type="date" value={end} onChange={(e) => { setQuick(0); setEnd(e.target.value); }} className="w-40" />
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          label="Latest reading"
          value={latest?.meter_reading != null ? `${Math.round(Number(latest.meter_reading) * 1000).toLocaleString("en-IN")} L` : "—"}
          hint={latest?.reading_datetime ? format(new Date(latest.reading_datetime), "dd MMM, hh:mm a") : undefined}
          icon={Gauge}
        />
        <StatsCard label="Today's usage" value={`${(live.data?.todaysUsageL || 0).toLocaleString("en-IN")} L`} icon={TrendingUp} />
        <StatsCard label="This month usage" value={`${(live.data?.thisMonthL || 0).toLocaleString("en-IN")} L`} icon={BarChart3} tone="success" />
        <StatsCard label="Total usage" value={`${(live.data?.totalUsageL || 0).toLocaleString("en-IN")} L`} icon={Gauge} />
        <StatsCard label="Flow rate (L/s)" value={live.data ? Number(live.data.flowRate).toFixed(2) : "—"} icon={Activity} tone="warning" />
        <StatsCard label="Consumption (range)" value={`${(live.data?.rangeConsumptionL || 0).toLocaleString("en-IN")} L`} icon={Droplets} />
      </div>

      {/* Consumption history */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Consumption history</CardTitle>
          <CardDescription>Daily usage over the selected range</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {chartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" fontSize={10} />
                <YAxis fontSize={10} domain={[0, "auto"]} />
                <Tooltip />
                <Bar dataKey="consumption" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted-foreground">{live.isLoading ? "Loading readings…" : "No consumption in range."}</p>}
        </CardContent>
      </Card>

      {/* Readings & analysis */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Readings & analysis</CardTitle>
          <CardDescription>Daily opening / closing / consumption</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-primary/5 p-4">
              <p className="text-xs text-muted-foreground">Total consumption</p>
              <p className="text-2xl font-bold text-primary">{total.toLocaleString("en-IN")} L</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Average / day</p>
              <p className="text-2xl font-bold">{avg.toLocaleString("en-IN")} L</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Min / day</p>
              <p className="text-2xl font-bold">{min.toLocaleString("en-IN")} L</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Max / day</p>
              <p className="text-2xl font-bold">{max.toLocaleString("en-IN")} L</p>
            </div>
          </div>

          {live.isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading…</div>
          ) : rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Closing</TableHead>
                  <TableHead>Opening</TableHead>
                  <TableHead>Consumption</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...rows].reverse().map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="text-xs">{format(parseISO(r.date), "dd MMM yyyy")}</TableCell>
                    <TableCell className="font-medium">{Number(r.closing).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-muted-foreground">{Number(r.opening).toLocaleString("en-IN")}</TableCell>
                    <TableCell><Badge variant="outline">{Number(r.consumption).toLocaleString("en-IN")} L</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <Droplets className="mx-auto mb-2 h-10 w-10 opacity-40" />
              <p className="text-sm">No readings in this range.</p>
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex flex-wrap gap-4 border-t pt-4 text-sm">
              <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Days:</span> <Badge variant="secondary">{rows.length}</Badge></div>
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
