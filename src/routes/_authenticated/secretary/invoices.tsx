import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Search, Eye, CheckCircle, Loader2, FileText, IndianRupee, AlertTriangle,
  Banknote, Plus, RefreshCw,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { SECRETARY_NAV } from "@/lib/nav";
import {
  listInvoices,
  markInvoicePaid,
  generateInvoice,
  markOverdueInvoices,
  type InvoiceRow,
} from "@/lib/invoices.functions";
import { supabase } from "@/integrations/supabase/client";

const ALL = "all";

export const Route = createFileRoute("/_authenticated/secretary/invoices")({
  component: SecretaryInvoices,
});

function statusVariant(s: string): "default" | "secondary" | "destructive" {
  if (s === "paid") return "default";
  if (s === "overdue") return "destructive";
  return "secondary";
}

const fmtINR = (n: number) =>
  `\u20b9${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function SecretaryInvoices() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const listFn = useServerFn(listInvoices);
  const markPaidFn = useServerFn(markInvoicePaid);
  const generateFn = useServerFn(generateInvoice);
  const markOverdueFn = useServerFn(markOverdueInvoices);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [viewing, setViewing] = useState<InvoiceRow | null>(null);
  const [payDialog, setPayDialog] = useState<InvoiceRow | null>(null);
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<"manual" | "online" | "prepaid_recharge">("manual");

  // Generate invoice form
  const [genOpen, setGenOpen] = useState(false);
  const [genConsumer, setGenConsumer] = useState("");
  const [genStart, setGenStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [genEnd, setGenEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [genLateFee, setGenLateFee] = useState("0");
  const [genDueDays, setGenDueDays] = useState("15");

  const list = useQuery({
    queryKey: ["secretary-invoices", user?.id, statusFilter],
    enabled: !!user,
    queryFn: async () =>
      listFn({
        data: {
          secretaryId: user!.id,
          status: statusFilter === ALL ? undefined : statusFilter,
        },
      }) as Promise<InvoiceRow[]>,
  });

  // Consumers managed by this secretary
  const consumers = useQuery({
    queryKey: ["secretary-consumers-for-gen", user?.id],
    enabled: genOpen && !!user,
    queryFn: async () => {
      // Get location IDs for this secretary
      const { data: secLocs } = await supabase
        .from("secretary_locations")
        .select("location_id")
        .eq("secretary_id", user!.id);
      const locationIds = (secLocs || []).map((r: any) => r.location_id);
      if (!locationIds.length) return [];

      const { data: details } = await supabase
        .from("consumer_details")
        .select("user_id, profiles(full_name, phone)")
        .in("location_id", locationIds);
      return (details || []).map((d: any) => ({
        id: d.user_id,
        full_name: d.profiles?.full_name ?? null,
        phone: d.profiles?.phone ?? null,
      }));
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data || []).filter((i) => {
      if (!q) return true;
      return (
        (i.consumer_name || "").toLowerCase().includes(q) ||
        (i.consumer_phone || "").toLowerCase().includes(q) ||
        (i.block_id || "").toLowerCase().includes(q)
      );
    });
  }, [list.data, search]);

  const stats = useMemo(() => {
    const all = list.data || [];
    return {
      pending: all.filter((i) => i.status === "pending").reduce((s, i) => s + Number(i.total_amount), 0),
      pendingCount: all.filter((i) => i.status === "pending").length,
      overdue: all.filter((i) => i.status === "overdue").reduce((s, i) => s + Number(i.total_amount), 0),
      overdueCount: all.filter((i) => i.status === "overdue").length,
      collected: all.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.total_amount), 0),
      collectedCount: all.filter((i) => i.status === "paid").length,
    };
  }, [list.data]);

  const payMut = useMutation({
    mutationFn: () => {
      if (!payDialog) throw new Error("");
      return markPaidFn({ data: { invoiceId: payDialog.id, notes: notes || undefined, method } });
    },
    onSuccess: (r) => {
      toast.success(r.alreadyPaid ? "Already paid." : "Marked as paid.");
      setPayDialog(null);
      setNotes("");
      setMethod("manual");
      qc.invalidateQueries({ queryKey: ["secretary-invoices"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const genMut = useMutation({
    mutationFn: () => {
      if (!genConsumer) throw new Error("Select a consumer.");
      return generateFn({
        data: {
          consumerId: genConsumer,
          periodStart: genStart,
          periodEnd: genEnd,
          lateFee: parseFloat(genLateFee) || 0,
          dueDays: parseInt(genDueDays) || 15,
        },
      });
    },
    onSuccess: (r) => {
      toast.success(
        `Invoice generated \u2014 ${fmtINR(Number(r.totalAmount))} for ${Number(r.consumption).toLocaleString("en-IN")} L`,
      );
      setGenOpen(false);
      qc.invalidateQueries({ queryKey: ["secretary-invoices"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const overdueMut = useMutation({
    mutationFn: () => markOverdueFn({ data: undefined }),
    onSuccess: (r) => {
      toast.success(`${r.updatedCount} invoice(s) marked overdue.`);
      qc.invalidateQueries({ queryKey: ["secretary-invoices"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <DashboardLayout
      navItems={SECRETARY_NAV}
      title="Invoices"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      {/* Summary stats */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="border-yellow-200 bg-yellow-50/60 dark:border-yellow-900 dark:bg-yellow-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <FileText className="h-8 w-8 text-yellow-600" />
            <div>
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-lg font-bold">
                {stats.pendingCount} \u00b7 {fmtINR(stats.pending)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-8 w-8 text-red-600" />
            <div>
              <p className="text-xs text-muted-foreground">Overdue</p>
              <p className="text-lg font-bold">
                {stats.overdueCount} \u00b7 {fmtINR(stats.overdue)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/60 dark:border-green-900 dark:bg-green-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <IndianRupee className="h-8 w-8 text-green-600" />
            <div>
              <p className="text-xs text-muted-foreground">Collected</p>
              <p className="text-lg font-bold">
                {stats.collectedCount} \u00b7 {fmtINR(stats.collected)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search consumer, phone, block\u2026"
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
        <Button variant="outline" size="sm" onClick={() => overdueMut.mutate()} disabled={overdueMut.isPending}>
          {overdueMut.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Mark overdue
        </Button>
        <Button size="sm" onClick={() => setGenOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Generate invoice
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Loading invoices\u2026</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Consumer</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3">Consumption</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((i) => (
                    <tr key={i.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{i.consumer_name || "\u2014"}</div>
                        <div className="text-xs text-muted-foreground">
                          {i.consumer_phone || ""}
                          {i.block_id && <span className="ml-1">\u00b7 Block {i.block_id}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {format(new Date(i.bill_period_start), "dd MMM")} \u2013{" "}
                        {format(new Date(i.bill_period_end), "dd MMM yyyy")}
                      </td>
                      <td className="px-4 py-3">{Number(i.consumption).toLocaleString("en-IN")} L</td>
                      <td className="px-4 py-3 font-semibold">{fmtINR(Number(i.total_amount))}</td>
                      <td className="px-4 py-3 text-xs">{format(new Date(i.due_date), "dd MMM yyyy")}</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(i.status)}>{i.status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setViewing(i)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {i.status !== "paid" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setPayDialog(i);
                              setNotes("");
                              setMethod("manual");
                            }}
                          >
                            <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && !list.isLoading && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        <FileText className="mx-auto mb-2 h-8 w-8 opacity-30" />
                        <p>No invoices found for your consumers.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invoice details</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Consumer</p>
                  <p className="font-medium">{viewing.consumer_name || "\u2014"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Phone</p>
                  <p>{viewing.consumer_phone || "\u2014"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Period</p>
                  <p>
                    {format(new Date(viewing.bill_period_start), "dd MMM yyyy")} \u2013{" "}
                    {format(new Date(viewing.bill_period_end), "dd MMM yyyy")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Due</p>
                  <p>{format(new Date(viewing.due_date), "dd MMM yyyy")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Consumption</p>
                  <p>{Number(viewing.consumption).toLocaleString("en-IN")} L</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Chargeable</p>
                  <p>{Number(viewing.chargeable_consumption).toLocaleString("en-IN")} L</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p>{fmtINR(Number(viewing.amount))}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Late fee</p>
                  <p>{fmtINR(Number(viewing.late_fee))}</p>
                </div>
                <div className="col-span-2 border-t pt-2">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-xl font-bold">{fmtINR(Number(viewing.total_amount))}</p>
                </div>
                <div className="col-span-2">
                  <Badge variant={statusVariant(viewing.status)}>{viewing.status}</Badge>
                </div>
                {viewing.paid_at && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Paid at</p>
                    <p>{format(new Date(viewing.paid_at), "dd MMM yyyy, hh:mm a")}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Collect cash payment dialog */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-green-600" />
              Collect payment
            </DialogTitle>
            <DialogDescription>
              {payDialog?.consumer_name || ""} \u00b7 {fmtINR(Number(payDialog?.total_amount || 0))}
            </DialogDescription>
          </DialogHeader>
          {payDialog && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                payMut.mutate();
              }}
            >
              {/* Receipt style summary */}
              <div className="rounded-xl border bg-green-50/50 dark:bg-green-950/20 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Consumer</span>
                  <span className="font-medium">{payDialog.consumer_name || "\u2014"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Period</span>
                  <span>
                    {format(new Date(payDialog.bill_period_start), "MMM yyyy")}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="text-muted-foreground font-medium">Amount collected</span>
                  <span className="text-xl font-bold text-green-700 dark:text-green-400">
                    {fmtINR(Number(payDialog.total_amount))}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Payment method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">
                      <div className="flex items-center gap-2">
                        <Banknote className="h-4 w-4" />
                        Cash / Manual
                      </div>
                    </SelectItem>
                    <SelectItem value="online">Online transfer</SelectItem>
                    <SelectItem value="prepaid_recharge">Prepaid balance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes / receipt number (optional)</Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Receipt number, cash denomination, remarks\u2026"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setPayDialog(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={payMut.isPending}>
                  {payMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Confirm payment
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Generate invoice dialog */}
      <Dialog open={genOpen} onOpenChange={(o) => !o && setGenOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate invoice</DialogTitle>
            <DialogDescription>
              Creates an invoice from meter readings for the selected consumer and period
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              genMut.mutate();
            }}
          >
            <div className="space-y-2">
              <Label>Consumer *</Label>
              <Select value={genConsumer} onValueChange={setGenConsumer}>
                <SelectTrigger>
                  <SelectValue placeholder="Select consumer\u2026" />
                </SelectTrigger>
                <SelectContent>
                  {consumers.isLoading && (
                    <SelectItem value="__loading" disabled>
                      Loading\u2026
                    </SelectItem>
                  )}
                  {(consumers.data || []).map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name || c.phone || c.id}
                      {c.phone && c.full_name ? ` \u00b7 ${c.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Period start *</Label>
                <Input type="date" value={genStart} onChange={(e) => setGenStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Period end *</Label>
                <Input type="date" value={genEnd} onChange={(e) => setGenEnd(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Late fee (\u20b9)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={genLateFee}
                  onChange={(e) => setGenLateFee(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Due in (days)</Label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={genDueDays}
                  onChange={(e) => setGenDueDays(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setGenOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={genMut.isPending || !genConsumer}>
                {genMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
