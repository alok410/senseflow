import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import {
  ArrowLeft, Gauge, IndianRupee, FileText, Wallet, Gift,
  TrendingUp, BarChart3, Droplets, Clock,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { getConsumerDashboardStats } from "@/lib/meter.functions";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/consumers/$id")({
  component: ConsumerAnalysis,
});

type InvoiceRow = {
  id: string; created_at: string; bill_period_start: string; bill_period_end: string;
  consumption: number; free_consumption: number; chargeable_consumption: number;
  rate_applied: number; amount: number; late_fee: number; total_amount: number;
  due_date: string; status: string; paid_at: string | null;
};

// Admin-facing, READ-ONLY analysis of a single consumer. Mirrors the consumer
// dashboard's analytics + invoices, but without the consumer-only actions
// (refresh reading, recharge, pay).
function ConsumerAnalysis() {
  const { id } = Route.useParams();
  const { user } = useSession();
  const { data: adminProfile } = useMyProfile(user);

  const [quick, setQuick] = useState<7 | 15 | 30 | 0>(30);
  const [start, setStart] = useState<string>(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [end, setEnd] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const setRange = (d: 7 | 15 | 30) => {
    setQuick(d);
    setStart(format(subDays(new Date(), d), "yyyy-MM-dd"));
    setEnd(format(new Date(), "yyyy-MM-dd"));
  };

  const [viewingInvoice, setViewingInvoice] = useState<InvoiceRow | null>(null);

  // Consumer identity + account meta (invoices, balance, current rate)
  const meta = useQuery({
    queryKey: ["admin-consumer-meta", id],
    queryFn: async () => {
      const [profile, details, invoices, balance, rate] = await Promise.all([
        supabase.from("profiles").select("id, full_name, phone, email, is_active").eq("id", id).maybeSingle(),
        supabase.from("consumer_details").select("meter_id, serial_number, device_id, block_id, location_id, locations(name, code)").eq("user_id", id).maybeSingle(),
        supabase.from("invoices").select("*").eq("consumer_id", id).order("created_at", { ascending: false }).limit(50),
        supabase.from("prepaid_balances").select("balance").eq("consumer_id", id).maybeSingle(),
        supabase.from("water_rates").select("*").order("effective_from", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const invoiceRows = (invoices.data || []) as unknown as InvoiceRow[];
      const pending = invoiceRows.filter((i) => i.status !== "paid");
      const pendingAmount = pending.reduce((s, i) => s + Number(i.total_amount || 0), 0);
      return {
        profile: profile.data,
        details: details.data,
        invoices: invoiceRows,
        pending,
        pendingAmount,
        balance: Number(balance.data?.balance || 0),
        freeTier: Number(rate.data?.free_tier_liters || 0),
        ratePerLiter: Number(rate.data?.rate_per_liter || 0),
      };
    },
  });

  // Live Senseflow analytics for this consumer (reset-/gap-aware server fn)
  const live = useQuery({
    queryKey: ["admin-consumer-live", id, start, end],
    queryFn: async () => getConsumerDashboardStats({ data: { consumerId: id, start, end } }),
  });

  const s = meta.data;
  const cd = s?.details as any;
  const latestReading = live.data?.latest;

  const thisMonthTotal = live.data?.thisMonthL ?? 0;
  const thisMonthChargeable = Math.max(0, thisMonthTotal - (s?.freeTier || 0));
  const thisMonthBill = thisMonthChargeable * (s?.ratePerLiter || 0);

  const analysis = useMemo(() => {
    const rows = live.data?.history || [];
    if (!rows.length) return { total: 0, avg: 0, min: 0, max: 0, count: 0, chargeable: 0, bill: 0, proratedFree: 0 };
    const c = rows.map((r) => Number(r.consumption || 0));
    const total = c.reduce((a, b) => a + b, 0);
    const free = s?.freeTier || 0;
    const rate = s?.ratePerLiter || 0;
    // Monthly free tier pro-rated to the selected range (estimate only).
    const rangeDays = Math.max(
      1,
      Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1,
    );
    const daysInMonth = new Date(new Date(end).getFullYear(), new Date(end).getMonth() + 1, 0).getDate();
    const proratedFree = free * Math.min(1, rangeDays / daysInMonth);
    const chargeable = Math.max(0, total - proratedFree);
    return {
      total, avg: Math.round(total / c.length),
      min: Math.min(...c), max: Math.max(...c),
      count: c.length, chargeable, bill: chargeable * rate, proratedFree: Math.round(proratedFree),
    };
  }, [live.data, s, start, end]);

  const chartData = (live.data?.trend || []).map((r) => ({
    date: r.date,
    label: format(parseISO(r.date), "dd MMM"),
    consumption: Number(r.consumption || 0),
  }));

  const statusBadge = (status: string) => (
    <Badge variant={status === "paid" ? "default" : status === "overdue" ? "destructive" : "secondary"}>
      {status}
    </Badge>
  );

  const consumerName = s?.profile?.full_name || null;

  return (
    <DashboardLayout
      navItems={ADMIN_NAV}
      title={`Consumer analysis${consumerName ? ` — ${consumerName}` : ""}`}
      userName={adminProfile?.full_name || null}
      userPhone={adminProfile?.phone || null}
    >
      <div className="mb-4 flex items-center gap-2">
        <Link to="/admin/consumers"><Button variant="ghost" size="sm"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button></Link>
        <Badge variant="outline">Read-only</Badge>
      </div>

      {/* Consumer identity */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div><div className="text-xs text-muted-foreground">Name</div><div className="font-medium">{s?.profile?.full_name || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Phone</div><div className="font-medium">{s?.profile?.phone || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Email</div><div className="text-sm">{s?.profile?.email || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Status</div><div>{s?.profile ? (s.profile.is_active === false ? <Badge variant="destructive">Inactive</Badge> : <Badge>Active</Badge>) : "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Block</div><div className="font-mono text-sm">{cd?.block_id || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Location</div><div className="text-sm">{cd?.locations?.name || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Serial</div><div className="font-mono text-sm">{cd?.serial_number || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Device ID</div><div className="font-mono text-sm">{cd?.device_id || "—"}</div></div>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards (same analytics as consumer dashboard) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Free tier" value={`${(s?.freeTier || 0).toLocaleString("en-IN")} L`} icon={Gift} />
        <StatsCard
          label="Latest reading"
          value={latestReading?.meter_reading != null ? `${Math.round(Number(latestReading.meter_reading) * 1000).toLocaleString("en-IN")} L` : "—"}
          hint={latestReading?.reading_datetime ? format(new Date(latestReading.reading_datetime), "dd MMM, hh:mm a") : undefined}
          icon={Gauge}
        />
        <StatsCard label="Today's usage" value={`${(live.data?.todaysUsageL || 0).toLocaleString("en-IN")} L`} icon={TrendingUp} />
        <StatsCard label="This month usage" value={`${thisMonthTotal.toLocaleString("en-IN")} L`} icon={BarChart3} tone="success" />
        <StatsCard label="Total usage" value={`${(live.data?.totalUsageL || 0).toLocaleString("en-IN")} L`} icon={Gauge} />
        <StatsCard label="Chargeable (month)" value={`${thisMonthChargeable.toLocaleString("en-IN")} L`} icon={Droplets} tone="warning" hint={`After ${(s?.freeTier || 0).toLocaleString("en-IN")}L free`} />
        <StatsCard label="This month bill" value={`₹${thisMonthBill.toFixed(2)}`} icon={IndianRupee} tone="success" />
        <StatsCard label="Pending" value={`₹${(s?.pendingAmount || 0).toLocaleString("en-IN")}`} icon={FileText} tone="warning" />
        <StatsCard label="Prepaid balance" value={`₹${(s?.balance || 0).toLocaleString("en-IN")}`} icon={Wallet} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Consumption history</CardTitle>
            <CardDescription>Usage over the selected range</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {chartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" fontSize={10} />
                  <YAxis fontSize={10} domain={[0, "auto"]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="consumption" stroke="hsl(var(--primary))" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-muted-foreground">No consumption data.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>All bills on this account</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {s?.invoices.length ? (
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.invoices.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="text-xs">{new Date(i.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="font-semibold">₹{Number(i.total_amount).toFixed(2)}</div>
                          <div className="text-xs text-muted-foreground">{Number(i.consumption).toLocaleString("en-IN")}L used</div>
                        </TableCell>
                        <TableCell>{statusBadge(i.status)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => setViewingInvoice(i)}>View</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : <p className="p-4 text-sm text-muted-foreground">No invoices yet.</p>}
          </CardContent>
        </Card>
      </div>

      {/* Readings & analysis */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Readings & analysis</CardTitle>
              <CardDescription>Filter by date range</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={start} onChange={(e) => { setQuick(0); setStart(e.target.value); }} className="w-40" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={end} onChange={(e) => { setQuick(0); setEnd(e.target.value); }} className="w-40" />
              {([7, 15, 30] as const).map((d) => (
                <Button key={d} size="sm" variant={quick === d ? "default" : "outline"} onClick={() => setRange(d)}>{d}d</Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-primary/5 p-4">
              <p className="text-xs text-muted-foreground">Total consumption</p>
              <p className="text-2xl font-bold text-primary">{analysis.total.toLocaleString("en-IN")} L</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Average / reading</p>
              <p className="text-2xl font-bold">{analysis.avg.toLocaleString("en-IN")} L</p>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground">Chargeable</p>
              <p className="text-2xl font-bold">{analysis.chargeable.toLocaleString("en-IN")} L</p>
              <p className="text-xs text-muted-foreground">After {analysis.proratedFree.toLocaleString("en-IN")}L free (pro-rated)</p>
            </div>
            <div className="rounded-lg border bg-success/5 p-4">
              <p className="text-xs text-muted-foreground">Estimated bill (range)</p>
              <p className="text-2xl font-bold">₹{analysis.bill.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Estimate — final bill from invoice</p>
            </div>
          </div>

          {live.isLoading ? (
            <div className="flex justify-center py-8"><Droplets className="h-6 w-6 animate-pulse opacity-40" /></div>
          ) : (live.data?.history?.length || 0) > 0 ? (
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
                {[...(live.data?.history || [])].reverse().map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="text-xs">{format(parseISO(r.date), "dd MMM yyyy")}</TableCell>
                    <TableCell className="font-medium">{Number(r.closing).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-muted-foreground">{Number(r.opening).toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={s?.freeTier ? (Number(r.consumption) > s.freeTier / 30 ? "border-warning text-warning" : "") : ""}>
                        {Number(r.consumption).toLocaleString("en-IN")} L
                      </Badge>
                    </TableCell>
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

          {(live.data?.history?.length || 0) > 0 && (
            <div className="flex flex-wrap gap-4 border-t pt-4 text-sm">
              <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Readings:</span> <Badge variant="secondary">{analysis.count}</Badge></div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">Min:</span> <Badge variant="outline">{analysis.min.toLocaleString("en-IN")} L</Badge></div>
              <div className="flex items-center gap-2"><span className="text-muted-foreground">Max:</span> <Badge variant="outline">{analysis.max.toLocaleString("en-IN")} L</Badge></div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Read-only invoice breakdown */}
      <Dialog open={!!viewingInvoice} onOpenChange={(o) => !o && setViewingInvoice(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invoice details</DialogTitle></DialogHeader>
          {viewingInvoice && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><div className="text-xs text-muted-foreground">Period</div><div>{new Date(viewingInvoice.bill_period_start).toLocaleDateString()} – {new Date(viewingInvoice.bill_period_end).toLocaleDateString()}</div></div>
              <div><div className="text-xs text-muted-foreground">Due</div><div>{new Date(viewingInvoice.due_date).toLocaleDateString()}</div></div>
              <div><div className="text-xs text-muted-foreground">Consumption</div><div>{Number(viewingInvoice.consumption).toLocaleString("en-IN")} L</div></div>
              <div><div className="text-xs text-muted-foreground">Free tier</div><div>{Number(viewingInvoice.free_consumption).toLocaleString("en-IN")} L</div></div>
              <div><div className="text-xs text-muted-foreground">Chargeable</div><div>{Number(viewingInvoice.chargeable_consumption).toLocaleString("en-IN")} L</div></div>
              <div><div className="text-xs text-muted-foreground">Rate applied</div><div>₹{Number(viewingInvoice.rate_applied).toFixed(4)}/L</div></div>
              <div><div className="text-xs text-muted-foreground">Amount</div><div>₹{Number(viewingInvoice.amount).toLocaleString("en-IN")}</div></div>
              <div><div className="text-xs text-muted-foreground">Late fee</div><div>₹{Number(viewingInvoice.late_fee).toLocaleString("en-IN")}</div></div>
              <div className="col-span-2 border-t pt-2"><div className="text-xs text-muted-foreground">Total</div><div className="text-lg font-bold">₹{Number(viewingInvoice.total_amount).toLocaleString("en-IN")}</div></div>
              <div className="col-span-2"><div className="text-xs text-muted-foreground">Status</div><div>{statusBadge(viewingInvoice.status)}{viewingInvoice.paid_at ? ` · paid ${new Date(viewingInvoice.paid_at).toLocaleString()}` : ""}</div></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
