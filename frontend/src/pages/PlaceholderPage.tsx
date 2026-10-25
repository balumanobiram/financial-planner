import type { LucideIcon } from "lucide-react";

import { Page } from "../components/layout/Page";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";

type PlaceholderPageProps = { title: string; icon: LucideIcon; description: string };

/** Stand-in for screens that are built in later tasks. */
export function PlaceholderPage({ title, icon, description }: PlaceholderPageProps) {
  return (
    <Page title={title}>
      <Card>
        <EmptyState icon={icon} title={`${title} is coming soon`} description={description} />
      </Card>
    </Page>
  );
}
