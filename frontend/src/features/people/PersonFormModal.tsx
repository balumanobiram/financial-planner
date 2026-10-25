import { useId, useState, type FormEvent } from "react";

import { useSavePerson, type Person, type PersonInput } from "../../api/people";
import { Button } from "../../components/ui/Button";
import { TextAreaField, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Notice } from "../../components/ui/Notice";
import { RELATION_SUGGESTIONS, validatePersonForm, type PersonFormValues } from "./peopleForms";

export type PersonFormTarget = { mode: "create" } | { mode: "edit"; person: Person } | null;

type Props = { target: PersonFormTarget; onClose: () => void; onSaved: (person: Person) => void };

export function PersonFormModal({ target, onClose, onSaved }: Props) {
  const formId = useId();
  const save = useSavePerson();
  const editing = target?.mode === "edit" ? target.person : undefined;

  const close = () => {
    save.reset();
    onClose();
  };

  return (
    <Modal
      open={target !== null}
      onClose={close}
      title={editing ? "Edit person" : "Add person"}
      description={editing ? undefined : "Someone who sends you money or shares bills with you."}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {editing ? "Save changes" : "Add person"}
          </Button>
        </>
      }
    >
      <PersonForm
        formId={formId}
        person={editing}
        serverError={save.isError ? save.error.message : undefined}
        onSubmit={(input) =>
          save.mutate(
            { id: editing?.id, input },
            {
              onSuccess: (person) => {
                onSaved(person);
                close();
              },
            },
          )
        }
      />
    </Modal>
  );
}

function PersonForm({
  formId,
  person,
  serverError,
  onSubmit,
}: {
  formId: string;
  person?: Person;
  serverError?: string;
  onSubmit: (input: PersonInput) => void;
}) {
  const listId = useId();
  const [values, setValues] = useState<PersonFormValues>({
    name: person?.name ?? "",
    relation: person?.relation ?? "",
    notes: person?.notes ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof PersonFormValues, string>>>({});

  const set = (key: keyof PersonFormValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validatePersonForm(values);
    setErrors(result.errors);
    if (result.input) onSubmit(result.input);
  };

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4 pb-2">
      {serverError && <Notice tone="error">{serverError}</Notice>}
      <TextField
        label="Name"
        placeholder="Arjun"
        data-autofocus={!person || undefined}
        value={values.name}
        onChange={(e) => set("name", e.target.value)}
        error={errors.name}
      />
      <TextField
        label="Relation"
        placeholder="Friend, Dad, Roommate…"
        list={listId}
        value={values.relation}
        onChange={(e) => set("relation", e.target.value)}
        error={errors.relation}
        hint={errors.relation ? undefined : "Optional — pick a suggestion or type your own."}
      />
      <datalist id={listId}>
        {RELATION_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <TextAreaField
        label="Notes"
        placeholder="Optional — UPI ID, phone, anything useful"
        value={values.notes}
        onChange={(e) => set("notes", e.target.value)}
        error={errors.notes}
      />
    </form>
  );
}
