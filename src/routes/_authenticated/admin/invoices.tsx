import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Eye, CheckCircle, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { ADMIN_NAV } from "@/lib/nav";
import { markInvoicePaid } from "@/lib/invoices.functions";

const ALL = "__all__";
type Row = {
  id: string; bill_period_start: string; bill_period_end: string;
  consumption: number; free_consumption: number; chargeable_consumption: number;
  rate_applied: number; amount: number; late_fee: number; total_amount: number;
  due_date: string; status: string; paid_at: string | null; consumer_id: string;
  profiles: { full_name: string | null; phone: string | null } | null;
};

export const Route = createFileRoute("/_authenticated/admin/invoices")({
  component: AdminInvoices,
});

function AdminInvoices() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [payDialog, setPayDialog] = useState<Row | null>(null);
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<"manual" | "online" | "prepaid_recharge">("manual");

  const list = useQuery({
    queryKey: ["admin-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, profiles!invoices_consumer_id_fkey(full_name, phone)")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data as unknown as Row[]);
    },
  });

  const payMut = useMutation({
    mutationFn: async () => {
      if (!payDialog) throw new Error("");
      return markInvoicePaid({ data: { invoiceId: payDialog.id, notes: notes || undefined, method } });
    },
    onSuccess: (r) => {
      toast.success(r.alreadyPaid ? "Already paid." : "Marked as paid.");
      setPayDialog(null); setNotes(""); setMethod("manual");
      qc.invalidateQueries({ queryKey: ["admin-invoices"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data || []).filter((i) => {
      if (statusFilter !== ALL && i.status !== statusFilter) return false;
      if (!q) return true;
      return (i.profiles?.full_name || "").toLowerCase().includes(q)
        || (i.profiles?.phone || "").toLowerCase().includes(q)
        || i.id.toLowerCase().includes(q);
    });
  }, [list.data, search, statusFilter]);

  return (
    <DashboardLayout navItems={ADMIN_NAV} title="Invoices" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search consumer or invoice…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
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
                  <tr key={i.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{i.profiles?.full_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{i.profiles?.phone || ""}</div>
                    </td>
                    <td className="px-4 py-3">
                      {new Date(i.bill_period_start).toLocaleDateString()} – {new Date(i.bill_period_end).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">{Number(i.consumption).toLocaleString("en-IN")} L</td>
                    <td className="px-4 py-3 font-medium">₹{Number(i.total_amount).toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3">{new Date(i.due_date).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <Badge variant={i.status === "paid" ? "default" : i.status === "overdue" ? "destructive" : "secondary"}>
                        {i.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setViewing(i)}><Eye className="h-3.5 w-3.5" /></Button>
                      {i.status !== "paid" && (
                        <Button size="sm" variant="ghost" onClick={() => { setPayDialog(i); setNotes(""); setMethod("manual"); }}><CheckCircle className="h-3.5 w-3.5" /></Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No invoices found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invoice details</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><div className="text-xs text-muted-foreground">Consumer</div><div className="font-medium">{viewing.profiles?.full_name || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Phone</div><div>{viewing.profiles?.phone || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Period</div><div>{new Date(viewing.bill_period_start).toLocaleDateString()} – {new Date(viewing.bill_period_end).toLocaleDateString()}</div></div>
                <div><div className="text-xs text-muted-foreground">Due</div><div>{new Date(viewing.due_date).toLocaleDateString()}</div></div>
                <div><div className="text-xs text-muted-foreground">Consumption</div><div>{Number(viewing.consumption).toLocaleString("en-IN")} L</div></div>
                <div><div className="text-xs text-muted-foreground">Free tier</div><div>{Number(viewing.free_consumption).toLocaleString("en-IN")} L</div></div>
                <div><div className="text-xs text-muted-foreground">Chargeable</div><div>{Number(viewing.chargeable_consumption).toLocaleString("en-IN")} L</div></div>
                <div><div className="text-xs text-muted-foreground">Rate applied</div><div>₹{Number(viewing.rate_applied).toFixed(4)}/L</div></div>
                <div><div className="text-xs text-muted-foreground">Amount</div><div>₹{Number(viewing.amount).toLocaleString("en-IN")}</div></div>
                <div><div className="text-xs text-muted-foreground">Late fee</div><div>₹{Number(viewing.late_fee).toLocaleString("en-IN")}</div></div>
                <div className="col-span-2 border-t pt-2"><div className="text-xs text-muted-foreground">Total</div><div className="text-lg font-bold">₹{Number(viewing.total_amount).toLocaleString("en-IN")}</div></div>
                {viewing.paid_at && <div className="col-span-2"><div className="text-xs text-muted-foreground">Paid at</div><div>{new Date(viewing.paid_at).toLocaleString()}</div></div>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark invoice paid</DialogTitle></DialogHeader>
          {payDialog && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); payMut.mutate(); }}>
              <div className="rounded-md border p-3 text-sm">
                <div className="font-medium">{payDialog.profiles?.full_name || "—"}</div>
                <div className="text-muted-foreground">₹{Number(payDialog.total_amount).toLocaleString("en-IN")} · due {new Date(payDialog.due_date).toLocaleDateString()}</div>
              </div>
              <div className="space-y-2">
                <Label>Payment method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual / cash</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="prepaid_recharge">Prepaid recharge</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference number, cheque, remarks…" />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={payMut.isPending}>
                  {payMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm payment
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}