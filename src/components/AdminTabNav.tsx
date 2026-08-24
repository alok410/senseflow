import { Link, useLocation } from "@tanstack/react-router";

export function AdminTabNav() {
  const location = useLocation();
  const tabs = [
    { label: "Users", href: "/admin/users" },
    { label: "Consumers", href: "/admin/consumers" },
    { label: "Secretaries", href: "/admin/secretaries" },
    { label: "Locations", href: "/admin/locations" },
  ];

  return (
    <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const isActive = location.pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            to={tab.href}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              isActive
                ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
