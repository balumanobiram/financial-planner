import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { useLocation } from "react-router";

import { useDeleteTransaction } from "../../api/transactions";
import { cn } from "../../lib/cn";
import { QuickAddSheet } from "./QuickAddSheet";
import { QuickAddContext, type OpenQuickAdd } from "./quickAddContext";
import type { QuickAddValues } from "./transactionForm";

type Toast = { text: string; undoId: string } | null;

/**
 * Wraps the logged-in app (≈ an app-wide Spring bean): owns the Quick add sheet,
 * the floating + button on every page, the "n" shortcut, and the "Saved · Undo" toast.
 */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [prefill, setPrefill] = useState<Partial<QuickAddValues> | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const open = useCallback<OpenQuickAdd>((p) => setPrefill(p ?? {}), []);
  // The import review has its own sticky action bar where the button would sit.
  const showButton = !useLocation().pathname.startsWith("/import");

  // Desktop shortcut: press "n" anywhere that isn't a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true], dialog[open]")) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <QuickAddContext.Provider value={open}>
      {children}

      {showButton && (
        <button
          type="button"
          onClick={() => open()}
          aria-label="Add transaction"
          title="Add transaction (N)"
          className={cn(
            "fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full",
            "bg-accent text-accent-fg shadow-lg shadow-sidebar/25 transition-transform hover:bg-accent-hover active:scale-95",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary lg:right-8 lg:bottom-8",
          )}
        >
          <Plus className="size-6" aria-hidden />
        </button>
      )}

      <QuickAddSheet
        prefill={prefill}
        onClose={() => setPrefill(null)}
        onSaved={(text, undoId) => setToast({ text, undoId })}
      />
      <SavedToast toast={toast} onDismiss={() => setToast(null)} />
    </QuickAddContext.Provider>
  );
}

function SavedToast({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const remove = useDeleteTransaction();
  const timer = useRef<number>(undefined);
  // Effect events read the latest props without re-running the effect (≈ a callback, not a dependency).
  const start = useEffectEvent(() => {
    remove.reset();
    timer.current = window.setTimeout(onDismiss, 6000);
  });

  useEffect(() => {
    if (!toast) return;
    start();
    return () => window.clearTimeout(timer.current);
  }, [toast]); // restart only when a new toast arrives

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 lg:bottom-8">
      {toast && (
        <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-sidebar py-2.5 pr-2 pl-4 text-sm text-white shadow-xl motion-safe:animate-pop-in">
          <span className="min-w-0 flex-1">{remove.isSuccess ? "Removed." : remove.isError ? remove.error.message : toast.text}</span>
          {!remove.isSuccess && (
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(toast.undoId, { onSuccess: () => (timer.current = window.setTimeout(onDismiss, 1500)) })}
              className="h-8 rounded-lg px-3 font-semibold text-sidebar-active hover:bg-white/10 disabled:opacity-60"
            >
              Undo
            </button>
          )}
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="grid size-8 place-items-center rounded-lg text-white/70 hover:bg-white/10">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
