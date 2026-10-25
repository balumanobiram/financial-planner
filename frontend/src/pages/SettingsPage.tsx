import { LogOut, Palette } from "lucide-react";
import { Link } from "react-router";

import { useMe } from "../api/auth";
import { useLogout } from "../api/useLogout";
import { Page } from "../components/layout/Page";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";

export function SettingsPage() {
  const { data: me, isPending } = useMe();
  const logout = useLogout();

  return (
    <Page title="Settings">
      <div className="grid gap-5 lg:max-w-2xl">
        <Card>
          <h2 className="text-lg font-semibold">Account</h2>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-muted">Signed in as</p>
              {isPending ? <Skeleton className="mt-1 h-5 w-28" /> : <p className="truncate font-semibold">{me?.username}</p>}
            </div>
            <Button variant="secondary" onClick={logout} icon={<LogOut className="size-4" aria-hidden />}>
              Log out
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Design</h2>
          <p className="mt-1 text-sm text-muted">Every UI component with sample data.</p>
          <Link
            to="/styleguide"
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-surface-muted px-4 text-sm font-semibold hover:bg-line"
          >
            <Palette className="size-4" aria-hidden />
            Open styleguide
          </Link>
        </Card>
      </div>
    </Page>
  );
}
