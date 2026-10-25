import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { NavLink, useLocation } from "react-router";

import { cn } from "../../lib/cn";
import { Modal } from "../ui/Modal";
import { MOBILE_TABS, MORE_ITEMS } from "./nav";

const tabClass = (active: boolean) =>
  cn(
    "flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
    active ? "text-sidebar-active" : "text-sidebar-fg",
  );

/** Phone/tablet (<1024px) bottom tab bar. */
export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const moreActive = MORE_ITEMS.some((item) => pathname.startsWith(item.to));

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-sidebar pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {MOBILE_TABS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink to={to} end={to === "/"} className={({ isActive }) => tabClass(isActive)}>
                <Icon className="size-5" aria-hidden />
                {label}
              </NavLink>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setMoreOpen(true)} className={tabClass(moreActive)} aria-haspopup="dialog">
              <Ellipsis className="size-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="-mx-2 pb-3">
          {MORE_ITEMS.map(({ to, label, icon: Icon, soon }) => (
            <li key={to}>
              {soon ? (
                <span aria-disabled="true" className="flex h-12 items-center gap-3 rounded-xl px-3 text-muted">
                  <Icon className="size-5" aria-hidden />
                  {label}
                  <span className="ml-auto rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase">soon</span>
                </span>
              ) : (
                <NavLink
                  to={to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn("flex h-12 items-center gap-3 rounded-xl px-3 font-medium", isActive ? "bg-tint-blue text-primary" : "hover:bg-surface-muted")
                  }
                >
                  <Icon className="size-5" aria-hidden />
                  {label}
                </NavLink>
              )}
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
