import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "secretary" | "consumer";

const ACTIVE_ROLE_KEY = "sf_active_role";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export function useMyRoles(user: User | null | undefined) {
  return useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<AppRole[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
  });
}

function readStoredRole(): AppRole | null {
  if (typeof window === "undefined") return null;
  const v = window.sessionStorage.getItem(ACTIVE_ROLE_KEY);
  return v === "admin" || v === "secretary" || v === "consumer" ? v : null;
}

export function useActiveRole(availableRoles: AppRole[] | undefined) {
  const [active, setActive] = useState<AppRole | null>(() => readStoredRole());

  useEffect(() => {
    if (!availableRoles?.length) return;
    const stored = readStoredRole();
    if (stored && availableRoles.includes(stored)) {
      if (active !== stored) setActive(stored);
      return;
    }
    // Fall back to highest privilege the user has
    const order: AppRole[] = ["admin", "secretary", "consumer"];
    const fallback = order.find((r) => availableRoles.includes(r)) ?? null;
    if (fallback) {
      window.sessionStorage.setItem(ACTIVE_ROLE_KEY, fallback);
      setActive(fallback);
    }
  }, [availableRoles, active]);

  const change = useCallback((r: AppRole) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(ACTIVE_ROLE_KEY, r);
    }
    setActive(r);
  }, []);

  return { activeRole: active, setActiveRole: change };
}

// Back-compat: highest role for callers that only need one
export function useMyRole(user: User | null | undefined) {
  const q = useMyRoles(user);
  const order: Record<AppRole, number> = { admin: 1, secretary: 2, consumer: 3 };
  const role = q.data?.length
    ? [...q.data].sort((a, b) => order[a] - order[b])[0]
    : null;
  return { ...q, data: role };
}

export function useMyProfile(user: User | null | undefined) {
  return useQuery({
    queryKey: ["my-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
