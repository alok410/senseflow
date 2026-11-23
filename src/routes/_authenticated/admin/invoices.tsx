import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Search, Eye, CheckCircle, Loader2, Plus, RefreshCw, AlertTriangle,
  TrendingUp, Download, CalendarDays, Users2, XCircle, Flag,
  ClipboardList, Pencil, ChevronDown,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { ADMIN_NAV } from "@/lib/nav";
import {
  listInvoices, generateMonthlyBatch, approveInvoice, bulkApproveInvoices,
  cancelInvoice, editInvoiceDraft, runOverdueJob, getInvoiceAuditLog,
  generateInvoice, bulkGenerateMonthlyInvoices, markInvoicePaid, markOverdueInvoices,
  type InvoiceRow, type AuditLogRow,
} from "@/lib/invoices.functions";
import { getAdminUsersList } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/invoices")({
  component: AdminInvoices,
});

// ── helpers ──────────────────────────────────────────────────────
const ALL = "all";

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "paid")      return "default";
  if (s === "overdue")   return "destructive";
  if (s === "cancelled") return "outline";
  if (s === "draft")     return "secondary";
  return "secondary";
}

function statusLabel(s: string) {
  if (s === "published" || s === "pending" || s === "approved") return "Published";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const fmtINR = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const prevMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
};

