import { cn } from "../../lib/cn";
import { formatINR, isNegative } from "../../lib/money";

type MoneyProps = {
  /** Decimal string from the API, e.g. "-1250.00" */
  value: string;
  showDecimals?: boolean;
  className?: string;
};

export function Money({ value, showDecimals = true, className }: MoneyProps) {
  return (
    <span className={cn("tabular-nums", isNegative(value) && "text-negative", className)}>
      {formatINR(value, { showDecimals })}
    </span>
  );
}
