import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import {
  ArrowLeft,
  Gauge,
  IndianRupee,
  FileText,
  Wallet,
  Gift,
  TrendingUp,
  BarChart3,
  Droplets,
  Clock,
  Power,
  RotateCcw,
  ShieldCheck,
  AlertTriangle,
  Radio,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { StatsCard } from "@/components/StatsCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { getConsumerDashboardStats } from "@/lib/meter.functions";
import { getDeviceStates, ValveStatus } from "@/lib/device-control.functions";
import { ValveControlDialog } from "@/components/ValveControlDialog";
import { ResetDeviceDialog } from "@/components/ResetDeviceDialog";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/consumers/$id")({
  component: ConsumerAnalysis,
});

type InvoiceRow = {
  id: string;
  created_at: string;
  bill_period_start: string;
  bill_period_end: string;
  consumption: number;
  free_consumption: number;
  chargeable_consumption: number;
  rate_applied: number;
  amount: number;
  late_fee: number;
  total_amount: number;
  due_date: string;
  status: string;
  paid_at: string | null;
};

function ConsumerAnalysis() {
  const { id } = Route.useParams();
  const { user } = useSession();
  const { data: adminProfile } = useMyProfile(user);
  const qc = useQueryClient();

  const [quick, setQuick] = useState<7 | 15 | 30 | 0>(30);
  const [start, setStart] = useState<string>(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [end, setEnd] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const setRange = (d: 7 | 15 | 30) => {
    setQuick(d);
    setStart(format(subDays(new Date(), d), "yyyy-MM-dd"));
    setEnd(format(new Date(), "yyyy-MM-dd"));
  };

  const [viewingInvoice, setViewingInvoice] = useState<InvoiceRow | null>(null);

  // Device control dialogs
  const [valveDialogOpen, setValveDialogOpen] = useState(false);
  const [valveTargetAction, setValveTargetAction] = useState<"on" | "off">("off");
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const getDeviceStatesFn = useServerFn(getDeviceStates);

  // Consumer identity + account meta
  const meta = useQuery({
    queryKey: ["admin-consumer-meta", id],
    queryFn: async () => {
      const [profile, details, invoices, balance, rate] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, phone, email, is_active")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("consumer_details")
          .select("meter_id, serial_number, device_id, block_id, location_id, locations(name, code)")
          .eq("user_id", id)
          .maybeSingle(),
        supabase
          .from("invoices")
          .select("*")
          .eq("consumer_id", id)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.from("prepaid_balances").select("balance").eq("consumer_id", id).maybeSingle(),
        supabase
          .from("water_rates")
          .select("*")
          .order("effective_from", { ascending: false })
          .limit(1)
          .maybeSingle(),
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

  const s = meta.data;
  const cd = s?.details as any;
  const deviceId = cd?.device_id as string | undefined;

  // Device state (valve status, last actions)
  const deviceStateQuery = useQuery({
    queryKey: ["admin-consumer-device-state", deviceId],
    queryFn: async () => (deviceId ? await getDeviceStatesFn({ data: { deviceIds: [deviceId] } }) : null),
    enabled: !!deviceId,
    refetchInterval: 20000,
  });

  const devRecord = useMemo(() => {
    if (!deviceId) return null;
    let local: any = null;
    if (typeof window !== "undefined") {
      try {
        const saved = JSON.parse(localStorage.getItem("senseflow_valve_states") || "{}");
        local = saved[deviceId];
      } catch {}
    }
    return deviceStateQuery.data?.[deviceId] || local || null;
  }, [deviceId, deviceStateQuery.data]);

  const valveStatus: ValveStatus = devRecord?.valveStatus || "open";
  const isValveClosed = valveStatus === "closed";

  // Live Senseflow analytics
  const live = useQuery({
    queryKey: ["admin-consumer-live", id, start, end],
    queryFn: async () => getConsumerDashboardStats({ data: { consumerId: id, start, end } }),
  });

  const latestReading = live.data?.latest;
  const thisMonthTotal = live.data?.thisMonthL ?? 0;
  const thisMonthChargeable = Math.max(0, thisMonthTotal - (s?.freeTier || 0));
  const thisMonthBill = thisMonthChargeable * (s?.ratePerLiter || 0);

  const chartData = (live.data?.trend || []).map((r) => ({
    date: r.date,
    label: format(parseISO(r.date), "dd MMM"),
    consumption: Number(r.consumption || 0),
  }));

  const statusBadge = (status: string) => (
    <Badge
      variant={status === "paid" ? "default" : status === "overdue" ? "destructive" : "secondary"}
    >
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
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link to="/admin/consumers">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
          </Link>
          <Badge variant="outline">Admin Controls</Badge>
        </div>
      </div>

      {/* Top Consumer Identity & Device Control Grid */}
      <div className="grid gap-4 md:grid-cols-3 mb-4">
        {/* Profile Card (2 cols) */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Account & Location Details</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Name</div>
                <div className="font-medium text-sm">{s?.profile?.full_name || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Phone</div>
                <div className="font-medium text-sm">{s?.profile?.phone || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Email</div>
                <div className="text-sm truncate">{s?.profile?.email || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Account Status</div>
                <div>
                  {s?.profile ? (
                    s.profile.is_active === false ? (
                      <Badge variant="destructive">Inactive</Badge>
                    ) : (
                      <Badge className="bg-emerald-600 hover:bg-emerald-700">Active</Badge>
                    )
                  ) : (
                    "—"
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Block</div>
                <div className="font-mono text-sm">{cd?.block_id || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Location</div>
                <div className="text-sm">{cd?.locations?.name || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Serial Number</div>
                <div className="font-mono text-sm">{cd?.serial_number || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">SenseFlow Device ID</div>
                <div className="font-mono text-sm font-semibold">{cd?.device_id || "—"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Dedicated Hardware & Valve Control Card */}
        <Card className={`border ${isValveClosed ? "border-red-500/40 bg-red-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Radio className={`h-4 w-4 ${isValveClosed ? "text-red-500" : "text-emerald-500"}`} />
                Device & Valve Control
              </CardTitle>
              {deviceId ? (
                isValveClosed ? (
                  <Badge variant="destructive" className="gap-1 text-xs">
                    <Power className="h-3 w-3" /> Valve Closed
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs">
                    <Droplets className="h-3 w-3" /> Valve Open
                  </Badge>
                )
              ) : (
                <Badge variant="outline">No Device</Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              Hardware ID: <span className="font-mono font-medium text-foreground">{deviceId || "Not configured"}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-1 space-y-3">
            {deviceId ? (
              <>
                <div className="text-xs text-muted-foreground space-y-1">
                  {devRecord?.lastActionAt && (
                    <div className="flex items-center gap-1 text-[11px]">
                      <Clock className="h-3 w-3" />
                      <span>Last action: {format(new Date(devRecord.lastActionAt), "dd MMM, hh:mm a")}</span>
                    </div>
                  )}
                  {devRecord?.lastActionReason && (
                    <div className="text-[11px] italic truncate">
                      Reason: &quot;{devRecord.lastActionReason}&quot;
                    </div>
                  )}
                  {devRecord?.lastResetAt && (
                    <div className="text-[11px] text-muted-foreground">
                      Last reboot: {format(new Date(devRecord.lastResetAt), "dd MMM, hh:mm a")}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-background border shadow-xs">
                  <div className="flex items-center gap-2.5">
                    <Switch
                      id="consumer-valve-switch"
                      checked={!isValveClosed}
                      onCheckedChange={(checked) => {
                        setValveTargetAction(checked ? "on" : "off");
                        setValveDialogOpen(true);
                      }}
                      className={!isValveClosed ? "data-[state=checked]:bg-emerald-600" : ""}
                    />
                    <label
                      htmlFor="consumer-valve-switch"
                      className={`text-xs font-semibold flex items-center gap-1 cursor-pointer select-none ${
                        !isValveClosed ? "text-emerald-600" : "text-red-500"
                      }`}
                    >
                      {!isValveClosed ? (
                        <>
                          <Droplets className="h-3.5 w-3.5 text-emerald-500" />
                          <span>Supply ON</span>
                        </>
                      ) : (
                        <>
                          <Power className="h-3.5 w-3.5 text-red-500" />
                          <span>Supply OFF</span>
                        </>
                      )}
                    </label>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 px-2"
                    onClick={() => setResetDialogOpen(true)}
                    title="Reset Hardware Logic"
                  >
                    <RotateCcw className="h-3 w-3 text-blue-500 mr-1" /> Reboot
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground py-2">
                Configure a SenseFlow Device ID (e.g. USFL_WM0024) in consumer details to enable hardware valve control.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Date Range Selector */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([7, 15, 30] as const).map((d) => (
          <Button
            key={d}
            size="sm"
            variant={quick === d ? "default" : "outline"}
            onClick={() => setRange(d)}
          >
            Last {d} days
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Input
            type="date"
            value={start}
            onChange={(e) => {
              setQuick(0);
              setStart(e.target.value);
            }}
            className="w-40"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={end}
            onChange={(e) => {
              setQuick(0);
              setEnd(e.target.value);
            }}
            className="w-40"
          />
        </div>
      </div>

      {/* Stat cards (analytics and billing) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          label="Free tier"
          value={`${(s?.freeTier || 0).toLocaleString("en-IN")} L`}
          icon={Gift}
        />
        <StatsCard
          label="Latest reading"
          value={
            latestReading?.meter_reading != null
              ? `${Math.round(Number(latestReading.meter_reading) * 1000).toLocaleString("en-IN")} L`
              : "—"
          }
          hint={
            latestReading?.reading_datetime
              ? format(new Date(latestReading.reading_datetime), "dd MMM, hh:mm a")
              : undefined
          }
          icon={Gauge}
        />
        <StatsCard
          label="Today's usage"
          value={`${(live.data?.todaysUsageL || 0).toLocaleString("en-IN")} L`}
          icon={TrendingUp}
        />
        <StatsCard
          label="This month usage"
          value={`${thisMonthTotal.toLocaleString("en-IN")} L`}
          icon={BarChart3}
          tone="success"
        />
        <StatsCard
          label="Total usage"
          value={`${(live.data?.totalUsageL || 0).toLocaleString("en-IN")} L`}
          icon={Gauge}
        />
        <StatsCard
          label="Chargeable (month)"
          value={`${thisMonthChargeable.toLocaleString("en-IN")} L`}
          icon={Droplets}
          tone="warning"
          hint={`After ${(s?.freeTier || 0).toLocaleString("en-IN")}L free`}
        />
        <StatsCard
          label="This month bill"
          value={`₹${thisMonthBill.toFixed(2)}`}
          icon={IndianRupee}
          tone="success"
        />
        <StatsCard
          label="Pending"
          value={`₹${(s?.pendingAmount || 0).toLocaleString("en-IN")}`}
          icon={FileText}
          tone="warning"
        />
        <StatsCard
          label="Prepaid balance"
          value={`₹${(s?.balance || 0).toLocaleString("en-IN")}`}
          icon={Wallet}
        />
      </div>

      {/* Consumption History and Invoices */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Consumption history</CardTitle>
            <CardDescription>Usage over the selected range</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
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
            ) : (
              <p className="text-sm text-muted-foreground">No consumption data.</p>
            )}
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
                        <TableCell className="text-xs">
                          {format(new Date(i.created_at), "dd MMM yyyy")}
                        </TableCell>
                        <TableCell className="text-xs font-semibold">
                          ₹{Number(i.total_amount).toFixed(2)}
                        </TableCell>
                        <TableCell>{statusBadge(i.status)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setViewingInvoice(i)}
                            className="text-xs h-7"
                          >
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground p-4">No invoices yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invoice Detail Dialog */}
      <Dialog open={!!viewingInvoice} onOpenChange={(o) => !o && setViewingInvoice(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invoice Details</DialogTitle>
          </DialogHeader>
          {viewingInvoice && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Bill Period</span>
                <span className="font-medium">
                  {format(new Date(viewingInvoice.bill_period_start), "dd MMM")} -{" "}
                  {format(new Date(viewingInvoice.bill_period_end), "dd MMM yyyy")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Consumption</span>
                <span>{Number(viewingInvoice.consumption).toLocaleString("en-IN")} L</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Free Tier</span>
                <span>{Number(viewingInvoice.free_consumption).toLocaleString("en-IN")} L</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Chargeable</span>
                <span>
                  {Number(viewingInvoice.chargeable_consumption).toLocaleString("en-IN")} L
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rate applied</span>
                <span>₹{Number(viewingInvoice.rate_applied).toFixed(4)} / L</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-bold">
                <span>Total Amount</span>
                <span>₹{Number(viewingInvoice.total_amount).toFixed(2)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Valve Control Dialog */}
      {deviceId && (
        <ValveControlDialog
          open={valveDialogOpen}
          onOpenChange={setValveDialogOpen}
          deviceId={deviceId}
          targetName={consumerName || "Consumer"}
          currentStatus={valveStatus}
          targetAction={valveTargetAction}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["admin-consumer-device-state"] });
          }}
        />
      )}

      {/* Reset Device Dialog */}
      {deviceId && (
        <ResetDeviceDialog
          open={resetDialogOpen}
          onOpenChange={setResetDialogOpen}
          deviceId={deviceId}
          targetName={consumerName || "Consumer"}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["admin-consumer-device-state"] });
          }}
        />
      )}
    </DashboardLayout>
  );
}
