import {
  ArrowLeftRight,
  ChartColumn,
  CreditCard,
  Landmark,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Shown but disabled with a "soon" tag. */
  soon?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Accounts", to: "/accounts", icon: Landmark },
  { label: "Cards", to: "/cards", icon: CreditCard },
  { label: "People", to: "/people", icon: Users },
  { label: "Transactions", to: "/transactions", icon: ArrowLeftRight },
  { label: "Reports", to: "/reports", icon: ChartColumn, soon: true },
  { label: "Settings", to: "/settings", icon: Settings },
];

/** Bottom tab bar on phones; everything else lives under "More". */
const MOBILE_TAB_PATHS = ["/", "/accounts", "/cards", "/transactions"];

export const MOBILE_TABS = NAV_ITEMS.filter((item) => MOBILE_TAB_PATHS.includes(item.to));
export const MORE_ITEMS = NAV_ITEMS.filter((item) => !MOBILE_TAB_PATHS.includes(item.to));
