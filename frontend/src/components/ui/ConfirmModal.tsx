import type { ReactNode } from "react";

import { Button } from "./Button";
import { Modal } from "./Modal";
import { Notice } from "./Notice";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
};

/** "Are you sure?" for actions that can't be undone. */
export function ConfirmModal({ open, title, children, confirmLabel, danger = false, busy = false, error, onConfirm, onClose }: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 pb-2 text-sm text-muted">
        {error && <Notice tone="error">{error}</Notice>}
        {children}
      </div>
    </Modal>
  );
}
