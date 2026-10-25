import { Check, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { BankAccount } from "../../api/accounts";
import type { CreditCard } from "../../api/cards";
import type { Category, CategoryKind } from "../../api/categories";
import type { Person } from "../../api/people";
import { BankLogo } from "../../components/ui/BankLogo";
import { CategoryIcon } from "../../components/ui/CategoryIcon";
import { cn } from "../../lib/cn";
import { formatINR } from "../../lib/money";

/** A labelled group of tap targets, with its validation message. */
export function PickerGroup({ label, error, action, children }: { label: string; error?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        {action}
      </div>
      {children}
      {error && <p className="mt-1.5 text-xs font-medium text-negative">{error}</p>}
    </div>
  );
}

/** Toggle chip (aria-pressed), sized for thumbs: 40px tall. */
export function Chip({ selected, onClick, children, className }: { selected: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-medium whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
        selected ? "border-primary bg-tint-blue text-primary" : "border-line bg-surface hover:bg-surface-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** One horizontally-scrolling row on phones, wrapping on wider screens. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">{children}</div>;
}

const accountLabel = (a: BankAccount) => `${a.nickname}${a.last4 ? ` ••${a.last4}` : ""}`;
const cardLabel = (c: CreditCard) => `${c.card_name}${c.last4 ? ` ••${c.last4}` : ""}`;

type SourceProps = {
  accounts: BankAccount[];
  cards: CreditCard[];
  value: string; // "account:<id>" | "card:<id>"
  onChange: (value: string) => void;
  cardsFirst?: boolean;
};

/** Cards and bank accounts as chips with their bank logos. */
export function SourceChips({ accounts, cards, value, onChange, cardsFirst = true }: SourceProps) {
  const cardChips = cards.map((c) => (
    <Chip key={c.id} selected={value === `card:${c.id}`} onClick={() => onChange(`card:${c.id}`)}>
      <BankLogo name={c.bank_name} logo={c.logo_data_url} size="size-6" className="rounded-md p-0.5" />
      {cardLabel(c)}
    </Chip>
  ));
  const accountChips = accounts.map((a) => (
    <Chip key={a.id} selected={value === `account:${a.id}`} onClick={() => onChange(`account:${a.id}`)}>
      <BankLogo name={a.bank_name} logo={a.logo_data_url} size="size-6" className="rounded-md p-0.5" />
      {accountLabel(a)}
    </Chip>
  ));
  return <ChipRow>{cardsFirst ? [...cardChips, ...accountChips] : [...accountChips, ...cardChips]}</ChipRow>;
}

export function AccountChips({ accounts, value, onChange, exclude }: { accounts: BankAccount[]; value: string; onChange: (id: string) => void; exclude?: string }) {
  return (
    <ChipRow>
      {accounts
        .filter((a) => a.id !== exclude)
        .map((a) => (
          <Chip key={a.id} selected={value === a.id} onClick={() => onChange(a.id)}>
            <BankLogo name={a.bank_name} logo={a.logo_data_url} size="size-6" className="rounded-md p-0.5" />
            {accountLabel(a)}
            <span className="text-xs text-muted tabular-nums">{formatINR(a.current_balance, { showDecimals: false })}</span>
          </Chip>
        ))}
    </ChipRow>
  );
}

export function CardChips({ cards, value, onChange }: { cards: CreditCard[]; value: string; onChange: (id: string) => void }) {
  return (
    <ChipRow>
      {cards.map((c) => (
        <Chip key={c.id} selected={value === c.id} onClick={() => onChange(c.id)}>
          <span className="size-3 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
          {cardLabel(c)}
          <span className="text-xs text-muted tabular-nums">owes {formatINR(c.outstanding, { showDecimals: false })}</span>
        </Chip>
      ))}
    </ChipRow>
  );
}

/** Single-select (income "from") or multi-select (split) people. */
export function PeopleChips({ people, selected, onToggle }: { people: Person[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <ChipRow>
      {people.map((p) => {
        const on = selected.includes(p.id);
        return (
          <Chip key={p.id} selected={on} onClick={() => onToggle(p.id)}>
            {on && <Check className="size-3.5" aria-hidden />}
            {p.name}
          </Chip>
        );
      })}
    </ChipRow>
  );
}

const FIRST_ROWS = 7; // + the "More" tile = 2 rows of 4

/**
 * Category tiles. The ones meant for this kind of entry come first; the rest hide behind "More".
 * Tapping the selected tile again clears it (category is optional).
 */
export function CategoryGrid({
  categories,
  kind,
  value,
  onChange,
  onNew,
}: {
  categories: Category[];
  kind: Exclude<CategoryKind, "any">;
  value: string;
  onChange: (id: string) => void;
  onNew?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const active = categories.filter((c) => !c.is_archived);
  const ordered = [...active.filter((c) => c.kind === kind), ...active.filter((c) => c.kind === "any"), ...active.filter((c) => c.kind !== kind && c.kind !== "any")];
  const selectedIndex = ordered.findIndex((c) => c.id === value);
  const expanded = showAll || selectedIndex >= FIRST_ROWS;
  const shown = expanded ? ordered : ordered.slice(0, FIRST_ROWS);

  const tile = "flex h-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] leading-tight font-medium transition-colors";
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
      {shown.map((c) => {
        const on = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? "" : c.id)}
            className={cn(tile, "focus-visible:outline-2 focus-visible:outline-primary", on ? "bg-tint-blue ring-2 ring-primary" : "hover:bg-surface-muted")}
          >
            <CategoryIcon icon={c.icon} color={c.color} size="sm" />
            <span className="w-full truncate text-center">{c.name}</span>
          </button>
        );
      })}
      {!expanded && ordered.length > FIRST_ROWS ? (
        <button type="button" onClick={() => setShowAll(true)} className={cn(tile, "text-muted hover:bg-surface-muted")}>
          <span className="grid size-8 place-items-center rounded-full bg-surface-muted text-xs font-bold">+{ordered.length - FIRST_ROWS}</span>
          More
        </button>
      ) : (
        onNew && (
          <button type="button" onClick={onNew} className={cn(tile, "text-muted hover:bg-surface-muted")}>
            <span className="grid size-8 place-items-center rounded-full border border-dashed border-muted/60">
              <Plus className="size-4" aria-hidden />
            </span>
            New
          </button>
        )
      )}
    </div>
  );
}
