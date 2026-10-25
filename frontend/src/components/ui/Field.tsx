import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "../../lib/cn";

type FieldShellProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: (describedBy: string | undefined) => ReactNode;
  className?: string;
};

/** Label + control + hint/error message, wired up for screen readers. */
function FieldShell({ id, label, error, hint, children, className }: FieldShellProps) {
  const message = error ?? hint;
  const messageId = `${id}-message`;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children(message ? messageId : undefined)}
      {message && (
        <p id={messageId} className={cn("mt-1.5 text-xs", error ? "font-medium text-negative" : "text-muted")}>
          {message}
        </p>
      )}
    </div>
  );
}

const controlClass = (error?: string) =>
  cn(
    // 16px text: iOS zooms the page when focusing anything smaller.
    "w-full rounded-xl border bg-surface px-3.5 text-base text-ink placeholder:text-muted/70",
    "focus:border-primary focus:ring-2 focus:ring-primary/25 focus:outline-none",
    error ? "border-negative" : "border-line",
  );

type CommonProps = { label: string; error?: string; hint?: string };

export function TextField({
  label,
  error,
  hint,
  trailing,
  id,
  className,
  ...rest
}: CommonProps & InputHTMLAttributes<HTMLInputElement> & { trailing?: ReactNode }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <FieldShell id={inputId} label={label} error={error} hint={hint} className={className}>
      {(describedBy) => (
        <div className="relative">
          <input
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(controlClass(error), "h-11", trailing ? "pr-11" : undefined)}
            {...rest}
          />
          {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
        </div>
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  id,
  className,
  children,
  ...rest
}: CommonProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <FieldShell id={selectId} label={label} error={error} hint={hint} className={className}>
      {(describedBy) => (
        <div className="relative">
          <select
            id={selectId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(controlClass(error), "h-11 cursor-pointer appearance-none pr-10")}
            {...rest}
          >
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        </div>
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  id,
  className,
  ...rest
}: CommonProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const autoId = useId();
  const areaId = id ?? autoId;
  return (
    <FieldShell id={areaId} label={label} error={error} hint={hint} className={className}>
      {(describedBy) => (
        <textarea
          id={areaId}
          rows={3}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlClass(error), "resize-y py-2.5")}
          {...rest}
        />
      )}
    </FieldShell>
  );
}
