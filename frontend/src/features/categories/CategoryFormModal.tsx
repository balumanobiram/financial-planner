import { useId, useState, type FormEvent } from "react";

import { useCategories, useSaveCategory, type Category, type CategoryKind } from "../../api/categories";
import { Button } from "../../components/ui/Button";
import { CategoryIcon } from "../../components/ui/CategoryIcon";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "../../lib/categoryIcons";
import { TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { cn } from "../../lib/cn";
import { CATEGORY_KINDS, validateCategoryForm, type CategoryFormValues } from "./categoryForm";

export type CategoryFormTarget = { mode: "create"; kind?: CategoryKind } | { mode: "edit"; category: Category } | null;

type Props = { target: CategoryFormTarget; onClose: () => void; onSaved?: (category: Category) => void };

export function CategoryFormModal({ target, onClose, onSaved }: Props) {
  const formId = useId();
  const save = useSaveCategory();
  const close = () => {
    save.reset();
    onClose();
  };
  const editing = target?.mode === "edit" ? target.category : undefined;

  return (
    <Modal
      open={target !== null}
      onClose={close}
      title={editing ? `Edit ${editing.name}` : "New category"}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {editing ? "Save" : "Add category"}
          </Button>
        </>
      }
    >
      {target && (
        <CategoryForm
          formId={formId}
          target={target}
          serverError={save.isError ? save.error.message : undefined}
          onSubmit={(input) =>
            save.mutate(
              { id: editing?.id, input },
              {
                onSuccess: (saved) => {
                  onSaved?.(saved);
                  close();
                },
              },
            )
          }
        />
      )}
    </Modal>
  );
}

function CategoryForm({
  formId,
  target,
  serverError,
  onSubmit,
}: {
  formId: string;
  target: NonNullable<CategoryFormTarget>;
  serverError?: string;
  onSubmit: (input: NonNullable<ReturnType<typeof validateCategoryForm>["input"]>) => void;
}) {
  const categories = useCategories();
  const editing = target.mode === "edit" ? target.category : undefined;
  const [values, setValues] = useState<CategoryFormValues>(
    editing
      ? { name: editing.name, icon: editing.icon, color: editing.color, kind: editing.kind }
      : { name: "", icon: "Tag", color: CATEGORY_COLORS[6], kind: (target.mode === "create" && target.kind) || "expense" },
  );
  const [errors, setErrors] = useState<Partial<Record<keyof CategoryFormValues, string>>>({});
  const set = <K extends keyof CategoryFormValues>(key: K, value: CategoryFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation(); // this form can open on top of Quick add — don't submit that one too
    const result = validateCategoryForm(values, categories.data?.items ?? [], editing?.id);
    setErrors(result.errors);
    if (result.input) onSubmit(result.input);
  };

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-5 pb-2">
      {serverError && <Notice tone="error">{serverError}</Notice>}

      <div className="flex items-end gap-3">
        <CategoryIcon icon={values.icon} color={values.color} className="mb-0.5 size-11" />
        <TextField
          label="Name"
          className="flex-1"
          placeholder="Pet care"
          maxLength={50}
          data-autofocus
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          error={errors.name}
        />
      </div>

      <div role="radiogroup" aria-label="Used for" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1">
        {CATEGORY_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            role="radio"
            aria-checked={values.kind === k.value}
            onClick={() => set("kind", k.value)}
            className={cn("h-9 rounded-lg text-sm font-semibold", values.kind === k.value ? "bg-surface shadow-sm" : "text-muted")}
          >
            {k.label}
          </button>
        ))}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Colour</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={values.color === color}
              onClick={() => set("color", color)}
              className={cn("size-8 rounded-full ring-offset-2 ring-offset-surface", values.color === color && "ring-2 ring-ink")}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        {errors.color && <p className="mt-1.5 text-xs font-medium text-negative">{errors.color}</p>}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Icon</legend>
        <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-9">
          {Object.entries(CATEGORY_ICONS).map(([name, Icon]) => (
            <button
              key={name}
              type="button"
              aria-label={name.replace(/([a-z])([A-Z0-9])/g, "$1 $2")}
              aria-pressed={values.icon === name}
              onClick={() => set("icon", name)}
              className={cn(
                "grid aspect-square place-items-center rounded-lg",
                values.icon === name ? "bg-tint-blue text-primary ring-2 ring-primary" : "text-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              <Icon className="size-5" aria-hidden />
            </button>
          ))}
        </div>
        {errors.icon && <p className="mt-1.5 text-xs font-medium text-negative">{errors.icon}</p>}
      </fieldset>
    </form>
  );
}
