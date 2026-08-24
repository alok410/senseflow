import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, ShieldCheck, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile, type AppRole } from "@/hooks/use-session";
import { createUser, updateUser, getAdminUsersList } from "@/lib/admin.functions";
import { deleteConsumer } from "@/lib/consumers.functions";
import {
  adminStartNumberChange, adminVerifyOldSendNew, adminConfirmNewNumber,
} from "@/lib/otp.functions";
import { ADMIN_NAV } from "@/lib/nav";
import { AdminTabNav } from "@/components/AdminTabNav";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsers,
});

const ALL_ROLES: AppRole[] = ["admin", "secretary", "consumer"];

type UserRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  phone_secondary: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  user_roles: { role: AppRole }[] | null;
};

function AdminUsers() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const getUsersFn = useServerFn(getAdminUsersList);
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [form, setForm] = useState({
    fullName: "", phone: "", phoneSecondary: "", email: "", roles: ["secretary"] as AppRole[],
  });

  // Edit
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", phone: "", phoneSecondary: "", roles: [] as AppRole[] });

  // Secure number change (admin accounts)
  const [secure, setSecure] = useState<UserRow | null>(null);
  const [secureStep, setSecureStep] = useState<"start" | "old" | "new">("start");
  const [secureNew, setSecureNew] = useState("");
  const [secureCode, setSecureCode] = useState("");
  const [sentTo, setSentTo] = useState("");

  const list = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => (await getUsersFn()) as UserRow[],
  });

  const createMut = useMutation({
    mutationFn: async () => createUser({ data: {
      fullName: form.fullName,
      phone: form.phone,
      phoneSecondary: form.phoneSecondary || undefined,
      email: form.email || undefined,
      roles: form.roles,
    } }),
    onSuccess: () => {
      toast.success("User created.");
      setCreateOpen(false);
      setForm({ fullName: "", phone: "", phoneSecondary: "", email: "", roles: ["secretary"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const editIsAdmin = !!editing?.user_roles?.some((r) => r.role === "admin");

  const editMut = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("No user");
      return updateUser({ data: {
        userId: editing.id,
        fullName: editForm.fullName,
        // Admin primary number must go through the secure OTP flow — omit it here.
        phone: editIsAdmin ? undefined : (editForm.phone || undefined),
        phoneSecondary: editForm.phoneSecondary || undefined,
        clearSecondary: !editForm.phoneSecondary,
        roles: editForm.roles.length ? editForm.roles : undefined,
      } });
    },
    onSuccess: () => {
      toast.success("Saved.");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: async (userId: string) => deleteConsumer({ data: { userId } }),
    onSuccess: () => {
      toast.success("User deleted.");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-consumers"] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  // Secure number-change mutations
  const startMut = useMutation({
    mutationFn: async () => {
      if (!secure) throw new Error("No user");
      return adminStartNumberChange({ data: { userId: secure.id, newPhone: secureNew } });
    },
    onSuccess: (r) => { setSentTo(r.sentTo); setSecureStep("old"); setSecureCode(""); toast.success(`OTP sent to current number ${r.sentTo}`); },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed"),
  });
  const verifyOldMut = useMutation({
    mutationFn: async () => {
      if (!secure) throw new Error("No user");
      return adminVerifyOldSendNew({ data: { userId: secure.id, code: secureCode } });
    },
    onSuccess: (r) => { setSentTo(r.sentTo); setSecureStep("new"); setSecureCode(""); toast.success(`OTP sent to new number ${r.sentTo}`); },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed"),
  });
  const confirmNewMut = useMutation({
    mutationFn: async () => {
      if (!secure) throw new Error("No user");
      return adminConfirmNewNumber({ data: { userId: secure.id, code: secureCode } });
    },
    onSuccess: () => {
      toast.success("Number updated.");
      setSecure(null); setSecureStep("start"); setSecureNew(""); setSecureCode("");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const toggleRole = (roles: AppRole[], r: AppRole): AppRole[] =>
    roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setEditForm({
      fullName: u.full_name || "",
      phone: u.phone || "",
      phoneSecondary: u.phone_secondary || "",
      roles: (u.user_roles || []).map((r) => r.role),
    });
  };

  const openSecure = (u: UserRow) => {
    setSecure(u);
    setSecureStep("start");
    setSecureNew("");
    setSecureCode("");
    setSentTo("");
  };

  const filteredUsers = (list.data || []).filter((u) => {
    const roles = (u.user_roles || []).map((r) => r.role);
    if (roleFilter !== "all" && !roles.includes(roleFilter as AppRole)) {
      return false;
    }
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      (u.full_name || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q) ||
      (u.phone_secondary || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q)
    );
  });

  return (
    <DashboardLayout
      navItems={ADMIN_NAV}
      title="Users management"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <AdminTabNav />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search user name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex items-center rounded-lg border bg-muted/30 p-1 gap-1">
            {[
              { id: "all", label: "All users" },
              { id: "secretary", label: "Secretaries" },
              { id: "admin", label: "Admins" },
              { id: "consumer", label: "Consumers" },
            ].map((f) => (
              <Button
                key={f.id}
                size="sm"
                variant={roleFilter === f.id ? "default" : "ghost"}
                className="h-7 text-xs px-2.5"
                onClick={() => setRoleFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Add user</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create user</DialogTitle>
              <DialogDescription>
                Users sign in with their mobile number and a one-time code — no self sign-up. Pick one or more roles.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.roles.length) { toast.error("Pick at least one role."); return; }
                createMut.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone (login number)</Label>
                <Input id="phone" placeholder="+919876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone2">Second number (optional — also logs in)</Label>
                <Input id="phone2" placeholder="+918780488532" value={form.phoneSecondary} onChange={(e) => setForm({ ...form, phoneSecondary: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email (optional)</Label>
                <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Roles</Label>
                <div className="space-y-2 rounded-md border p-3">
                  {ALL_ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm capitalize">
                      <Checkbox checked={form.roles.includes(r)} onCheckedChange={() => setForm({ ...form, roles: toggleRole(form.roles, r) })} />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMut.isPending}>
                  {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                  <th className="px-4 py-3">Numbers</th>
                  <th className="px-4 py-3">Roles</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredUsers.map((u) => {
                  const roles = (u.user_roles || []).map((r) => r.role);
                  const isAdmin = roles.includes("admin");
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-3 font-medium">{u.full_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>{u.phone || u.email || "—"}</div>
                        {u.phone_secondary && <div className="text-xs">2nd: {u.phone_secondary}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {roles.length
                            ? roles.map((r) => <Badge key={r} variant="outline" className="capitalize">{r}</Badge>)
                            : <span className="text-xs text-muted-foreground">none</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {u.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isAdmin && (
                          <Button size="sm" variant="ghost" title="Secure number change (OTP)" onClick={() => openSecure(u)}>
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={u.id === user?.id}
                          onClick={() => {
                            if (confirm(`Delete ${u.full_name || u.phone}? This removes the user and all their data.`)) {
                              deleteMut.mutate(u.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!staffUsers.length && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No staff users yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit account */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit account</DialogTitle>
            <DialogDescription>{editing?.full_name || editing?.phone}</DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!editForm.roles.length) { toast.error("Pick at least one role."); return; }
                editMut.mutate();
              }}
            >
              <div className="space-y-2">
                <Label>Full name</Label>
                <Input value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Primary number (login)</Label>
                <Input
                  value={editForm.phone}
                  disabled={editIsAdmin}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  placeholder="+919876543210"
                />
                {editIsAdmin && (
                  <p className="text-xs text-muted-foreground">
                    Admin numbers change through the secure OTP flow — close this and use the <ShieldCheck className="inline h-3 w-3" /> button.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Second number (optional — also logs in)</Label>
                <Input value={editForm.phoneSecondary} onChange={(e) => setEditForm({ ...editForm, phoneSecondary: e.target.value })} placeholder="+918780488532" />
              </div>
              <div className="space-y-2">
                <Label>Roles</Label>
                <div className="space-y-2 rounded-md border p-3">
                  {ALL_ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm capitalize">
                      <Checkbox checked={editForm.roles.includes(r)} onCheckedChange={() => setEditForm({ ...editForm, roles: toggleRole(editForm.roles, r) })} />
                      {r}
                    </label>
                  ))}
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={editMut.isPending}>
                  {editMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Secure number change (admin): OTP to old number, then OTP to new number */}
      <Dialog open={!!secure} onOpenChange={(o) => { if (!o) { setSecure(null); setSecureStep("start"); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Secure number change</DialogTitle>
            <DialogDescription>
              {secure?.full_name || secure?.phone} — verify the current number, then the new number.
            </DialogDescription>
          </DialogHeader>

          {secureStep === "start" && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); startMut.mutate(); }}>
              <div className="rounded-md border p-3 text-sm">
                <div className="text-xs text-muted-foreground">Current number</div>
                <div className="font-medium">{secure?.phone || "—"}</div>
              </div>
              <div className="space-y-2">
                <Label>New number</Label>
                <Input value={secureNew} onChange={(e) => setSecureNew(e.target.value)} placeholder="+919999999999" required />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={startMut.isPending || !secureNew}>
                  {startMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send OTP to current number
                </Button>
              </DialogFooter>
            </form>
          )}

          {secureStep === "old" && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); verifyOldMut.mutate(); }}>
              <p className="text-sm text-muted-foreground">Enter the 6-digit code sent to the current number ({sentTo}).</p>
              <Input value={secureCode} onChange={(e) => setSecureCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="______" />
              <DialogFooter>
                <Button type="submit" disabled={verifyOldMut.isPending || secureCode.length !== 6}>
                  {verifyOldMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify & send OTP to new number
                </Button>
              </DialogFooter>
            </form>
          )}

          {secureStep === "new" && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); confirmNewMut.mutate(); }}>
              <p className="text-sm text-muted-foreground">Enter the 6-digit code sent to the new number ({sentTo}).</p>
              <Input value={secureCode} onChange={(e) => setSecureCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="______" />
              <DialogFooter>
                <Button type="submit" disabled={confirmNewMut.isPending || secureCode.length !== 6}>
                  {confirmNewMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm new number
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
