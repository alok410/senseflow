import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  FileText, CreditCard, Wallet, History, CheckCircle2, Clock, AlertTriangle,
  Loader2, IndianRupee, Search, Download, XCircle, Banknote,
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
import { useSession, useMyProfile } from "@/hooks/use-session";
import { CONSUMER_NAV } from "@/lib/nav";
import { getMyInvoices, getMyInvoiceDetail, type InvoiceRow } from "@/lib/invoices.functions";
import { initiatePayment, simulatePaymentResult, getMyDummyPayments } from "@/lib/payment.functions";
import { InvoicePrintModal } from "@/components/InvoicePrintModal";

export const Route = createFileRoute("/_authenticated/consumer/invoices")({
  component: ConsumerInvoices,
});

// ── helpers ──────────────────────────────────────────────────────
function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "paid")    return "default";
  if (s === "overdue") return "destructive";
  return "secondary";
}
function statusLabel(s: string) {
  if (s === "published" || s === "pending" || s === "approved") return "Due";
  if (s === "paid")    return "Paid";
  if (s === "overdue") return "Overdue";
  return s;
}
const fmtINR = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ─────────────────────────────────────────────────────────────────
function ConsumerInvoices() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const getMyInvoicesFn    = useServerFn(getMyInvoices);
  const getMyInvoiceDetFn  = useServerFn(getMyInvoiceDetail);
  const initiatePayFn      = useServerFn(initiatePayment);
  const simulateResultFn   = useServerFn(simulatePaymentResult);
  const getPayHistoryFn    = useServerFn(getMyDummyPayments);

  const [search,       setSearch]      = useState("");
  const [printInvoice, setPrintInvoice] = useState<InvoiceRow | null>(null);
  const [detailInv,    setDetailInv]   = useState<InvoiceRow | null>(null);
  const [payDialog,    setPayDialog]   = useState<InvoiceRow | null>(null);

  // Payment flow state
  const [currentPayId, setCurrentPayId] = useState<string | null>(null);
  const [payStep,      setPayStep]      = useState<"checkout" | "result">("checkout");
  const [payResult,    setPayResult]    = useState<"SUCCESS" | "FAILED" | null>(null);
  const [payTxRef,     setPayTxRef]     = useState<string | null>(null);

  // ── Queries ───────────────────────────────────────────────────
  const invoicesQ = useQuery({
    queryKey: ["my-invoices", user?.id],
    enabled: !!user?.id,
    queryFn: () => getMyInvoicesFn({ data: { consumerId: user!.id, pageSize: 50 } }),
  });

  const invoiceRows: InvoiceRow[] = (invoicesQ.data as any)?.rows ?? [];

  const payHistoryQ = useQuery({
    queryKey: ["my-pay-history", user?.id],
    enabled: !!user?.id,
    queryFn: () => getPayHistoryFn({ data: { consumerId: user!.id } }),
  });

  // ── Filtered list ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoiceRows;
    return invoiceRows.filter((i) =>
      (i.invoice_number || "").toLowerCase().includes(q) ||
      (i.billing_month  || "").includes(q)
    );
  }, [invoiceRows, search]);

  // Summary stats
  const stats = useMemo(() => {
    const unpaid = invoiceRows.filter((i) => ["published","pending","approved","overdue"].includes(i.status));
    const paid   = invoiceRows.filter((i) => i.status === "paid");
    return {
      outstanding: unpaid.reduce((s, i) => s + Number(i.total_amount), 0),
      unpaidCount: unpaid.length,
      paidCount:   paid.length,
    };
  }, [invoiceRows]);

  // ── Mutations ─────────────────────────────────────────────────
  const initPayMut = useMutation({
    mutationFn: (inv: InvoiceRow) =>
      initiatePayFn({ data: { invoiceId: inv.id, consumerId: user!.id } }),
    onSuccess: (r: any) => {
      if (r.alreadyPaid) { toast.info("This invoice is already paid."); return; }
      setCurrentPayId(r.paymentId);
      setPayStep("checkout");
      setPayResult(null);
    },
    onError: (e: any) => toast.error(e.message || "Could not initiate payment"),
  });

  const simulateMut = useMutation({
    mutationFn: (result: "success" | "failure") =>
      simulateResultFn({ data: { paymentId: currentPayId!, consumerId: user!.id, result } }),
    onSuccess: (r: any) => {
      setPayStep("result");
      setPayResult(r.status);
      setPayTxRef(r.transactionRef ?? null);
      if (r.status === "SUCCESS") {
        qc.invalidateQueries({ queryKey: ["my-invoices"] });
        qc.invalidateQueries({ queryKey: ["my-pay-history"] });
      }
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  function openPayDialog(inv: InvoiceRow) {
    setPayDialog(inv);
    setCurrentPayId(null);
    setPayStep("checkout");
    setPayResult(null);
    setPayTxRef(null);
    // Auto-initiate
    initPayMut.mutate(inv);
  }

  function closePayDialog() {
    setPayDialog(null);
    setCurrentPayId(null);
    setPayStep("checkout");
    setPayResult(null);
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <DashboardLayout navItems={CONSUMER_NAV} title="My Invoices & Payments"
      userName={profile?.full_name || null} userPhone={profile?.phone || null}>

      {/* Summary cards */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="border-red-200 bg-red-50/60 dark:bg-red-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-8 w-8 text-red-600" />
            <div>
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="text-lg font-bold">{fmtINR(stats.outstanding)}</p>
              <p className="text-xs text-muted-foreground">{stats.unpaidCount} invoice(s)</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/60 dark:bg-green-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
            <div>
              <p className="text-xs text-muted-foreground">Paid invoices</p>
              <p className="text-lg font-bold">{stats.paidCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-blue-50/60 dark:bg-blue-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <FileText className="h-8 w-8 text-blue-600" />
            <div>
              <p className="text-xs text-muted-foreground">Total invoices</p>
              <p className="text-lg font-bold">{invoiceRows.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="invoices">
        <TabsList className="mb-4">
          <TabsTrigger value="invoices"><FileText className="mr-2 h-4 w-4" />Invoices</TabsTrigger>
          <TabsTrigger value="payments"><History className="mr-2 h-4 w-4" />Payment History</TabsTrigger>
        </TabsList>

        {/* ── Invoices tab ──────────────────────────────── */}
        <TabsContent value="invoices">
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by invoice # or month…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {invoicesQ.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((inv) => (
                <Card key={inv.id} className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-4 p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{inv.invoice_number || "Invoice"}</span>
                        <Badge variant={statusVariant(inv.status)}>{statusLabel(inv.status)}</Badge>
                        {inv.status === "overdue" && (
                          <span className="text-xs text-red-600 font-medium">Late fee applied</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {inv.billing_month || inv.bill_period_start?.slice(0,7) || "—"}
                        {" · "}
                        {Number(inv.consumption).toLocaleString("en-IN")} L
                        {inv.due_date && (
                          <> · Due {format(new Date(inv.due_date), "dd MMM yyyy")}</>
                        )}
                      </p>
                      {inv.paid_at && (
                        <p className="text-xs text-green-600 mt-0.5">
                          <CheckCircle2 className="inline h-3 w-3 mr-0.5" />
                          Paid on {format(new Date(inv.paid_at), "dd MMM yyyy")}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold">{fmtINR(Number(inv.total_amount))}</p>
                      <div className="mt-1.5 flex gap-1.5 justify-end">
                        <Button size="sm" variant="outline" onClick={() => setDetailInv(inv)}>
                          View
                        </Button>
                        <Button size="sm" variant="ghost" title="Download PDF" onClick={() => setPrintInvoice(inv)}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        {["published","pending","approved","overdue"].includes(inv.status) && (
                          <Button size="sm" onClick={() => openPayDialog(inv)} className="bg-green-600 hover:bg-green-700 text-white">
                            <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Pay Now
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {!filtered.length && (
                <div className="py-16 text-center text-muted-foreground">
                  <FileText className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  <p>No invoices yet.</p>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── Payment history tab ───────────────────────── */}
        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle>Payment History</CardTitle>
              <CardDescription>All your payment attempts</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {payHistoryQ.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left">Date</th>
                        <th className="px-4 py-3 text-left">Transaction Ref</th>
                        <th className="px-4 py-3 text-left">Amount</th>
                        <th className="px-4 py-3 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {((payHistoryQ.data as any[]) ?? []).map((p: any) => (
                        <tr key={p.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3 text-xs">{format(new Date(p.created_at), "dd MMM yyyy, hh:mm a")}</td>
                          <td className="px-4 py-3 font-mono text-xs">{p.transaction_ref || "—"}</td>
                          <td className="px-4 py-3 font-semibold">{fmtINR(Number(p.amount))}</td>
                          <td className="px-4 py-3">
                            {p.status === "SUCCESS" && <Badge variant="default"><CheckCircle2 className="mr-1 h-3 w-3" />Success</Badge>}
                            {p.status === "FAILED"  && <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Failed</Badge>}
                            {p.status === "INITIATED" && <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Pending</Badge>}
                          </td>
                        </tr>
                      ))}
                      {!((payHistoryQ.data as any[])?.length) && (
                        <tr>
                          <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No payment history.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Invoice detail dialog ─────────────────────────────── */}
      <Dialog open={!!detailInv} onOpenChange={(o) => !o && setDetailInv(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailInv?.invoice_number || "Invoice"}</DialogTitle>
            <DialogDescription>
              {detailInv?.billing_month || detailInv?.bill_period_start?.slice(0,7)}
            </DialogDescription>
          </DialogHeader>
          {detailInv && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-muted/40 p-4 space-y-1.5">
                <Row label="Period">
                  {format(new Date(detailInv.bill_period_start), "dd MMM yyyy")} – {format(new Date(detailInv.bill_period_end), "dd MMM yyyy")}
                </Row>
                <Row label="Consumption">{Number(detailInv.consumption).toLocaleString("en-IN")} L</Row>
                <Row label="Free tier">{Number(detailInv.free_consumption).toLocaleString("en-IN")} L</Row>
                <Row label="Chargeable">{Number(detailInv.chargeable_consumption).toLocaleString("en-IN")} L</Row>
                <Row label="Rate">₹{Number(detailInv.rate_applied).toFixed(4)}/L</Row>
                <div className="border-t pt-1.5">
                  <Row label="Water charge">{fmtINR(Number(detailInv.amount))}</Row>
                  {Number(detailInv.base_charge) > 0 && <Row label="Base charge">{fmtINR(Number(detailInv.base_charge))}</Row>}
                  {Number(detailInv.other_charges) > 0 && <Row label="Other charges">{fmtINR(Number(detailInv.other_charges))}</Row>}
                  {Number(detailInv.arrears) > 0 && <Row label="Arrears">{fmtINR(Number(detailInv.arrears))}</Row>}
                  {Number(detailInv.late_fee) > 0 && <Row label="Late fee">{fmtINR(Number(detailInv.late_fee))}</Row>}
                </div>
                <div className="border-t pt-1.5 flex items-center justify-between">
                  <span className="font-semibold text-muted-foreground">Total</span>
                  <span className="text-xl font-bold">{fmtINR(Number(detailInv.total_amount))}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(detailInv.status)}>{statusLabel(detailInv.status)}</Badge>
                <span className="text-xs text-muted-foreground">Due {format(new Date(detailInv.due_date), "dd MMM yyyy")}</span>
              </div>
              {detailInv.paid_at && (
                <p className="text-xs text-green-600">
                  <CheckCircle2 className="inline h-3 w-3 mr-0.5" />
                  Paid on {format(new Date(detailInv.paid_at), "dd MMM yyyy, hh:mm a")}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => { setPrintInvoice(detailInv); setDetailInv(null); }}>
                  <Download className="mr-2 h-3.5 w-3.5" /> Download PDF
                </Button>
                {["published","pending","approved","overdue"].includes(detailInv.status) && (
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => { setDetailInv(null); openPayDialog(detailInv); }}>
                    <CreditCard className="mr-2 h-3.5 w-3.5" /> Pay Now
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Dummy Checkout dialog ─────────────────────────────── */}
      <Dialog open={!!payDialog} onOpenChange={(o) => { if (!o) closePayDialog(); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {payStep === "result" ? (payResult === "SUCCESS" ? "Payment Successful 🎉" : "Payment Failed") : "Checkout"}
            </DialogTitle>
            <DialogDescription>
              {payDialog?.invoice_number} · {fmtINR(Number(payDialog?.total_amount || 0))}
            </DialogDescription>
          </DialogHeader>

          {/* Loading while initiating */}
          {initPayMut.isPending && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Preparing checkout…</p>
            </div>
          )}

          {/* Checkout screen */}
          {!initPayMut.isPending && payStep === "checkout" && currentPayId && (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/40 p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Amount to Pay</p>
                <p className="text-3xl font-bold text-primary">{fmtINR(Number(payDialog?.total_amount || 0))}</p>
                <p className="text-xs text-muted-foreground mt-1">{payDialog?.invoice_number}</p>
              </div>
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                🧪 <strong>Demo Mode</strong> — No real money will be charged. Click a button below to simulate the payment result.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => simulateMut.mutate("success")}
                  disabled={simulateMut.isPending}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {simulateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Simulate Success
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => simulateMut.mutate("failure")}
                  disabled={simulateMut.isPending}
                >
                  {simulateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                  Simulate Failure
                </Button>
              </div>
            </div>
          )}

          {/* Result screen */}
          {payStep === "result" && payResult === "SUCCESS" && (
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <div className="rounded-full bg-green-100 p-6">
                  <CheckCircle2 className="h-12 w-12 text-green-600" />
                </div>
              </div>
              <div>
                <p className="font-semibold">Payment of {fmtINR(Number(payDialog?.total_amount||0))} received!</p>
                {payTxRef && <p className="text-xs text-muted-foreground mt-1">Ref: {payTxRef}</p>}
              </div>
              <Button onClick={closePayDialog} className="w-full">Done</Button>
            </div>
          )}
          {payStep === "result" && payResult === "FAILED" && (
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <div className="rounded-full bg-red-100 p-6">
                  <XCircle className="h-12 w-12 text-red-600" />
                </div>
              </div>
              <p className="font-semibold text-red-700">Payment failed. Please try again.</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={closePayDialog}>Cancel</Button>
                <Button className="flex-1" onClick={() => { setPayStep("checkout"); }}>Try Again</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <InvoicePrintModal invoice={printInvoice} onClose={() => setPrintInvoice(null)} />
    </DashboardLayout>
  );
}

// Tiny helper component
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
