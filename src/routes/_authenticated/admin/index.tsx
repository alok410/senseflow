import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { subDays, format, startOfDay } from "date-fns";
import { Users, MapPin, FileText, IndianRupee, AlertCircle, Droplets, BarChart3 } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminDashboard,
});

const ALL = "__all__";

function AdminDashboard() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const [preset, setPreset] = useState<7 | 15 | 30 | 0>(7);
  const [start, setStart] = useState<string>(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [end, setEnd] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [locId, setLocId] = useState<string>(ALL);
  const [topLimit, setTopLimit] = useState<number>(10);

  const setRange = (d: 7 | 15 | 30) => {
    setPreset(d);
    setStart(format(subDays(new Date(), d), "yyyy-MM-dd"));
    setEnd(format(new Date(), "yyyy-MM-dd"));
  };

  const locs = useQuery({
    queryKey: ["all-locations"],
    queryFn: async () => (await supabase.from("locations").select("id, name, code").order("name")).data || [],
  });

  const stats = useQuery({
    queryKey: ["admin-dashboard-stats"],
    queryFn: async () => {
      const [consumers, secretaries, locations, invoices, readings] = await Promise.all([
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "consumer"),
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "secretary"),
        supabase.from("locations").select("id", { count: "exact", head: true }),
        supabase.from("invoices").select("total_amount, status"),
        supabase.from("meter_readings").select("consumption"),
      ]);
      const invs = invoices.data || [];
      const totalRevenue = invs
        .filter((i) => i.status === "paid")
        .reduce((s, i) => s + Number(i.total_amount || 0), 0);
      const pending = invs.filter((i) => i.status === "pending").length;
      const overdue = invs.filter((i) => i.status === "overdue").length;
      const totalConsumption = (readings.data || []).reduce(
        (s, r) => s + Number(r.consumption || 0),
        0,
      );
      return {
        consumers: consumers.count ?? 0,
        secretaries: secretaries.count ?? 0,
        locations: locations.count ?? 0,
        totalRevenue,
        pending,
        overdue,
        totalConsumption,
      };
    },
  });

  const rangeData = useQuery({
    queryKey: ["admin-dashboard-range", start, end, locId],
    queryFn: async () => {
      // consumer_ids scoped by location filter
      let consumerIds: string[] | null = null;
      if (locId !== ALL) {
        const { data: cds } = await supabase
          .from("consumer_details").select("user_id").eq("location_id", locId);
        consumerIds = (cds || []).map((c) => c.user_id);
        if (!consumerIds.length) return { readings: [], byDay: [], leaders: [] };
      }

      let q = supabase
        .from("meter_readings")
        .select("consumer_id, consumption, reading_date")
        .gte("reading_date", start)
        .lte("reading_date", `${end}T23:59:59.999Z`);
      if (consumerIds) q = q.in("consumer_id", consumerIds);
      const { data: readings, error } = await q;
      if (error) throw error;
      const list = readings || [];

      // group by day
      const byDayMap = new Map<string, number>();
      list.forEach((r) => {
        const d = format(startOfDay(new Date(r.reading_date)), "yyyy-MM-dd");
        byDayMap.set(d, (byDayMap.get(d) || 0) + Number(r.consumption || 0));
      });
      const byDay = Array.from(byDayMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([d, v]) => ({ date: format(new Date(d), "MMM d"), consumption: Number(v.toFixed(2)) }));

      // leaderboard by consumer
      const byConsumer = new Map<string, number>();
      list.forEach((r) => {
        byConsumer.set(r.consumer_id, (byConsumer.get(r.consumer_id) || 0) + Number(r.consumption || 0));
      });
      const topIds = Array.from(byConsumer.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
      const ids = topIds.map(([id]) => id);
      const profiles = ids.length
        ? (await supabase.from("profiles").select("id, full_name, phone").in("id", ids)).data || []
        : [];
      const pMap = new Map(profiles.map((p) => [p.id, p]));
      const leaders = topIds.map(([cid, total]) => ({
        id: cid,
        name: pMap.get(cid)?.full_name || pMap.get(cid)?.phone || cid.slice(0, 8),
        consumption: Number(total.toFixed(2)),
      }));

      return { readings: list, byDay, leaders };
    },
  });

  const s = stats.data;
  const leaders = (rangeData.data?.leaders || []).slice(0, topLimit);

  return (
    <DashboardLayout
      navItems={ADMIN_NAV}
      title="Admin dashboard"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Consumers" value={s?.consumers ?? "—"} icon={Users} />
        <StatsCard label="Secretaries" value={s?.secretaries ?? "—"} icon={Users} tone="success" />
        <StatsCard label="Locations" value={s?.locations ?? "—"} icon={MapPin} />
        <StatsCard
          label="Revenue"
          value={s ? `₹${s.totalRevenue.toLocaleString("en-IN")}` : "—"}
          icon={IndianRupee}
          tone="success"
        />
        <StatsCard label="Pending invoices" value={s?.pending ?? "—"} icon={FileText} tone="warning" />
        <StatsCard label="Overdue" value={s?.overdue ?? "—"} icon={AlertCircle} tone="danger" />
        <StatsCard
          label="Total consumption"
          value={s ? `${s.totalConsumption.toLocaleString("en-IN")} L` : "—"}
          icon={Droplets}
        />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {([7, 15, 30] as const).map((d) => (
          <Button key={d} size="sm" variant={preset === d ? "default" : "outline"} onClick={() => setRange(d)}>Last {d} days</Button>
        ))}
        <Input type="date" value={start} onChange={(e) => { setPreset(0); setStart(e.target.value); }} className="w-40" />
        <span className="text-muted-foreground text-sm">to</span>
        <Input type="date" value={end} onChange={(e) => { setPreset(0); setEnd(e.target.value); }} className="w-40" />
        <Select value={locId} onValueChange={setLocId}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All locations</SelectItem>
            {(locs.data || []).map((l) => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(topLimit)} onValueChange={(v) => setTopLimit(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[5, 10, 20].map((n) => <SelectItem key={n} value={String(n)}>Top {n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Daily consumption</CardTitle></CardHeader>
          <CardContent className="h-72">
            {rangeData.data?.byDay.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rangeData.data.byDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip />
                  <Line type="monotone" dataKey="consumption" stroke="hsl(var(--primary))" />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">No consumption in range.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Top consumers</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {leaders.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={leaders} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" fontSize={10} />
                  <YAxis type="category" dataKey="name" fontSize={10} width={110} />
                  <Tooltip />
                  <Bar dataKey="consumption" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">No data.</p>}
          </CardContent>
        </Card>
      </div>

      {leaders.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Leaderboard</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Consumer</th><th className="px-4 py-3">Consumption</th><th className="px-4 py-3 text-right"></th></tr>
              </thead>
              <tbody className="divide-y">
                {leaders.map((l, i) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2 font-medium">{l.name}</td>
                    <td className="px-4 py-2">{l.consumption.toLocaleString("en-IN")} L</td>
                    <td className="px-4 py-2 text-right"><Link to="/admin/consumers/$id" params={{ id: l.id }}><Button size="sm" variant="ghost">View</Button></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </DashboardLayout>
  );
}