import { QueryClientProvider } from "@tanstack/react-query";
import { ArrowLeftRight, CreditCard, Landmark, LayoutDashboard, Users } from "lucide-react";
import { Navigate, createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { AppShell } from "./components/layout/AppShell";
import { RequireAuth } from "./components/layout/RequireAuth";
import { queryClient } from "./lib/queryClient";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SettingsPage } from "./pages/SettingsPage";

// Client-side route table (≈ @RequestMapping). Everything inside <RequireAuth> needs a login.
const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      {
        index: true,
        element: <PlaceholderPage title="Dashboard" icon={LayoutDashboard} description="Balances, dues and spending at a glance." />,
      },
      {
        path: "accounts",
        element: <PlaceholderPage title="Accounts" icon={Landmark} description="Your bank accounts and wallets — next step." />,
      },
      {
        path: "cards",
        element: <PlaceholderPage title="Cards" icon={CreditCard} description="Credit cards, statements and due dates." />,
      },
      {
        path: "people",
        element: <PlaceholderPage title="People" icon={Users} description="Who owes whom, and settlements." />,
      },
      {
        path: "transactions",
        element: <PlaceholderPage title="Transactions" icon={ArrowLeftRight} description="Every rupee in and out." />,
      },
      { path: "settings", element: <SettingsPage /> },
      {
        path: "styleguide",
        // Loaded on demand so the chart library isn't in the main bundle.
        lazy: async () => ({ Component: (await import("./pages/StyleguidePage")).StyleguidePage }),
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
