import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, CheckCircle2, Clock, AlertTriangle, IndianRupee, CreditCard,
  Banknote, TrendingUp, BarChart3, Droplets, Loader2,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { ADMIN_NAV } from "@/lib/nav";
import { getPaymentAnalytics, type PaymentAnalytics } from "@/lib/invoices.functions";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  component: AdminAnalytics,
});

const fmtINR = (n: number) =>
  `\u20b9${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtINRDecimal = (n: number) =>
  `\u20b9${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card className={`border-${color}-200 bg-${color}-50/50 dark:border-${color}-900 dark:bg-${color}-950/20`}>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon className={`h-8 w-8 text-${color}-600 dark:text-${color}-400 flex-shrink-0 mt-0.5`} />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold truncate">{value}</p>
          {sub && <p className={`text-xs text-${color}-600`}>{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function AdminAnalytics() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const getAnalyticsFn = useServerFn(getPaymentAnalytics);

  const analytics = useQuery({
    queryKey: ["payment-analytics"],
    queryFn: async () => getAnalyticsFn({ data: undefined }) as Promise<PaymentAnalytics>,
    staleTime: 5 * 60_000,
  });

  const d = analytics.data;

  // Pie chart data for invoice status
  const statusPieData = d
    ? [
        { name: "Paid", value: d.paidInvoices, color: "#22c55e" },
        { name: "Pending", value: d.pendingInvoices, color: "#eab308" },
        { name: "Overdue", value: d.overdueInvoices, color: "#ef4444" },
      ].filter((x) => x.value > 0)
    : [];

  // Pie chart data for payment method
  const methodPieData = d
    ? [
        { name: "Cash", value: d.cashAmount, color: "#3b82f6" },
        { name: "Online", value: d.onlineAmount, color: "#a855f7" },
      ].filter((x) => x.value > 0)
    : [];

  const collectionRate = d && d.totalInvoicedAmount > 0
    ? ((d.totalCollectedAmount / d.totalInvoicedAmount) * 100).toFixed(1)
    : "0.0";

  return (
    <DashboardLayout
      navItems={ADMIN_NAV}
      title="Billing Analytics"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      {analytics.isLoading ? (
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
          <Loader2 className="h-10 w-10 animate-spin" />
          <p className="text-sm">Loading analytics…</p>
        </div>
      ) : analytics.isError ? (
        <Card>
          <CardContent className="p-8 text-center text-destructive">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8" />
            <p>Failed to load analytics.</p>
          </CardContent>
        </Card>
      ) : d ? (
        <div className="space-y-6">
          {/* Top KPI cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total invoices"
              value={String(d.totalInvoices)}
              icon={FileText}
              color="blue"
            />
            <StatCard
              label="Total invoiced"
              value={fmtINR(d.totalInvoicedAmount)}
              icon={IndianRupee}
              color="slate"
            />
            <StatCard
              label="Collected"
              value={fmtINR(d.totalCollectedAmount)}
              sub={`${collectionRate}% collection rate`}
              icon={CheckCircle2}
              color="green"
            />
            <StatCard
              label="Pending"
              value={fmtINR(d.pendingAmount)}
              sub={`${d.pendingInvoices} invoices`}
              icon={Clock}
              color="yellow"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Overdue"
              value={fmtINR(d.overdueAmount)}
              sub={`${d.overdueInvoices} invoices`}
              icon={AlertTriangle}
              color="red"
            />
            <StatCard
              label="Cash payments"
              value={fmtINR(d.cashAmount)}
              sub={`${d.cashPayments} transactions`}
              icon={Banknote}
              color="orange"
            />
            <StatCard
              label="Online payments"
              value={fmtINR(d.onlineAmount)}
              sub={`${d.onlinePayments} transactions`}
              icon={CreditCard}
              color="purple"
            />
            <StatCard
              label="Paid invoices"
              value={String(d.paidInvoices)}
              sub={`of ${d.totalInvoices} total`}
              icon={TrendingUp}
              color="emerald"
            />
          </div>

          {/* Charts row 1: Monthly revenue + consumption */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <IndianRupee className="h-5 w-5" />
                  Monthly Revenue
                </CardTitle>
                <CardDescription>Invoiced vs collected per month (last 12 months)</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                {d.monthlyTrends.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.monthlyTrends} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis
                        fontSize={10}
                        tick={{ fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(v) => `\u20b9${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(v: number) => [fmtINRDecimal(v)]}
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Legend />
                      <Bar dataKey="totalInvoiced" name="Invoiced" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="totalCollected" name="Collected" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                    No data yet
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Droplets className="h-5 w-5" />
                  Monthly Consumption
                </CardTitle>
                <CardDescription>Total water usage billed per month</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                {d.monthlyTrends.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={d.monthlyTrends} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" fontSize={10} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis
                        fontSize={10}
                        tick={{ fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}kL`}
                      />
                      <Tooltip
                        formatter={(v: number) => [`${v.toLocaleString("en-IN")} L`, "Consumption"]}
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="totalConsumption"
                        name="Consumption (L)"
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        dot={{ r: 4, fill: "#0ea5e9" }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                    No data yet
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Charts row 2: Status breakdown + Payment method */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Invoice status
                </CardTitle>
                <CardDescription>Distribution by status</CardDescription>
              </CardHeader>
              <CardContent className="h-56 flex items-center justify-center">
                {statusPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                        label={({ name, percent }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                      >
                        {statusPieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => [v, "invoices"]}
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground">No invoices yet</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Payment methods
                </CardTitle>
                <CardDescription>Cash vs online collections</CardDescription>
              </CardHeader>
              <CardContent className="h-56 flex items-center justify-center">
                {methodPieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={methodPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                        label={({ name, percent }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                      >
                        {methodPieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => [fmtINRDecimal(v), "amount"]}
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground">No payments yet</p>
                )}
              </CardContent>
            </Card>

            {/* Monthly invoice count */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Monthly invoices
                </CardTitle>
                <CardDescription>Count generated vs paid</CardDescription>
              </CardHeader>
              <CardContent className="h-56">
                {d.monthlyTrends.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.monthlyTrends} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" fontSize={9} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis fontSize={9} tick={{ fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="invoiceCount" name="Generated" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="paidCount" name="Paid" fill="#22c55e" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                    No data yet
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Monthly table */}
          {d.monthlyTrends.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Month-by-month breakdown</CardTitle>
                <CardDescription>Detailed billing summary for each month</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Month</th>
                        <th className="px-4 py-3">Invoices</th>
                        <th className="px-4 py-3">Paid</th>
                        <th className="px-4 py-3">Invoiced</th>
                        <th className="px-4 py-3">Collected</th>
                        <th className="px-4 py-3">Consumption</th>
                        <th className="px-4 py-3">Collection %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {[...d.monthlyTrends].reverse().map((m) => {
                        const rate =
                          m.totalInvoiced > 0
                            ? ((m.totalCollected / m.totalInvoiced) * 100).toFixed(1)
                            : "0.0";
                        return (
                          <tr key={m.month} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-medium">{m.label}</td>
                            <td className="px-4 py-3">{m.invoiceCount}</td>
                            <td className="px-4 py-3">
                              <Badge variant={m.paidCount === m.invoiceCount && m.invoiceCount > 0 ? "default" : "secondary"}>
                                {m.paidCount}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">{fmtINRDecimal(m.totalInvoiced)}</td>
                            <td className="px-4 py-3 text-green-700 dark:text-green-400 font-medium">
                              {fmtINRDecimal(m.totalCollected)}
                            </td>
                            <td className="px-4 py-3">{m.totalConsumption.toLocaleString("en-IN")} L</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden max-w-[80px]">
                                  <div
                                    className="h-full rounded-full bg-green-500"
                                    style={{ width: `${Math.min(100, parseFloat(rate))}%` }}
                                  />
                                </div>
                                <span className="text-xs text-muted-foreground">{rate}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}
    </DashboardLayout>
  );
}