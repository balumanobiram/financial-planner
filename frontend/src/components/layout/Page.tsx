import { Plus } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { APP_NAME } from "../../config";
import { Button } from "../ui/Button";

type PageProps = {
  title: string;
  subtitle?: string;
  /** Primary "Add" action: a header button on desktop, a floating + button on phones. */
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
            // Wrapper does the hiding: Button's own `inline-flex` would override a `hidden` class.
            <span className="hidden lg:contents">
              <Button onClick={onAdd} icon={<Plus className="size-4" aria-hidden />} iconPosition="right">
                {addLabel}
              </Button>
            </span>
          )}
        </div>
      </header>

      {children}

      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full bg-accent text-accent-fg shadow-lg shadow-sidebar/20 transition-transform active:scale-95 lg:hidden"
        >
          <Plus className="size-6" aria-hidden />
        </button>
      )}
    </>
  );
}
