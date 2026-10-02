import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  FileText, CreditCard, Wallet, History, CheckCircle2, Clock, AlertTriangle,
  Loader2, IndianRupee, Search, Download,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { CONSUMER_NAV } from "@/lib/nav";
import { listInvoices, payInvoiceFromPrepaid, type InvoiceRow } from "@/lib/invoices.functions";
import { getConsumerPaymentHistory, type PaymentHistoryRow } from "@/lib/razorpay.functions";
import { InvoicePrintModal } from "@/components/InvoicePrintModal";

const ALL = "all";

export const Route = createFileRoute("/_authenticated/consumer/invoices")({
  component: ConsumerInvoices,
});

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "paid") return "default";
  if (s === "overdue") return "destructive";
  return "secondary";
}

function methodLabel(m: string) {
  if (m === "manual") return "Cash";
  if (m === "online") return "Online";
  if (m === "prepaid_recharge") return "Prepaid";
  return m;
}

function methodIcon(m: string) {
  if (m === "manual") return <IndianRupee className="h-3 w-3" />;
  if (m === "online") return <CreditCard className="h-3 w-3" />;
  if (m === "prepaid_recharge") return <Wallet className="h-3 w-3" />;
  return null;
}

const fmtINR = (n: number) =>
  `\u20b9${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ConsumerInvoices() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const listFn = useServerFn(listInvoices);
  const payPrepaidFn = useServerFn(payInvoiceFromPrepaid);
  const getHistoryFn = useServerFn(getConsumerPaymentHistory);

  const [statusFilter, setStatusFilter] = useState(ALL);
  const [search, setSearch] = useState("");
  const [payDialog, setPayDialog] = useState<InvoiceRow | null>(null);
  const [viewing, setViewing] = useState<InvoiceRow | null>(null);
  const [printInvoice, setPrintInvoice] = useState<InvoiceRow | null>(null);
  const [payMethod, setPayMethod] = useState<"online" | "prepaid">("prepaid");

  const invoices = useQuery({
    queryKey: ["consumer-invoices", user?.id, statusFilter],
    enabled: !!user,
    queryFn: async () =>
      listFn({
        data: {
          consumerId: user!.id,
          status: statusFilter === ALL ? undefined : statusFilter,
        },
      }) as Promise<InvoiceRow[]>,
  });

  const balance = useQuery({
    queryKey: ["consumer-balance", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("prepaid_balances")
        .select("balance")
        .eq("consumer_id", user!.id)
        .maybeSingle();
      return Number(data?.balance ?? 0);
    },
  });

  const history = useQuery({
    queryKey: ["consumer-payment-history", user?.id],
    enabled: !!user,
    queryFn: async () =>
      getHistoryFn({ data: { consumerId: user!.id } }) as Promise<PaymentHistoryRow[]>,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (invoices.data || []).filter((i) => {
      if (!q) return true;
      return i.id.toLowerCase().includes(q) || (i.bill_period_start || "").includes(q);
    });
  }, [invoices.data, search]);

  const stats = useMemo(() => {
    const all = invoices.data || [];
    const paid = all.filter((i) => i.status === "paid");
    const pending = all.filter((i) => i.status === "pending" || i.status === "overdue");
    return {
      totalInvoices: all.length,
      paidCount: paid.length,
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, i) => s + Number(i.total_amount), 0),
      paidAmount: paid.reduce((s, i) => s + Number(i.total_amount), 0),
    };
  }, [invoices.data]);

  const selectedInvoice = payDialog;
  const canPayWithPrepaid =
    !!selectedInvoice && (balance.data ?? 0) >= Number(selectedInvoice.total_amount);

  const prepaidMut = useMutation({
    mutationFn: async () => {
      if (!selectedInvoice || !user) throw new Error("No invoice selected");
      return payPrepaidFn({ data: { invoiceId: selectedInvoice.id, consumerId: user.id } });
    },
    onSuccess: (r: any) => {
      toast.success(r.alreadyPaid ? "Already paid." : "Paid from prepaid balance!");
      setPayDialog(null);
      qc.invalidateQueries({ queryKey: ["consumer-invoices"] });
      qc.invalidateQueries({ queryKey: ["consumer-balance"] });
      qc.invalidateQueries({ queryKey: ["consumer-payment-history"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Payment failed"),
  });

  const handleRazorpayPay = async () => {
    if (!selectedInvoice || !user) return;
    setRazorpayLoading(true);
    const invId = selectedInvoice.id;
    const consumerId = user.id;
    try {
      const amountPaise = Math.round(Number(selectedInvoice.total_amount) * 100);
      const order = await createOrderFn({
        data: { invoiceId: invId, consumerId, amountPaise },
      });

      if (!(window as any).Razorpay) {
        await new Promise<void>((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.onload = () => res();
          s.onerror = () => rej(new Error("Failed to load Razorpay script"));
          document.body.appendChild(s);
        });
      }

      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "SenseFlow Water",
        description: `Invoice ${order.invoiceNumber}`,
        order_id: order.orderId,
        prefill: {
          name: profile?.full_name ?? "",
          contact: profile?.phone ?? "",
        },
        theme: { color: "#2563eb" },
        handler: async (response: any) => {
          try {
            await verifyFn({
              data: {
                invoiceId: invId,
                consumerId,
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              },
            });
            toast.success("Payment successful! Invoice marked as paid.");
            setPayDialog(null);
            qc.invalidateQueries({ queryKey: ["consumer-invoices"] });
            qc.invalidateQueries({ queryKey: ["consumer-payment-history"] });
            qc.invalidateQueries({ queryKey: ["consumer-dashboard"] });
          } catch (e: any) {
            toast.error(e?.message ?? "Payment verification failed");
          } finally {
            setRazorpayLoading(false);
          }
        },
        modal: { ondismiss: () => setRazorpayLoading(false) },
      });
      rzp.open();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not initiate payment");
      setRazorpayLoading(false);
    }
  };

  return (
    <DashboardLayout
      navItems={CONSUMER_NAV}
      title="My Invoices"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      {/* Summary cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <FileText className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            <div>
              <p className="text-xs text-muted-foreground">Total invoices</p>
              <p className="text-xl font-bold">{stats.totalInvoices}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/60 dark:border-green-900 dark:bg-green-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            <div>
              <p className="text-xs text-muted-foreground">Paid</p>
              <p className="text-xl font-bold">{stats.paidCount}</p>
              <p className="text-xs text-green-600">{fmtINR(stats.paidAmount)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-yellow-200 bg-yellow-50/60 dark:border-yellow-900 dark:bg-yellow-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
            <div>
              <p className="text-xs text-muted-foreground">Pending / Due</p>
              <p className="text-xl font-bold">{stats.pendingCount}</p>
              <p className="text-xs text-yellow-600">{fmtINR(stats.pendingAmount)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-purple-200 bg-purple-50/60 dark:border-purple-900 dark:bg-purple-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <Wallet className="h-8 w-8 text-purple-600 dark:text-purple-400" />
            <div>
              <p className="text-xs text-muted-foreground">Prepaid balance</p>
              <p className="text-xl font-bold">{fmtINR(balance.data ?? 0)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="invoices">
        <TabsList className="mb-4">
          <TabsTrigger value="invoices">
            <FileText className="mr-2 h-4 w-4" />Invoices
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-2 h-4 w-4" />Payment history
          </TabsTrigger>
        </TabsList>

        {/* Invoices tab */}
        <TabsContent value="invoices">
          <div className="mb-4 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search invoices…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              {invoices.isLoading ? (
                <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-sm">Loading invoices…</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Period</TableHead>
                        <TableHead>Consumption</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Due date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((i) => (
                        <TableRow key={i.id} className="hover:bg-muted/30 transition-colors">
                          <TableCell className="text-xs font-medium">
                            {format(new Date(i.bill_period_start), "dd MMM")} –{" "}
                            {format(new Date(i.bill_period_end), "dd MMM yyyy")}
                          </TableCell>
                          <TableCell>{Number(i.consumption).toLocaleString("en-IN")} L</TableCell>
                          <TableCell className="font-semibold">{fmtINR(Number(i.total_amount))}</TableCell>
                          <TableCell className="text-xs">
                            {format(new Date(i.due_date), "dd MMM yyyy")}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(i.status)}>
                              {i.status === "overdue" && <AlertTriangle className="mr-1 h-3 w-3" />}
                              {i.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="ghost" onClick={() => setViewing(i)}>
                              View
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPrintInvoice(i)} title="Download PDF">
                              <Download className="h-3.5 w-3.5 text-blue-600" />
                            </Button>
                            {i.status !== "paid" && (
                              <Button
                                size="sm"
                                className="ml-1"
                                onClick={() => {
                                  setPayDialog(i);
                                  setPayMethod("prepaid");
                                }}
                              >
                                <Wallet className="mr-1 h-3 w-3" />
                                Pay
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {!filtered.length && !invoices.isLoading && (
                        <TableRow>
                          <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                            <FileText className="mx-auto mb-2 h-8 w-8 opacity-30" />
                            <p>No invoices found.</p>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payment history tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Transaction history</CardTitle>
              <CardDescription>All payment transactions on your account</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {history.isLoading ? (
                <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-sm">Loading history…</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Invoice / Type</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Transaction ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(history.data || []).map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs">
                            {format(new Date(p.created_at), "dd MMM yyyy, hh:mm a")}
                          </TableCell>
                          <TableCell>
                            {p.invoice_number ? (
                              <div>
                                <div className="font-medium text-sm">{p.invoice_number}</div>
                                {p.bill_period_start && (
                                  <div className="text-xs text-muted-foreground">
                                    {format(new Date(p.bill_period_start), "MMM yyyy")}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">Prepaid recharge</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="gap-1">
                              {methodIcon(p.method)}
                              {methodLabel(p.method)}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-semibold text-green-700 dark:text-green-400">
                            {fmtINR(p.amount)}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {p.razorpay_payment_id || p.transaction_id || "\u2014"}
                          </TableCell>
                        </TableRow>
                      ))}
                      {!history.data?.length && !history.isLoading && (
                        <TableRow>
                          <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                            <History className="mx-auto mb-2 h-8 w-8 opacity-30" />
                            <p>No transactions yet.</p>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* View invoice dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invoice details</DialogTitle>
            {viewing && (
              <DialogDescription>
                {format(new Date(viewing.bill_period_start), "dd MMM yyyy")} -{" "}
                {format(new Date(viewing.bill_period_end), "dd MMM yyyy")}
              </DialogDescription>
            )}
          </DialogHeader>
          {viewing && (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Consumption</p>
                    <p className="font-semibold">{Number(viewing.consumption).toLocaleString("en-IN")} L</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Free tier</p>
                    <p className="font-semibold">{Number(viewing.free_consumption).toLocaleString("en-IN")} L</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Chargeable</p>
                    <p className="font-semibold">{Number(viewing.chargeable_consumption).toLocaleString("en-IN")} L</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Rate</p>
                    <p className="font-semibold">\u20b9{Number(viewing.rate_applied).toFixed(4)}/L</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Water charges</p>
                    <p className="font-semibold">{fmtINR(Number(viewing.amount))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Late fee</p>
                    <p className="font-semibold">{fmtINR(Number(viewing.late_fee))}</p>
                  </div>
                </div>
                <div className="border-t pt-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Total amount</p>
                    <p className="text-2xl font-bold">{fmtINR(Number(viewing.total_amount))}</p>
                  </div>
                  <Badge variant={statusVariant(viewing.status)} className="text-sm">
                    {viewing.status}
                  </Badge>
                </div>
                {viewing.paid_at && (
                  <p className="text-xs text-muted-foreground">
                    Paid on {format(new Date(viewing.paid_at), "dd MMM yyyy, hh:mm a")}
                  </p>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Due date</p>
                  <p className="text-sm font-medium">{format(new Date(viewing.due_date), "dd MMM yyyy")}</p>
                </div>
              </div>
              {viewing.status !== "paid" && (
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => { setPrintInvoice(viewing); setViewing(null); }}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download PDF
                  </Button>
                  <Button
                    onClick={() => {
                      setViewing(null);
                      setPayDialog(viewing);
                      setPayMethod("prepaid");
                    }}
                  >
                    <Wallet className="mr-2 h-4 w-4" />
                    Pay now
                  </Button>
                </DialogFooter>
              )}
              {viewing.status === "paid" && (
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => { setPrintInvoice(viewing); setViewing(null); }}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download PDF
                  </Button>
                </DialogFooter>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Pay invoice dialog */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay invoice</DialogTitle>
            <DialogDescription>
              {payDialog &&
                `${format(new Date(payDialog.bill_period_start), "MMM yyyy")} \u2014 ${fmtINR(Number(payDialog.total_amount))}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-xl border bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 p-5 text-center">
              <p className="text-xs text-muted-foreground mb-1">Amount due</p>
              <p className="text-4xl font-bold text-blue-700 dark:text-blue-300">
                {fmtINR(Number(payDialog?.total_amount ?? 0))}
              </p>
            </div>

            <Tabs value={payMethod} onValueChange={(v) => setPayMethod(v as "online" | "prepaid")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="online">
                  <CreditCard className="mr-2 h-4 w-4" />
                  Online
                </TabsTrigger>
                <TabsTrigger value="prepaid">
                  <Wallet className="mr-2 h-4 w-4" />
                  Prepaid
                </TabsTrigger>
              </TabsList>
              <TabsContent value="online" className="mt-3">
                <div className="rounded-lg border border-dashed p-4 text-sm text-center space-y-1">
                  <CreditCard className="mx-auto h-7 w-7 text-muted-foreground mb-2" />
                  <p className="font-medium text-muted-foreground">Online payment coming soon</p>
                  <p className="text-xs text-muted-foreground">
                    Use your prepaid balance to pay this invoice, or ask your administrator to mark it paid manually.
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="prepaid" className="mt-3">
                <div className="rounded-lg border p-3 text-sm space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Available balance</span>
                    <span className="font-bold text-lg">{fmtINR(balance.data ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Invoice amount</span>
                    <span className="font-semibold">{fmtINR(Number(payDialog?.total_amount ?? 0))}</span>
                  </div>
                  {!canPayWithPrepaid && (
                    <p className="text-xs text-destructive font-medium">
                      Insufficient balance. Please recharge or use online payment.
                    </p>
                  )}
                  {canPayWithPrepaid && (
                    <div className="flex justify-between items-center border-t pt-2">
                      <span className="text-muted-foreground text-xs">Balance after payment</span>
                      <span className="text-sm font-medium text-green-600">
                        {fmtINR((balance.data ?? 0) - Number(payDialog?.total_amount ?? 0))}
                      </span>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayDialog(null)}>
              Cancel
            </Button>
            {payMethod === "online" ? (
              <Button variant="outline" disabled className="opacity-50">
                <CreditCard className="mr-2 h-4 w-4" />
                Coming soon
              </Button>
            ) : (
              <Button
                onClick={() => prepaidMut.mutate()}
                disabled={prepaidMut.isPending || !canPayWithPrepaid}
              >
                {prepaidMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Wallet className="mr-2 h-4 w-4" />
                Pay from balance
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>

    {/* Invoice PDF print modal */}
    <InvoicePrintModal
      invoice={printInvoice}
      onClose={() => setPrintInvoice(null)}
    />
  );
}
