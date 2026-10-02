import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Search, Eye, CheckCircle, Loader2, Plus, RefreshCw,
  FileText, IndianRupee, AlertTriangle, TrendingUp, Download, CalendarDays, Users2,
} from "lucide-react";
import { InvoicePrintModal } from "@/components/InvoicePrintModal";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ADMIN_NAV } from "@/lib/nav";
import {
  listInvoices, generateInvoice, markInvoicePaid, markOverdueInvoices,
  bulkGenerateMonthlyInvoices,
  type InvoiceRow,
} from "@/lib/invoices.functions";
import { getAdminUsersList } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";

const ALL = "all";

export const Route = createFileRoute("/_authenticated/admin/invoices")({
  component: AdminInvoices,
});

function statusVariant(s: string) {
  if (s === "paid") return "default";
  if (s === "overdue") return "destructive";
  return "secondary";
}

function AdminInvoices() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  const listFn = useServerFn(listInvoices);
  const generateFn = useServerFn(generateInvoice);
  const markPaidFn = useServerFn(markInvoicePaid);
  const markOverdueFn = useServerFn(markOverdueInvoices);
  const bulkGenFn = useServerFn(bulkGenerateMonthlyInvoices);
  const getUsersFn = useServerFn(getAdminUsersList);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [locationFilter, setLocationFilter] = useState(ALL);

  // Dialogs
  const [viewing, setViewing] = useState<InvoiceRow | null>(null);
  const [payDialog, setPayDialog] = useState<InvoiceRow | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [printInvoice, setPrintInvoice] = useState<InvoiceRow | null>(null);
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<"manual" | "online" | "prepaid_recharge">("manual");

  // Bulk generate state — auto-fill to previous month
  const [bulkStart, setBulkStart] = useState(() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [bulkEnd, setBulkEnd] = useState(() => {
    const d = new Date(); d.setDate(0); // last day of prev month
    return d.toISOString().slice(0, 10);
  });
  const [bulkDueDays, setBulkDueDays] = useState("15");

  // Generate invoice form state
  const [genConsumer, setGenConsumer] = useState("");
  const [genStart, setGenStart] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [genEnd, setGenEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [genLateFee, setGenLateFee] = useState("0");
  const [genDueDays, setGenDueDays] = useState("15");

  // Data queries
  const list = useQuery({
    queryKey: ["admin-invoices", statusFilter, locationFilter],
    queryFn: async () => listFn({ data: {
      status: statusFilter === ALL ? undefined : statusFilter,
      locationId: locationFilter === ALL ? undefined : locationFilter,
    } }) as Promise<InvoiceRow[]>,
  });

  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("id, name").order("name");
      return data || [];
    },
  });

  const consumers = useQuery({
    queryKey: ["admin-users-for-invoices"],
    enabled: genOpen,
    queryFn: async () => {
      const users = await getUsersFn() as any[];
      return users.filter((u: any) =>
        (u.user_roles || []).some((r: any) => r.role === "consumer")
      );
    },
  });

  // Filter client-side by search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data || []).filter((i) => {
      if (!q) return true;
      return (
        (i.consumer_name || "").toLowerCase().includes(q) ||
        (i.consumer_phone || "").toLowerCase().includes(q) ||
        (i.block_id || "").toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q)
      );
    });
  }, [list.data, search]);

  // Summary stats
  const stats = useMemo(() => {
    const all = list.data || [];
    const pending = all.filter((i) => i.status === "pending");
    const overdue = all.filter((i) => i.status === "overdue");
    const paid = all.filter((i) => i.status === "paid");
    return {
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, i) => s + Number(i.total_amount), 0),
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((s, i) => s + Number(i.total_amount), 0),
      collectedAmount: paid.reduce((s, i) => s + Number(i.total_amount), 0),
    };
  }, [list.data]);

  // Mutations
  const payMut = useMutation({
    mutationFn: () => {
      if (!payDialog) throw new Error("");
      return markPaidFn({ data: { invoiceId: payDialog.id, notes: notes || undefined, method } });
    },
    onSuccess: (r) => {
      toast.success(r.alreadyPaid ? "Already paid." : "Marked as paid.");
      setPayDialog(null); setNotes(""); setMethod("manual");
      qc.invalidateQueries({ queryKey: ["admin-invoices"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const genMut = useMutation({
    mutationFn: () => {
      if (!genConsumer) throw new Error("Select a consumer.");
      return generateFn({ data: {
        consumerId: genConsumer,
        periodStart: genStart,
        periodEnd: genEnd,
        lateFee: parseFloat(genLateFee) || 0,
        dueDays: parseInt(genDueDays) || 15,
      } });
    },
    onSuccess: (r) => {
      toast.success(`Invoice generated — ₹${Number(r.totalAmount).toLocaleString("en-IN")} for ${Number(r.consumption).toLocaleString("en-IN")} L`);
      setGenOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-invoices"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const overdueMut = useMutation({
    mutationFn: () => markOverdueFn({ data: undefined }),
    onSuccess: (r) => {
      toast.success(`${r.updatedCount} invoice(s) marked overdue.`);
      qc.invalidateQueries({ queryKey: ["admin-invoices"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const bulkGenMut = useMutation({
    mutationFn: () => bulkGenFn({ data: {
      periodStart: bulkStart,
      periodEnd: bulkEnd,
      dueDays: parseInt(bulkDueDays) || 15,
    } }),
    onSuccess: (r) => {
      toast.success(
        `✅ ${r.generated} invoices generated · ${r.skipped} skipped (already existed) · ${r.errors} errors — out of ${r.total} consumers.`,
        { duration: 8000 }
      );
      setBulkOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-invoices"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Bulk generate failed"),
  });

  const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <DashboardLayout navItems={ADMIN_NAV} title="Invoices" userName={profile?.full_name || null} userPhone={profile?.phone || null}>

      {/* Summary stats */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="border-yellow-200 bg-yellow-50/60 dark:border-yellow-900 dark:bg-yellow-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <FileText className="h-8 w-8 text-yellow-600 dark:text-yellow-400" />
            <div>
              <p className="text-xs text-muted-foreground">Pending</p>
              <p className="text-lg font-bold">{stats.pendingCount} · {fmtINR(stats.pendingAmount)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
            <div>
              <p className="text-xs text-muted-foreground">Overdue</p>
              <p className="text-lg font-bold">{stats.overdueCount} · {fmtINR(stats.overdueAmount)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/60 dark:border-green-900 dark:bg-green-950/20">
          <CardContent className="flex items-center gap-3 p-4">
            <IndianRupee className="h-8 w-8 text-green-600 dark:text-green-400" />
            <div>
              <p className="text-xs text-muted-foreground">Collected</p>
              <p className="text-lg font-bold">{fmtINR(stats.collectedAmount)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search consumer, phone, block…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All locations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All locations</SelectItem>
            {(locations.data || []).map((l: any) => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => overdueMut.mutate()} disabled={overdueMut.isPending}>
          {overdueMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Mark overdue
        </Button>
        <Button size="sm" variant="outline" onClick={() => setGenOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Generate (single)
        </Button>
        <Button
          size="sm"
          onClick={() => setBulkOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <CalendarDays className="mr-2 h-4 w-4" />
          Bulk Generate Monthly
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {list.isLoading ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Loading invoices…</p>
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
                        <div className="font-medium">{i.consumer_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {i.consumer_phone || ""}
                          {i.block_id && <span className="ml-1">· Block {i.block_id}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {format(new Date(i.bill_period_start), "dd MMM")} – {format(new Date(i.bill_period_end), "dd MMM yyyy")}
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
                        <Button size="sm" variant="ghost" onClick={() => setPrintInvoice(i)} title="Download PDF">
                          <Download className="h-3.5 w-3.5 text-blue-600" />
                        </Button>
                        {i.status !== "paid" && (
                          <Button size="sm" variant="ghost" onClick={() => { setPayDialog(i); setNotes(""); setMethod("manual"); }}>
                            <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && !list.isLoading && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        <TrendingUp className="mx-auto mb-2 h-8 w-8 opacity-30" />
                        <p>No invoices found.</p>
                        <p className="text-xs mt-1">Generate an invoice using the button above.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View details dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invoice details</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-xs text-muted-foreground">Consumer</p><p className="font-medium">{viewing.consumer_name || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Phone</p><p>{viewing.consumer_phone || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Period</p><p>{format(new Date(viewing.bill_period_start), "dd MMM yyyy")} – {format(new Date(viewing.bill_period_end), "dd MMM yyyy")}</p></div>
                <div><p className="text-xs text-muted-foreground">Due date</p><p>{format(new Date(viewing.due_date), "dd MMM yyyy")}</p></div>
                <div><p className="text-xs text-muted-foreground">Consumption</p><p>{Number(viewing.consumption).toLocaleString("en-IN")} L</p></div>
                <div><p className="text-xs text-muted-foreground">Free tier</p><p>{Number(viewing.free_consumption).toLocaleString("en-IN")} L</p></div>
                <div><p className="text-xs text-muted-foreground">Chargeable</p><p>{Number(viewing.chargeable_consumption).toLocaleString("en-IN")} L</p></div>
                <div><p className="text-xs text-muted-foreground">Rate</p><p>₹{Number(viewing.rate_applied).toFixed(4)}/L</p></div>
                <div><p className="text-xs text-muted-foreground">Amount</p><p>{fmtINR(Number(viewing.amount))}</p></div>
                <div><p className="text-xs text-muted-foreground">Late fee</p><p>{fmtINR(Number(viewing.late_fee))}</p></div>
                <div className="col-span-2 border-t pt-2">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-xl font-bold">{fmtINR(Number(viewing.total_amount))}</p>
                </div>
                <div className="col-span-2">
                  <Badge variant={statusVariant(viewing.status)} className="text-sm">{viewing.status}</Badge>
                </div>
                {viewing.paid_at && (
                  <div className="col-span-2"><p className="text-xs text-muted-foreground">Paid at</p><p>{format(new Date(viewing.paid_at), "dd MMM yyyy, hh:mm a")}</p></div>
                )}
                <div className="col-span-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => { setPrintInvoice(viewing); setViewing(null); }}>
                    <Download className="mr-2 h-4 w-4" />
                    Download PDF
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Mark paid dialog */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark invoice paid</DialogTitle>
            <DialogDescription>{payDialog?.consumer_name || ""} · {fmtINR(Number(payDialog?.total_amount || 0))}</DialogDescription>
          </DialogHeader>
          {payDialog && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); payMut.mutate(); }}>
              <div className="space-y-2">
                <Label>Payment method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual / Cash</SelectItem>
                    <SelectItem value="online">Online transfer</SelectItem>
                    <SelectItem value="prepaid_recharge">Prepaid balance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference number, remarks…" />
              </div>
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setPayDialog(null)}>Cancel</Button>
                <Button type="submit" disabled={payMut.isPending}>
                  {payMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
            <DialogDescription>Creates an invoice from meter readings for the selected period</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); genMut.mutate(); }}>
            <div className="space-y-2">
              <Label>Consumer *</Label>
              <Select value={genConsumer} onValueChange={setGenConsumer}>
                <SelectTrigger><SelectValue placeholder="Select consumer…" /></SelectTrigger>
                <SelectContent>
                  {consumers.isLoading && <SelectItem value="__loading" disabled>Loading…</SelectItem>}
                  {(consumers.data || []).map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name || u.phone || u.id}
                      {u.phone && u.full_name ? ` · ${u.phone}` : ""}
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
                <Label>Late fee (₹)</Label>
                <Input type="number" min={0} step="0.01" value={genLateFee} onChange={(e) => setGenLateFee(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Due in (days)</Label>
                <Input type="number" min={1} max={90} value={genDueDays} onChange={(e) => setGenDueDays(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setGenOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={genMut.isPending || !genConsumer}>
                {genMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Generate Monthly Invoices dialog */}
      <Dialog open={bulkOpen} onOpenChange={(o) => !o && setBulkOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users2 className="h-5 w-5 text-blue-600" />
              Bulk Generate Monthly Invoices
            </DialogTitle>
            <DialogDescription>
              Generates invoices for <strong>all consumers</strong> for the selected period. Already-existing invoices are skipped automatically.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); bulkGenMut.mutate(); }}>
            <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-4 text-sm">
              <p className="font-medium text-blue-800 dark:text-blue-300 flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Typically run on the 1st of each month
              </p>
              <p className="text-blue-600 dark:text-blue-400 text-xs mt-1">
                The period is auto-filled to last month. Adjust if needed.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Period start *</Label>
                <Input type="date" value={bulkStart} onChange={(e) => setBulkStart(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Period end *</Label>
                <Input type="date" value={bulkEnd} onChange={(e) => setBulkEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Due in (days)</Label>
              <Input type="number" min={1} max={90} value={bulkDueDays} onChange={(e) => setBulkDueDays(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setBulkOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={bulkGenMut.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                {bulkGenMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Users2 className="mr-2 h-4 w-4" />
                Generate for all consumers
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Invoice PDF print modal */}
      <InvoicePrintModal
        invoice={printInvoice}
        onClose={() => setPrintInvoice(null)}
      />
    </DashboardLayout>
  );
}