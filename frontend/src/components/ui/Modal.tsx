import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Action buttons; stacked full-width on phones, right-aligned on desktop. */
  footer?: ReactNode;
};

/**
 * Centered dialog on desktop, bottom sheet on phones.
 * Built on the native <dialog>: focus trapping, Esc-to-close and screen-reader
 * semantics come from the browser. Content only mounts while open, so forms reset.
 */
export function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click whose target is the <dialog> itself landed on the backdrop.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none rounded-t-3xl bg-surface p-0 text-ink shadow-xl " +
        "backdrop:bg-ink/40 motion-safe:animate-sheet-up " +
        "sm:m-auto sm:max-w-lg sm:rounded-card sm:motion-safe:animate-pop-in"
      }
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
          <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-2 sm:px-6 sm:pt-6">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-muted hover:text-ink"
            >
              <X className="size-5" aria-hidden />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-3 sm:px-6">{children}</div>
          {footer && (
            <footer className="flex flex-col-reverse gap-2 border-t border-line px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6 sm:pb-5">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}