// ─────────────────────────────────────────────────────────────────
function AdminInvoices() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();

  // Server fn refs
  const listFn          = useServerFn(listInvoices);
  const approveFn       = useServerFn(approveInvoice);
  const bulkApproveFn   = useServerFn(bulkApproveInvoices);
  const cancelFn        = useServerFn(cancelInvoice);
  const editDraftFn     = useServerFn(editInvoiceDraft);
  const overdueJobFn    = useServerFn(runOverdueJob);
  const auditLogFn      = useServerFn(getInvoiceAuditLog);
  const batchGenFn      = useServerFn(generateMonthlyBatch);
  const singleGenFn     = useServerFn(generateInvoice);
  const bulkLegacyFn    = useServerFn(bulkGenerateMonthlyInvoices);
  const markPaidFn      = useServerFn(markInvoicePaid);
  const markOverdueFn   = useServerFn(markOverdueInvoices);
  const getUsersFn      = useServerFn(getAdminUsersList);

  // Filters & tabs
  const [tab,           setTab]         = useState("all");
  const [search,        setSearch]      = useState("");
  const [billingMonth,  setBillingMonth] = useState("");
  const [locationFilter,setLocFilter]   = useState(ALL);

  // Dialogs
  const [viewing,       setViewing]      = useState<InvoiceRow | null>(null);
  const [payDialog,     setPayDialog]    = useState<InvoiceRow | null>(null);
  const [cancelDialog,  setCancelDialog] = useState<InvoiceRow | null>(null);
  const [editDialog,    setEditDialog]   = useState<InvoiceRow | null>(null);
  const [auditSheet,    setAuditSheet]   = useState<InvoiceRow | null>(null);
  const [genOpen,       setGenOpen]      = useState(false);
  const [bulkOpen,      setBulkOpen]     = useState(false);
  const [batchOpen,     setBatchOpen]    = useState(false);
  const [printInvoice,  setPrintInvoice] = useState<InvoiceRow | null>(null);

  // Form state
  const [payMethod,  setPayMethod]  = useState<"manual"|"online"|"prepaid_recharge">("manual");
  const [payNotes,   setPayNotes]   = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [editBase,   setEditBase]   = useState("");
  const [editOther,  setEditOther]  = useState("");
  const [editFee,    setEditFee]    = useState("");
  const [editNote,   setEditNote]   = useState("");
  const [batchMonth, setBatchMonth] = useState(prevMonth);
  const [batchDue,   setBatchDue]   = useState("15");

  // Legacy bulk gen state
  const [bulkStart, setBulkStart] = useState(() => { const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10); });
  const [bulkEnd,   setBulkEnd]   = useState(() => { const d=new Date(); d.setDate(0); return d.toISOString().slice(0,10); });
  const [bulkDueDays, setBulkDueDays] = useState("15");
  const [genConsumer, setGenConsumer] = useState("");
  const [genStart, setGenStart] = useState(() => { const d=new Date(); d.setDate(1); return d.toISOString().slice(0,10); });
  const [genEnd,   setGenEnd]   = useState(() => new Date().toISOString().slice(0,10));
  const [genLateFee, setGenLateFee] = useState("0");
  const [genDueDays, setGenDueDays] = useState("15");

  // ── Queries ───────────────────────────────────────────────────
  const statusFilter = tab === "all" ? undefined
    : tab === "published" ? "published"
    : tab;

  const invoicesQ = useQuery({
    queryKey: ["admin-invoices-v2", statusFilter, billingMonth, locationFilter],
    queryFn: () => listFn({ data: {
      status:       statusFilter,
      billingMonth: billingMonth || undefined,
      locationId:   locationFilter === ALL ? undefined : locationFilter,
    }}),
    staleTime: 30_000,
  });

  const invoiceRows: InvoiceRow[] = invoicesQ.data?.rows ?? [];

  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: async () => (await supabase.from("locations").select("id, name").order("name")).data || [],
  });

  const consumers = useQuery({
    queryKey: ["admin-users-for-invoices"],
    enabled: genOpen,
    queryFn: async () => {
      const users = await getUsersFn() as any[];
      return users.filter((u: any) => (u.user_roles||[]).some((r: any) => r.role === "consumer"));
    },
  });

  const auditLogQ = useQuery({
    queryKey: ["audit-log", auditSheet?.id],
    enabled: !!auditSheet,
    queryFn: () => auditLogFn({ data: { invoiceId: auditSheet!.id } }),
  });

  // ── Filtered rows ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoiceRows.filter((i) => {
      if (!q) return true;
      return (
        (i.consumer_name   || "").toLowerCase().includes(q) ||
        (i.consumer_phone  || "").toLowerCase().includes(q) ||
        (i.block_id        || "").toLowerCase().includes(q) ||
        (i.invoice_number  || "").toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q)
      );
    });
  }, [invoiceRows, search]);

  // Tab counts
  const counts = useMemo(() => {
    const all = invoiceRows;
    return {
      draft:     all.filter(i => i.status === "draft").length,
      flagged:   all.filter(i => i.flagged).length,
      published: all.filter(i => ["published","pending","approved"].includes(i.status)).length,
      overdue:   all.filter(i => i.status === "overdue").length,
      paid:      all.filter(i => i.status === "paid").length,
    };
  }, [invoiceRows]);

  // ── Mutations ─────────────────────────────────────────────────
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-invoices-v2"] });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveFn({ data: { invoiceId: id, performedBy: user!.id } }),
    onSuccess: () => { toast.success("Invoice approved & published."); invalidate(); },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  const bulkApproveMut = useMutation({
    mutationFn: () => bulkApproveFn({ data: {
      billingMonth: billingMonth || undefined,
      skipFlagged: true,
      performedBy: user!.id,
    }}),
    onSuccess: (r) => { toast.success(`${(r as any).approved} invoices approved.`); invalidate(); },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  const cancelMut = useMutation({
    mutationFn: () => {
      if (!cancelDialog) throw new Error("");
      return cancelFn({ data: { invoiceId: cancelDialog.id, reason: cancelReason, performedBy: user!.id } });
    },
    onSuccess: () => { toast.success("Invoice cancelled."); setCancelDialog(null); setCancelReason(""); invalidate(); },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  const editMut = useMutation({
    mutationFn: () => {
      if (!editDialog) throw new Error("");
      return editDraftFn({ data: {
        invoiceId:    editDialog.id,
        performedBy:  user!.id,
        baseCharge:   parseFloat(editBase)  || 0,
        otherCharges: parseFloat(editOther) || 0,
        lateFee:      parseFloat(editFee)   || 0,
        note:         editNote || undefined,
      }});
    },
    onSuccess: (r) => {
      toast.success(`Updated. New total: ${fmtINR(Number((r as any).totalAmount))}`);
      setEditDialog(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  const payMut = useMutation({
    mutationFn: () => {
      if (!payDialog) throw new Error("");
      return markPaidFn({ data: { invoiceId: payDialog.id, notes: payNotes || undefined, method: payMethod } });
    },
    onSuccess: (r) => {
      toast.success((r as any).alreadyPaid ? "Already paid." : "Marked as paid.");
      setPayDialog(null); setPayNotes(""); setPayMethod("manual");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  const overdueJobMut = useMutation({
    mutationFn: () => overdueJobFn({ data: undefined }),
    onSuccess: (r) => { toast.success(`${(r as any).updated} invoice(s) marked overdue.`); invalidate(); },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  const batchGenMut = useMutation({
    mutationFn: () => batchGenFn({ data: {
      billingMonth: batchMonth,
      dueDays: parseInt(batchDue) || 15,
      performedBy: user!.id,
    }}),
    onSuccess: (r: any) => {
      toast.success(
        `✅ ${r.created} created (${r.flagged} flagged) · ${r.skipped} skipped · ${r.failed} errors`,
        { duration: 8000 }
      );
      setBatchOpen(false);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Batch generate failed"),
  });

  const legacyBulkMut = useMutation({
    mutationFn: () => bulkLegacyFn({ data: { periodStart: bulkStart, periodEnd: bulkEnd, dueDays: parseInt(bulkDueDays)||15 } }),
    onSuccess: (r: any) => {
      toast.success(`✅ ${r.generated} · ${r.skipped} skipped · ${r.errors} errors`, { duration: 8000 });
      setBulkOpen(false);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  const singleGenMut = useMutation({
    mutationFn: () => {
      if (!genConsumer) throw new Error("Select a consumer.");
      return singleGenFn({ data: { consumerId: genConsumer, periodStart: genStart, periodEnd: genEnd, lateFee: parseFloat(genLateFee)||0, dueDays: parseInt(genDueDays)||15 } });
    },
    onSuccess: (r: any) => {
      toast.success(`Invoice generated — ${fmtINR(Number(r.totalAmount))}`);
      setGenOpen(false);
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  // ─── Tab badge helper ─────────────────────────────────────────
  const tb = (label: string, count: number) => (
    <span className="flex items-center gap-1.5">
      {label}
      {count > 0 && (
        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
          {count}
        </span>
      )}
    </span>
  );

  // ─── Invoice Table ────────────────────────────────────────────
  const InvoiceTable = ({ rows }: { rows: InvoiceRow[] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Invoice #</th>
            <th className="px-4 py-3">Consumer</th>
            <th className="px-4 py-3">Month</th>
            <th className="px-4 py-3">Consumption</th>
            <th className="px-4 py-3">Total</th>
            <th className="px-4 py-3">Due</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((i) => (
            <tr key={i.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {i.invoice_number || "—"}
                {i.flagged && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600">
                    <Flag className="h-3 w-3" />
                    <span className="text-[9px]">{i.flag_reason}</span>
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="font-medium">{i.consumer_name || "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {i.consumer_phone || ""}
                  {i.block_id && <span className="ml-1">· Blk {i.block_id}</span>}
                </div>
              </td>
              <td className="px-4 py-3 text-xs">{i.billing_month || i.bill_period_start?.slice(0,7) || "—"}</td>
              <td className="px-4 py-3">{Number(i.consumption).toLocaleString("en-IN")} L</td>
              <td className="px-4 py-3 font-semibold">{fmtINR(Number(i.total_amount))}</td>
              <td className="px-4 py-3 text-xs">{format(new Date(i.due_date), "dd MMM yyyy")}</td>
              <td className="px-4 py-3">
                <Badge variant={statusVariant(i.status)}>{statusLabel(i.status)}</Badge>
              </td>
              <td className="px-4 py-3 text-right flex justify-end gap-1">
                <Button size="sm" variant="ghost" title="View" onClick={() => setViewing(i)}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" title="Print" onClick={() => setPrintInvoice(i)}>
                  <Download className="h-3.5 w-3.5 text-blue-600" />
                </Button>
                <Button size="sm" variant="ghost" title="Audit log" onClick={() => setAuditSheet(i)}>
                  <ClipboardList className="h-3.5 w-3.5 text-purple-600" />
                </Button>
                {i.status === "draft" && (
                  <>
                    <Button size="sm" variant="ghost" title="Approve" onClick={() => approveMut.mutate(i.id)} disabled={approveMut.isPending}>
                      <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Edit" onClick={() => {
                      setEditDialog(i);
                      setEditBase(String(i.base_charge ?? 0));
                      setEditOther(String(i.other_charges ?? 0));
                      setEditFee(String(i.late_fee ?? 0));
                      setEditNote("");
                    }}>
                      <Pencil className="h-3.5 w-3.5 text-amber-600" />
                    </Button>
                  </>
                )}
                {["published","pending","approved"].includes(i.status) && (
                  <Button size="sm" variant="ghost" title="Mark paid" onClick={() => { setPayDialog(i); setPayNotes(""); setPayMethod("manual"); }}>
                    <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                  </Button>
                )}
                {i.status !== "paid" && i.status !== "cancelled" && (
                  <Button size="sm" variant="ghost" title="Cancel" onClick={() => { setCancelDialog(i); setCancelReason(""); }}>
                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {!rows.length && !invoicesQ.isLoading && (
            <tr>
              <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                <TrendingUp className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p>No invoices found.</p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────
  return (
    <DashboardLayout navItems={ADMIN_NAV} title="Invoices" userName={profile?.full_name||null} userPhone={profile?.phone||null}>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search consumer, phone, invoice #…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <Input type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)}
          className="w-40" placeholder="Billing month" />

        <Select value={locationFilter} onValueChange={setLocFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All locations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All locations</SelectItem>
            {(locations.data || []).map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Actions */}
        <Button variant="outline" size="sm" onClick={() => overdueJobMut.mutate()} disabled={overdueJobMut.isPending}>
          {overdueJobMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Mark Overdue
        </Button>
        <Button variant="outline" size="sm" onClick={() => bulkApproveMut.mutate()} disabled={bulkApproveMut.isPending}>
          {bulkApproveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
          Bulk Approve Drafts
        </Button>
        <Button size="sm" variant="outline" onClick={() => setGenOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Single Invoice
        </Button>
        <Button size="sm" onClick={() => setBatchOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
          <CalendarDays className="mr-2 h-4 w-4" /> Monthly Batch
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="draft">{tb("Drafts", counts.draft)}</TabsTrigger>
          <TabsTrigger value="flagged" className="text-amber-600">{tb("Flagged", counts.flagged)}</TabsTrigger>
          <TabsTrigger value="published">{tb("Published", counts.published)}</TabsTrigger>
          <TabsTrigger value="overdue" className="text-red-600">{tb("Overdue", counts.overdue)}</TabsTrigger>
          <TabsTrigger value="paid">{tb("Paid", counts.paid)}</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>

        {["all","draft","flagged","published","overdue","paid","cancelled"].map((t) => (
          <TabsContent key={t} value={t}>
            <Card>
              <CardContent className="p-0">
                {invoicesQ.isLoading ? (
                  <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <p className="text-sm">Loading invoices…</p>
                  </div>
                ) : (
                  <InvoiceTable rows={
                    t === "flagged"
                      ? filtered.filter(i => i.flagged)
                      : t === "published"
                      ? filtered.filter(i => ["published","pending","approved"].includes(i.status))
                      : t === "all"
                      ? filtered
                      : filtered.filter(i => i.status === t)
                  } />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {/* ── View details dialog ─────────────────────────── */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Invoice Details</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-xs text-muted-foreground">Invoice #</p><p className="font-mono">{viewing.invoice_number || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Billing Month</p><p>{viewing.billing_month || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Consumer</p><p className="font-medium">{viewing.consumer_name || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Phone</p><p>{viewing.consumer_phone || "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Period</p><p>{format(new Date(viewing.bill_period_start), "dd MMM yyyy")} – {format(new Date(viewing.bill_period_end), "dd MMM yyyy")}</p></div>
                <div><p className="text-xs text-muted-foreground">Due</p><p>{format(new Date(viewing.due_date), "dd MMM yyyy")}</p></div>
                <div><p className="text-xs text-muted-foreground">Consumption</p><p>{Number(viewing.consumption).toLocaleString("en-IN")} L</p></div>
                <div><p className="text-xs text-muted-foreground">Rate</p><p>₹{Number(viewing.rate_applied).toFixed(4)}/L</p></div>
                <div><p className="text-xs text-muted-foreground">Water Charge</p><p>{fmtINR(Number(viewing.amount))}</p></div>
                <div><p className="text-xs text-muted-foreground">Base Charge</p><p>{fmtINR(Number(viewing.base_charge))}</p></div>
                <div><p className="text-xs text-muted-foreground">Other Charges</p><p>{fmtINR(Number(viewing.other_charges))}</p></div>
                <div><p className="text-xs text-muted-foreground">Arrears</p><p>{fmtINR(Number(viewing.arrears))}</p></div>
                <div><p className="text-xs text-muted-foreground">Late Fee</p><p>{fmtINR(Number(viewing.late_fee))}</p></div>
                <div className="col-span-2 border-t pt-2">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-xl font-bold">{fmtINR(Number(viewing.total_amount))}</p>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <Badge variant={statusVariant(viewing.status)}>{statusLabel(viewing.status)}</Badge>
                  {viewing.flagged && <Badge variant="outline" className="text-amber-600 border-amber-400"><Flag className="h-3 w-3 mr-1" />{viewing.flag_reason}</Badge>}
                </div>
                {viewing.cancel_reason && (
                  <div className="col-span-2"><p className="text-xs text-muted-foreground">Cancel reason</p><p className="text-red-600">{viewing.cancel_reason}</p></div>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => { setPrintInvoice(viewing); setViewing(null); }}>
                  <Download className="mr-2 h-4 w-4" /> Download PDF
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAuditSheet(viewing); setViewing(null); }}>
                  <ClipboardList className="mr-2 h-4 w-4" /> Audit Log
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Edit draft dialog ───────────────────────────── */}
      <Dialog open={!!editDialog} onOpenChange={(o) => !o && setEditDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Draft Invoice</DialogTitle>
            <DialogDescription>{editDialog?.invoice_number || ""} · {editDialog?.consumer_name || ""}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); editMut.mutate(); }}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Base Charge (₹)</Label><Input type="number" min={0} step="0.01" value={editBase} onChange={(e) => setEditBase(e.target.value)} /></div>
              <div className="space-y-1"><Label>Other Charges (₹)</Label><Input type="number" min={0} step="0.01" value={editOther} onChange={(e) => setEditOther(e.target.value)} /></div>
              <div className="space-y-1"><Label>Late Fee (₹)</Label><Input type="number" min={0} step="0.01" value={editFee} onChange={(e) => setEditFee(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>Note (optional)</Label><Textarea rows={2} value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Reason for edit…" /></div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setEditDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={editMut.isPending}>
                {editMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Cancel dialog ───────────────────────────────── */}
      <Dialog open={!!cancelDialog} onOpenChange={(o) => !o && setCancelDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Invoice</DialogTitle>
            <DialogDescription>{cancelDialog?.invoice_number} · {cancelDialog?.consumer_name}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); cancelMut.mutate(); }}>
            <div className="space-y-1">
              <Label>Reason *</Label>
              <Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason for cancellation…" required minLength={3} />
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setCancelDialog(null)}>Keep Invoice</Button>
              <Button type="submit" variant="destructive" disabled={cancelMut.isPending || cancelReason.trim().length < 3}>
                {cancelMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cancel Invoice
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Mark paid dialog ────────────────────────────── */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Invoice Paid</DialogTitle>
            <DialogDescription>{payDialog?.consumer_name} · {fmtINR(Number(payDialog?.total_amount||0))}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); payMut.mutate(); }}>
            <div className="space-y-1">
              <Label>Payment method</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual / Cash</SelectItem>
                  <SelectItem value="online">Online transfer</SelectItem>
                  <SelectItem value="prepaid_recharge">Prepaid balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Reference number, remarks…" />
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setPayDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={payMut.isPending}>
                {payMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm Payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Audit log sheet ──────────────────────────────── */}
      <Sheet open={!!auditSheet} onOpenChange={(o) => !o && setAuditSheet(null)}>
        <SheetContent className="w-[420px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Audit Log — {auditSheet?.invoice_number || auditSheet?.id?.slice(0,8)}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3 text-sm">
            {auditLogQ.isLoading && <p className="text-muted-foreground text-center py-8"><Loader2 className="inline h-5 w-5 animate-spin mr-2" />Loading…</p>}
            {((auditLogQ.data as AuditLogRow[]) ?? []).map((entry) => (
              <div key={entry.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs uppercase tracking-wide text-primary">{entry.action}</span>
                  <span className="text-[10px] text-muted-foreground">{format(new Date(entry.created_at), "dd MMM yyyy, hh:mm a")}</span>
                </div>
                {entry.note && <p className="text-xs text-muted-foreground mt-0.5">{entry.note}</p>}
                {entry.new_value && (
                  <pre className="mt-1 rounded bg-muted/50 p-1.5 text-[10px] font-mono overflow-x-auto">
                    {JSON.stringify(entry.new_value, null, 2)}
                  </pre>
                )}
              </div>
            ))}
            {!auditLogQ.isLoading && !((auditLogQ.data as any[])?.length) && (
              <p className="text-center text-muted-foreground py-8">No audit events yet.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Monthly Batch Generate dialog ───────────────── */}
      <Dialog open={batchOpen} onOpenChange={(o) => !o && setBatchOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-blue-600" /> Monthly Invoice Batch
            </DialogTitle>
            <DialogDescription>
              Generates invoices for <strong>all active consumers</strong> for the selected billing month. Respects <code>invoice_mode</code> setting. Anomalies (high/zero usage) are auto-flagged as DRAFT.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); batchGenMut.mutate(); }}>
            <div className="space-y-1">
              <Label>Billing Month *</Label>
              <Input type="month" value={batchMonth} onChange={(e) => setBatchMonth(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Due in (days)</Label>
              <Input type="number" min={1} max={90} value={batchDue} onChange={(e) => setBatchDue(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setBatchOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={batchGenMut.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                {batchGenMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Users2 className="mr-2 h-4 w-4" /> Generate Batch
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Single invoice generate dialog ──────────────── */}
      <Dialog open={genOpen} onOpenChange={(o) => !o && setGenOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Generate Single Invoice</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); singleGenMut.mutate(); }}>
            <div className="space-y-1">
              <Label>Consumer *</Label>
              <Select value={genConsumer} onValueChange={setGenConsumer}>
                <SelectTrigger><SelectValue placeholder="Select consumer…" /></SelectTrigger>
                <SelectContent>
                  {consumers.isLoading && <SelectItem value="__loading" disabled>Loading…</SelectItem>}
                  {(consumers.data || []).map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name || u.phone || u.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Period start *</Label><Input type="date" value={genStart} onChange={(e) => setGenStart(e.target.value)} /></div>
              <div className="space-y-1"><Label>Period end *</Label><Input type="date" value={genEnd} onChange={(e) => setGenEnd(e.target.value)} /></div>
              <div className="space-y-1"><Label>Late fee (₹)</Label><Input type="number" min={0} step="0.01" value={genLateFee} onChange={(e) => setGenLateFee(e.target.value)} /></div>
              <div className="space-y-1"><Label>Due in (days)</Label><Input type="number" min={1} max={90} value={genDueDays} onChange={(e) => setGenDueDays(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setGenOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={singleGenMut.isPending || !genConsumer}>
                {singleGenMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Generate
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <InvoicePrintModal invoice={printInvoice} onClose={() => setPrintInvoice(null)} />
    </DashboardLayout>
  );
}
