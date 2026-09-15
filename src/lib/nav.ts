import type { NavItem } from "@/components/DashboardLayout";

export const ADMIN_NAV: NavItem[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "Users", href: "/admin/users" },
  { label: "Consumers", href: "/admin/consumers" },
  { label: "Locations", href: "/admin/locations" },
  { label: "Rates", href: "/admin/rates" },
  { label: "Invoices", href: "/admin/invoices" },
  { label: "Analytics", href: "/admin/analytics" },
];

export const SECRETARY_NAV: NavItem[] = [
  { label: "Dashboard", href: "/secretary" },
  { label: "My consumers", href: "/secretary/users" },
  { label: "Invoices", href: "/secretary/invoices" },
];

export const CONSUMER_NAV: NavItem[] = [
  { label: "Dashboard", href: "/consumer" },
];