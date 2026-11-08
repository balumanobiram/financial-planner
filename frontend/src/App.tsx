import { QueryClientProvider } from "@tanstack/react-query";
import { Navigate, createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import { AppShell } from "./components/layout/AppShell";
import { RequireAuth } from "./components/layout/RequireAuth";
import { queryClient } from "./lib/queryClient";
import { LoginPage } from "./pages/LoginPage";

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
      // Lazy like the other pages; it also pulls in the chart library, which the login page doesn't need.
      { index: true, lazy: async () => ({ Component: (await import("./features/dashboard/DashboardPage")).DashboardPage }) },
      // Each page is its own chunk, downloaded the first time you open it (keeps the first load small).
      { path: "accounts", lazy: async () => ({ Component: (await import("./features/accounts/AccountsPage")).AccountsPage }) },
      { path: "cards", lazy: async () => ({ Component: (await import("./features/cards/CardsPage")).CardsPage }) },
      { path: "people", lazy: async () => ({ Component: (await import("./features/people/PeoplePage")).PeoplePage }) },
      {
        path: "people/:personId",
        lazy: async () => ({ Component: (await import("./features/people/PersonDetailPage")).PersonDetailPage }),
      },
      {
        path: "transactions",
        lazy: async () => ({ Component: (await import("./features/transactions/TransactionsPage")).TransactionsPage }),
      },
      { path: "reports", lazy: async () => ({ Component: (await import("./features/reports/ReportsPage")).ReportsPage }) },
      { path: "import", lazy: async () => ({ Component: (await import("./features/imports/ImportPage")).ImportPage }) },
      { path: "settings", lazy: async () => ({ Component: (await import("./pages/SettingsPage")).SettingsPage }) },
      // Also keeps the chart library out of the main bundle.
      { path: "styleguide", lazy: async () => ({ Component: (await import("./pages/StyleguidePage")).StyleguidePage }) },
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
