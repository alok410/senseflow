import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { setWaterRate } from "@/lib/rates.functions";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/rates")({
  component: AdminRates,
});

function AdminRates() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ rate_per_liter: "0.05", free_tier_liters: "0", effective_from: today });

  const list = useQuery({
    queryKey: ["admin-rates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("water_rates").select("*").order("effective_from", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const mut = useMutation({
    mutationFn: async () => setWaterRate({ data: {
      rate_per_liter: Number(form.rate_per_liter),
      free_tier_liters: Number(form.free_tier_liters),
      effective_from: form.effective_from,
    }}),
    onSuccess: () => {
      toast.success("New rate saved.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-rates"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <DashboardLayout navItems={ADMIN_NAV} title="Water rates" userName={profile?.full_name || null} userPhone={profile?.phone || null}>
      <div className="mb-4 flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Set new rate</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Set water rate</DialogTitle></DialogHeader>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}>
              <div className="space-y-2"><Label>Rate per liter (₹)</Label><Input type="number" step="0.0001" value={form.rate_per_liter} onChange={(e) => setForm({ ...form, rate_per_liter: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Free tier (liters)</Label><Input type="number" step="1" value={form.free_tier_liters} onChange={(e) => setForm({ ...form, free_tier_liters: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Effective from</Label><Input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} required /></div>
              <DialogFooter><Button type="submit" disabled={mut.isPending}>{mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-3">Effective from</th><th className="px-4 py-3">Rate / L</th><th className="px-4 py-3">Free tier (L)</th></tr>
            </thead>
            <tbody className="divide-y">
              {(list.data || []).map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">{new Date(r.effective_from).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium">₹{Number(r.rate_per_liter).toFixed(4)}</td>
                  <td className="px-4 py-3">{Number(r.free_tier_liters).toLocaleString("en-IN")}</td>
                </tr>
              ))}
              {!list.data?.length && <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No rates configured.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}