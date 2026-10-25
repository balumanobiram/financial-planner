import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "../../lib/cn";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  /** Element inside the right edge of the input (e.g. a show-password button). */
  trailing?: ReactNode;
};

export function TextField({ label, error, hint, trailing, id, className, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            // 16px text: iOS zooms the page when focusing anything smaller.
            "h-11 w-full rounded-xl border bg-surface px-3.5 text-base text-ink placeholder:text-muted/70",
            "focus:border-primary focus:ring-2 focus:ring-primary/25 focus:outline-none",
            error ? "border-negative" : "border-line",
            trailing ? "pr-11" : undefined,
          )}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {message && (
        <p id={messageId} className={cn("mt-1.5 text-xs", error ? "font-medium text-negative" : "text-muted")}>
          {message}
        </p>
      )}
    </div>
  );
}
