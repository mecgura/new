"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ds/button";

/**
 * Built on the native <dialog> element: showModal() makes the rest of the
 * page inert (focus is trapped), Escape closes it, and focus returns to the
 * previously focused element on close.
 */
function useNativeDialog(open: boolean, onClose: () => void) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", handleCancel);
    return () => el.removeEventListener("cancel", handleCancel);
  }, [onClose]);
  const onBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };
  return { ref, onBackdrop };
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const { ref, onBackdrop } = useNativeDialog(open, onClose);
  const titleId = React.useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={onBackdrop}
      className={cn(
        "ds-dialog m-auto w-[calc(100%-2rem)] rounded-[var(--radius-card)] border border-app-border bg-app-surface p-0 text-app-text shadow-[var(--shadow-pop)]",
        size === "sm" && "max-w-sm",
        size === "md" && "max-w-lg",
        size === "lg" && "max-w-2xl"
      )}
    >
      {open ? (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-app-border px-5 py-4">
            <div>
              <h2 id={titleId} className="text-h2 text-app-text">
                {title}
              </h2>
              {description ? <p className="mt-1 text-small text-app-muted">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-md p-1 text-app-muted hover:bg-app-hover hover:text-app-text">
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="app-scroll overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-app-border px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  side = "left",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "left" | "right";
  children: React.ReactNode;
}) {
  const { ref, onBackdrop } = useNativeDialog(open, onClose);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClick={onBackdrop}
      className={cn(
        "ds-dialog fixed inset-y-0 m-0 h-dvh max-h-dvh w-[85vw] max-w-xs border-app-border bg-app-surface p-0 text-app-text shadow-[var(--shadow-pop)]",
        side === "left" ? "left-0 right-auto border-r" : "left-auto right-0 border-l"
      )}
    >
      {open ? children : null}
    </dialog>
  );
}

export function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-body text-app-muted">{description}</p>
    </Modal>
  );
}
