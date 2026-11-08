import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { useCategories, useDeleteCategory, useSetCategoryArchived, type Category } from "../../api/categories";
import { Button, IconButton } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { CategoryIcon } from "../../components/ui/CategoryIcon";
import { Notice } from "../../components/ui/Notice";
import { ListSkeleton } from "../../components/ui/Skeleton";
import { cn } from "../../lib/cn";
import { CATEGORY_KINDS } from "./categoryForm";
import { CategoryFormModal, type CategoryFormTarget } from "./CategoryFormModal";

/** Settings section: every category, with edit / archive, and delete for unused custom ones. */
export function CategoriesCard() {
  const categories = useCategories();
  const setArchived = useSetCategoryArchived();
  const remove = useDeleteCategory();
  const [target, setTarget] = useState<CategoryFormTarget>(null);
  const [error, setError] = useState<string | null>(null);

  const items = categories.data?.items ?? [];
  const sorted = [...items.filter((c) => !c.is_archived), ...items.filter((c) => c.is_archived)];
  const onError = (e: Error) => setError(e.message);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Categories</h2>
          <p className="mt-0.5 text-sm text-muted">Archived ones stay on old entries but leave the pickers.</p>
        </div>
        <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => setTarget({ mode: "create" })}>
          New
        </Button>
      </div>

      {error && (
        <Notice tone="error" className="mt-4" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}

      {categories.isPending ? (
        <ListSkeleton rows={4} />
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {sorted.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              onEdit={() => setTarget({ mode: "edit", category: c })}
              onArchiveToggle={() => setArchived.mutate({ id: c.id, archived: !c.is_archived }, { onError })}
              // The backend refuses (409) if it's used anywhere; archiving is the answer then.
              onDelete={c.is_system ? undefined : () => remove.mutate(c.id, { onError })}
            />
          ))}
        </ul>
      )}

      <CategoryFormModal target={target} onClose={() => setTarget(null)} />
    </Card>
  );
}

function CategoryRow({ category: c, onEdit, onArchiveToggle, onDelete }: { category: Category; onEdit: () => void; onArchiveToggle: () => void; onDelete?: () => void }) {
  return (
    <li className={cn("flex items-center gap-3 py-2.5", c.is_archived && "opacity-60")}>
      <CategoryIcon icon={c.icon} color={c.color} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{c.name}</p>
        <p className="text-xs text-muted">
          {CATEGORY_KINDS.find((k) => k.value === c.kind)?.label}
          {c.is_system ? " · built-in" : ""}
          {c.is_archived ? " · archived" : ""}
        </p>
      </div>
      <IconButton label={`Edit ${c.name}`} icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit} />
      <IconButton
        label={`${c.is_archived ? "Unarchive" : "Archive"} ${c.name}`}
        icon={c.is_archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
        onClick={onArchiveToggle}
      />
      {onDelete && <IconButton label={`Delete ${c.name}`} icon={<Trash2 className="size-4" aria-hidden />} onClick={onDelete} />}
    </li>
  );
}
