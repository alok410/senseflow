import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile } from "@/hooks/use-session";
import { createUser } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsers,
});

const navItems = [
  { label: "Dashboard", href: "/admin" },
  { label: "Users", href: "/admin/users" },
  { label: "Secretaries", href: "/admin/secretaries" },
  { label: "Locations", href: "/admin/locations" },
  { label: "Rates", href: "/admin/rates" },
  { label: "Invoices", href: "/admin/invoices" },
  { label: "Analytics", href: "/admin/analytics" },
];

function AdminUsers() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    role: "consumer" as "admin" | "secretary" | "consumer",
  });

  const list = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, email, is_active, created_at, user_roles!inner(role)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const mut = useMutation({
    mutationFn: async () => createUser({ data: form }),
    onSuccess: () => {
      toast.success("User created.");
      setOpen(false);
      setForm({ fullName: "", phone: "", email: "", role: "consumer" });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  return (
    <DashboardLayout
      navItems={navItems}
      title="All users"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <div className="mb-4 flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add user
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create user</DialogTitle>
              <DialogDescription>
                Users sign in with their mobile number and a one-time code.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                mut.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone (international format)</Label>
                <Input
                  id="phone"
                  placeholder="+919876543210"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as typeof form.role })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consumer">Consumer</SelectItem>
                    <SelectItem value="secretary">Secretary</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={mut.isPending}>
                  {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(list.data || []).map((u: any) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-medium">{u.full_name || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.phone || u.email || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{u.user_roles?.[0]?.role || "consumer"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {!list.data?.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}