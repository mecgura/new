import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-[var(--radius-control)] border border-app-border bg-app-bg text-body text-app-text placeholder:text-app-subtle transition-colors hover:border-app-border-strong focus:border-app-primary/70 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-app-danger/70";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-small font-medium text-app-text", className)} {...props} />;
}

/** Label + control + hint + error, wired with aria-describedby. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
  className?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {React.cloneElement(children, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint && !error ? (
        <p id={hintId} className="mt-1.5 text-caption text-app-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-caption text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(control, "h-10 px-3", className)} {...props} />
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(control, "min-h-24 px-3 py-2", className)} {...props} />
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(control, "h-10 px-3 pr-8", className)} {...props}>
      {children}
    </select>
  )
);
Select.displayName = "Select";

type CheckProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: React.ReactNode; description?: React.ReactNode };

function CheckLike({ type, label, description, className, id, ...props }: CheckProps & { type: "checkbox" | "radio" }) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <label htmlFor={inputId} className={cn("flex cursor-pointer items-start gap-2.5 text-body text-app-text", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <input id={inputId} type={type} className="mt-0.5 size-4 shrink-0 accent-[var(--color-app-primary)]" {...props} />
      <span>
        {label}
        {description ? <span className="block text-caption text-app-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export function Checkbox(props: CheckProps) {
  return <CheckLike type="checkbox" {...props} />;
}

export function Radio(props: CheckProps) {
  return <CheckLike type="radio" {...props} />;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50",
        checked ? "border-app-primary bg-app-primary" : "border-app-border-strong bg-app-elevated"
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

export function SearchBar({
  label,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-app-subtle" aria-hidden="true" />
      <input type="search" aria-label={label} className={cn(control, "h-10 pl-9 pr-3")} {...props} />
    </div>
  );
}
