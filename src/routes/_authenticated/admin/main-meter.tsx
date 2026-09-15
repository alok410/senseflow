import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format, parseISO, subDays } from "date-fns";
import {
  ArrowLeft,
  Gauge,
  TrendingUp,
  BarChart3,
  Droplets,
  Activity,
  Clock,
  Power,
  RotateCcw,
  ShieldAlert,
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
import { useSession, useMyProfile } from "@/hooks/use-session";
import { getMainMeterDashboardStats } from "@/lib/meter.functions";
import { getDeviceStates, ValveStatus } from "@/lib/device-control.functions";
import { ValveControlDialog } from "@/components/ValveControlDialog";
import { ResetDeviceDialog } from "@/components/ResetDeviceDialog";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/main-meter")({
  component: MainMeterDashboard,
});

const MAIN_METER_ID = "USFL_FL7053";

function MainMeterDashboard() {
  const { user } = useSession();
  const { data: adminProfile } = useMyProfile(user);
  const qc = useQueryClient();

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

  // Device control state
  const [valveDialogOpen, setValveDialogOpen] = useState(false);
  const [valveTargetAction, setValveTargetAction] = useState<"on" | "off">("off");
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const getDeviceStatesFn = useServerFn(getDeviceStates);

  const live = useQuery({
    queryKey: ["admin-main-meter", start, end],
    queryFn: async () => getMainMeterDashboardStats({ data: { start, end } }),
  });

  const deviceId = live.data?.device_id || MAIN_METER_ID;

  const deviceStateQuery = useQuery({
    queryKey: ["main-meter-device-state", deviceId],
    queryFn: async () => await getDeviceStatesFn({ data: { deviceIds: [deviceId] } }),
    refetchInterval: 20000,
  });

  const devRecord = deviceStateQuery.data?.[deviceId];
  const valveStatus: ValveStatus = devRecord?.valveStatus || "open";
  const isValveClosed = valveStatus === "closed";

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
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link to="/admin">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
          </Link>
          <Badge variant="outline">Main Site Meter · {deviceId}</Badge>
        </div>
      </div>

      {/* Main Site Valve Safeguard Card */}
      <Card
        className={`mb-5 border ${
          isValveClosed
            ? "border-red-500/50 bg-red-500/10"
            : "border-emerald-500/30 bg-emerald-500/5"
        }`}
      >
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-3 rounded-xl ${
                isValveClosed ? "bg-red-500/20 text-red-500" : "bg-emerald-500/20 text-emerald-500"
              }`}
            >
              {isValveClosed ? <ShieldAlert className="h-6 w-6" /> : <Radio className="h-6 w-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base">Site Main Inlet Valve</h3>
                {isValveClosed ? (
                  <Badge variant="destructive" className="gap-1">
                    <Power className="h-3 w-3" /> SITE WATER STOPPED
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1">
                    <Droplets className="h-3 w-3" /> Supply Active & Flowing
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Target Device: <span className="font-mono font-medium text-foreground">{deviceId}</span>
                {devRecord?.lastActionAt && (
                  <span>
                    {" "}· Last commanded {format(new Date(devRecord.lastActionAt), "dd MMM, hh:mm a")}
                  </span>
                )}
                {devRecord?.lastResetAt && (
                  <span> · Rebooted {format(new Date(devRecord.lastResetAt), "dd MMM, hh:mm a")}</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 p-1.5 px-3 rounded-lg bg-background border">
              <Switch
                id="main-meter-switch"
                checked={!isValveClosed}
                onCheckedChange={(checked) => {
                  setValveTargetAction(checked ? "on" : "off");
                  setValveDialogOpen(true);
                }}
                className={!isValveClosed ? "data-[state=checked]:bg-emerald-600" : ""}
              />
              <label
                htmlFor="main-meter-switch"
                className={`text-xs font-semibold flex items-center gap-1 cursor-pointer select-none ${
                  !isValveClosed ? "text-emerald-600" : "text-red-500"
                }`}
              >
                {!isValveClosed ? (
                  <>
                    <Droplets className="h-3.5 w-3.5 text-emerald-500" />
                    <span>Inlet OPEN</span>
                  </>
                ) : (
                  <>
                    <Power className="h-3.5 w-3.5 text-red-500" />
                    <span>Inlet CLOSED</span>
                  </>
                )}
              </label>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setResetDialogOpen(true)}
              title="Reboot Device Hardware"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5 text-blue-500" />
              Reset Device
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Date range */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={quick === 1 ? "default" : "outline"} onClick={setToday}>
          Today
        </Button>
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

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          label="Latest reading"
          value={
            latest?.meter_reading != null
              ? `${Math.round(Number(latest.meter_reading) * 1000).toLocaleString("en-IN")} L`
              : "—"
          }
          hint={
            latest?.reading_datetime
              ? format(new Date(latest.reading_datetime), "dd MMM, hh:mm a")
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
          value={`${(live.data?.thisMonthL || 0).toLocaleString("en-IN")} L`}
          icon={BarChart3}
          tone="success"
        />
        <StatsCard
          label="Total usage"
          value={`${(live.data?.totalUsageL || 0).toLocaleString("en-IN")} L`}
          icon={Gauge}
        />
        <StatsCard
          label="Flow rate (L/s)"
          value={live.data ? Number(live.data.flowRate).toFixed(2) : "—"}
          icon={Activity}
          tone="warning"
        />
        <StatsCard
          label="Consumption (range)"
          value={`${(live.data?.rangeConsumptionL || 0).toLocaleString("en-IN")} L`}
          icon={Droplets}
        />
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
          ) : (
            <p className="text-sm text-muted-foreground">No consumption data for this period.</p>
          )}
        </CardContent>
      </Card>

      {/* History table */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Daily breakdown</CardTitle>
          <CardDescription>{rows.length} days in range</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Closing reading</TableHead>
                  <TableHead>Daily consumption</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="font-mono text-xs">{r.date}</TableCell>
                    <TableCell className="text-xs">
                      {r.closing != null
                        ? `${Math.round(Number(r.closing) * 1000).toLocaleString("en-IN")} L`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-semibold">
                      {r.consumption != null
                        ? `${Math.round(Number(r.consumption)).toLocaleString("en-IN")} L`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      No records found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Main Meter Valve Control Dialog with high-security guard */}
      <ValveControlDialog
        open={valveDialogOpen}
        onOpenChange={setValveDialogOpen}
        deviceId={deviceId}
        targetName="Main Site Inlet Meter"
        currentStatus={valveStatus}
        targetAction={valveTargetAction}
        isMainMeter={true}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["main-meter-device-state"] });
        }}
      />

      {/* Reset Device Dialog */}
      <ResetDeviceDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        deviceId={deviceId}
        targetName="Main Site Inlet Meter"
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["main-meter-device-state"] });
        }}
      />
    </DashboardLayout>
  );
}
