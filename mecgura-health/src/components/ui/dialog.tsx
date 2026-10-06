"use client";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

/**
 * Built on the native <dialog>: the browser provides the focus trap, Esc-to-close, inert
 * background and focus restoration. We add the title wiring, backdrop click and styling.
 */
function BaseDialog({ open, onClose, title, description, children, variant, footer, flush }: { flush?: boolean; open: boolean; onClose: () => void; title: string; description?: string; children?: React.ReactNode; variant: "modal" | "drawer"; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-t`}
      aria-describedby={description ? `${id}-d` : undefined}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cn(variant === "modal" ? "m-auto w-[calc(100vw-2rem)] max-w-lg" : "m-0 h-dvh w-[min(20rem,88vw)]")}
    >
      <div className={cn("flex flex-col bg-surface shadow-modal", variant === "modal" ? "max-h-[calc(100dvh-2rem)] rounded-modal" : "h-full animate-[drawer-in_.2s_ease-out]")}>
        <div className="flex items-start justify-between gap-3 border-b border-line p-card">
          <div className="min-w-0">
            <h2 id={`${id}-t`} className="type-section">{title}</h2>
            {description && <p id={`${id}-d`} className="type-secondary mt-1">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-muted"><X aria-hidden className="size-5" /></button>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto", !flush && "p-card")}>{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line p-card">{footer}</div>}
      </div>
    </dialog>
  );
}

export const Modal = (p: Omit<Parameters<typeof BaseDialog>[0], "variant">) => <BaseDialog variant="modal" {...p} />;
export const Drawer = (p: Omit<Parameters<typeof BaseDialog>[0], "variant" | "footer">) => <BaseDialog variant="drawer" {...p} />;

/** Destructive/irreversible actions must go through this. Focus starts on the safe button. */
export function ConfirmDialog({ open, onCancel, onConfirm, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", tone = "danger", loading }: { open: boolean; onCancel: () => void; onConfirm: () => void; title: string; description: string; confirmLabel?: string; cancelLabel?: string; tone?: "danger" | "primary"; loading?: boolean }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} description={description}
      footer={<>
        <Button variant="outline" onClick={onCancel} autoFocus>{cancelLabel}</Button>
        <Button variant={tone} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>} />
  );
}
