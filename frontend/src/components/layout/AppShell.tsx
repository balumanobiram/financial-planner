import { Outlet } from "react-router";

import { QuickAddProvider } from "../../features/transactions/QuickAdd";
import { cn } from "../../lib/cn";
import { useStoredBoolean } from "../../lib/useStoredBoolean";
import { BottomNav } from "./BottomNav";
import { Sidebar } from "./Sidebar";

/** Logged-in layout: sidebar (desktop) or bottom tabs (mobile) around the current page, plus Quick add everywhere. */
export function AppShell() {
  const [collapsed, setCollapsed] = useStoredBoolean("planner.sidebarCollapsed", false);

  return (
    <QuickAddProvider>
      <div className="min-h-dvh">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        <div className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-20" : "lg:pl-64")}>
          {/* pb-28 keeps content clear of the mobile tab bar + floating button */}
          <main className="mx-auto max-w-7xl px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-28">
            <Outlet />
          </main>
        </div>
        <BottomNav />
      </div>
    </QuickAddProvider>
  );
}
