import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link, NavLink } from "react-router";

import { useMe } from "../../api/auth";
import { APP_NAME } from "../../config";
import { cn } from "../../lib/cn";
import { NAV_ITEMS, type NavItem } from "./nav";

type SidebarProps = { collapsed: boolean; onToggle: () => void };

/** Desktop-only (≥1024px) fixed navigation. */
export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { data: me, isError } = useMe();
  const username = me?.username ?? (isError ? "Account" : "…");

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar text-sidebar-fg transition-[width] duration-200 lg:flex",
        collapsed ? "w-20" : "w-64",
      )}
    >
      <div className={cn("flex h-16 shrink-0 items-center px-4", collapsed ? "justify-center" : "justify-between pl-6")}>
        {!collapsed && <span className="text-xl font-bold text-white">{APP_NAME}</span>}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="grid size-9 place-items-center rounded-lg hover:bg-sidebar-hover hover:text-white"
        >
          {collapsed ? <PanelLeftOpen className="size-5" aria-hidden /> : <PanelLeftClose className="size-5" aria-hidden />}
        </button>
      </div>

      <Link
        to="/settings"
        title={collapsed ? username : undefined}
        className={cn(
          "mx-3 mt-2 flex items-center gap-3 rounded-xl bg-sidebar-hover py-2.5 text-white hover:bg-white/12",
          collapsed ? "justify-center px-0" : "px-3",
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-active text-sm font-bold text-sidebar uppercase">
          {username.charAt(0)}
        </span>
        {!collapsed && <span className="truncate text-sm font-semibold">{username}</span>}
      </Link>

      <nav aria-label="Main" className="mt-6 flex-1 space-y-1 overflow-y-auto px-3">
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>
    </aside>
  );
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { icon: Icon, label } = item;
  const base = cn("flex h-11 items-center gap-3 rounded-xl text-sm font-medium", collapsed ? "justify-center" : "px-3");

  if (item.soon) {
    return (
      <span aria-disabled="true" title={`${label} — coming soon`} className={cn(base, "cursor-not-allowed text-sidebar-fg/50")}>
        <Icon className="size-5 shrink-0" aria-hidden />
        {!collapsed && (
          <>
            {label}
            <span className="ml-auto rounded-md bg-sidebar-hover px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
              soon
            </span>
          </>
        )}
      </span>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          base,
          "transition-colors",
          isActive ? "bg-sidebar-hover text-sidebar-active" : "hover:bg-sidebar-hover hover:text-white",
        )
      }
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      {!collapsed && label}
    </NavLink>
  );
}
