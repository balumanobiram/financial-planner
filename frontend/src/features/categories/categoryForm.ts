import type { Category, CategoryInput, CategoryKind } from "../../api/categories";
import { CATEGORY_ICONS } from "../../lib/categoryIcons";

export type CategoryFormValues = { name: string; icon: string; color: string; kind: CategoryKind };

export const CATEGORY_KINDS: ReadonlyArray<{ value: CategoryKind; label: string }> = [
  { value: "expense", label: "Spending" },
  { value: "income", label: "Income" },
  { value: "any", label: "Both" },
];

export function validateCategoryForm(
  values: CategoryFormValues,
  existing: Category[],
  editingId?: string,
): { errors: Partial<Record<keyof CategoryFormValues, string>>; input: CategoryInput | null } {
  const errors: Partial<Record<keyof CategoryFormValues, string>> = {};
  const name = values.name.trim().replace(/\s+/g, " ");
  if (!name) errors.name = "Give it a name.";
  else if (name.length > 50) errors.name = "Keep it under 50 characters.";
  // The backend enforces this too (unique on lower(name)); checking here gives a friendlier message sooner.
  else if (existing.some((c) => c.id !== editingId && c.name.toLowerCase() === name.toLowerCase())) {
    errors.name = `"${name}" already exists${existing.find((c) => c.name.toLowerCase() === name.toLowerCase())?.is_archived ? " (archived — unarchive it in Settings)" : ""}.`;
  }
  if (!(values.icon in CATEGORY_ICONS)) errors.icon = "Pick an icon.";
  if (!/^#[0-9a-f]{6}$/i.test(values.color)) errors.color = "Pick a colour.";
  if (Object.keys(errors).length) return { errors, input: null };
  return { errors, input: { name, icon: values.icon, color: values.color.toLowerCase(), kind: values.kind } };
}
