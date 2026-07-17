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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useMyProfile, type AppRole } from "@/hooks/use-session";
import { createUser, setUserRoles } from "@/lib/admin.functions";
import { deleteConsumer } from "@/lib/consumers.functions";
import { ADMIN_NAV } from "@/lib/nav";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsers,
});

const ALL_ROLES: AppRole[] = ["admin", "secretary", "consumer"];

type UserRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
  user_roles: { role: AppRole }[] | null;
};

function AdminUsers() {
  const { user } = useSession();
  const { data: profile } = useMyProfile(user);
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editRoles, setEditRoles] = useState<AppRole[]>([]);
  const [form, setForm] = useState<{
    fullName: string;
    phone: string;
    email: string;
    roles: AppRole[];
  }>({ fullName: "", phone: "", email: "", roles: ["consumer"] });

  const list = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, email, is_active, created_at, user_roles(role)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as UserRow[];
    },
  });

  const createMut = useMutation({
    mutationFn: async () => createUser({ data: form }),
    onSuccess: () => {
      toast.success("User created.");
      setCreateOpen(false);
      setForm({ fullName: "", phone: "", email: "", roles: ["consumer"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Failed"),
  });

  const rolesMut = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("No user");
      return setUserRoles({ data: { userId: editing.id, roles: editRoles } });
    },
    onSuccess: () => {
      toast.success("Roles updated.");
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

  const toggleRole = (roles: AppRole[], r: AppRole): AppRole[] =>
    roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r];

  return (
    <DashboardLayout
      navItems={ADMIN_NAV}
      title="All users"
      userName={profile?.full_name || null}
      userPhone={profile?.phone || null}
    >
      <div className="mb-4 flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add user
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create user</DialogTitle>
              <DialogDescription>
                Users sign in with their mobile number and a one-time code. Pick one or more roles.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.roles.length) {
                  toast.error("Pick at least one role.");
                  return;
                }
                createMut.mutate();
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
                <Label>Roles</Label>
                <div className="space-y-2 rounded-md border p-3">
                  {ALL_ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm capitalize">
                      <Checkbox
                        checked={form.roles.includes(r)}
                        onCheckedChange={() =>
                          setForm({ ...form, roles: toggleRole(form.roles, r) })
                        }
                      />
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
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Roles</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(list.data || []).map((u) => {
                  const roles = (u.user_roles || []).map((r) => r.role);
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-3 font-medium">{u.full_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {u.phone || u.email || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {roles.length ? (
                            roles.map((r) => (
                              <Badge key={r} variant="outline" className="capitalize">
                                {r}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">none</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {u.is_active ? (
                          <Badge>Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(u);
                            setEditRoles(roles.length ? roles : ["consumer"]);
                          }}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Roles
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
                {!list.data?.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage roles</DialogTitle>
            <DialogDescription>
              {editing?.full_name || editing?.phone} — pick one or more roles this user can sign in as.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-md border p-3">
            {ALL_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm capitalize">
                <Checkbox
                  checked={editRoles.includes(r)}
                  onCheckedChange={() => setEditRoles(toggleRole(editRoles, r))}
                />
                {r}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!editRoles.length) {
                  toast.error("Pick at least one role.");
                  return;
                }
                rolesMut.mutate();
              }}
              disabled={rolesMut.isPending}
            >
              {rolesMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
