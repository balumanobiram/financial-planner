import { Plus } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { APP_NAME } from "../../config";
import { Button } from "../ui/Button";

type PageProps = {
  title: string;
  subtitle?: string;
  /** The page's own "Add" (account, card…): a header button; icon-only on phones. The floating + is always Quick add. */
  onAdd?: () => void;
  addLabel?: string;
  /** Extra header controls (desktop and mobile). */
  actions?: ReactNode;
  children: ReactNode;
};

export function Page({ title, subtitle, onAdd, addLabel = "Add", actions, children }: PageProps) {
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
  }, [title]);

  return (
    <>
      <header className="flex items-center justify-between gap-4 pb-5 lg:pb-6">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold sm:text-[28px]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {onAdd && (
            <Button
              onClick={onAdd}
              aria-label={addLabel}
              icon={<Plus className="size-4" aria-hidden />}
              iconPosition="right"
              className="max-sm:w-10 max-sm:gap-0 max-sm:px-0"
            >
              <span className="max-sm:sr-only">{addLabel}</span>
            </Button>
          )}
        </div>
      </header>

      {children}
    </>
  );
}
