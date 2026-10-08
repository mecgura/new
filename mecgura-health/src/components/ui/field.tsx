"use client";
import { createContext, useContext, useId } from "react";
import { cn } from "@/lib/cn";

export const controlClass =
  "type-form min-h-control w-full rounded-md border border-line-strong bg-surface px-3 text-ink placeholder:text-muted/80 disabled:cursor-not-allowed disabled:bg-surface-muted aria-[invalid=true]:border-danger";

interface FieldCtx { id: string; describedBy?: string; invalid: boolean; required?: boolean }
const Ctx = createContext<FieldCtx | null>(null);

/** Props every control spreads so label/hint/error are wired up for screen readers. */
export function useFieldProps() {
  const f = useContext(Ctx);
  return f
    ? { id: f.id, "aria-describedby": f.describedBy, "aria-invalid": f.invalid || undefined, required: f.required }
    : {};
}

/**
 * Label + control + hint + error. Wrap any input/select/textarea:
 *   <Field label="Email" error={errors.email}><TextInput type="email" name="email" /></Field>
 */
export function Field({ label, hint, error, required, className, children }: { label: string; hint?: string; error?: string; required?: boolean; className?: string; children: React.ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <Ctx.Provider value={{ id, describedBy, invalid: !!error, required }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label htmlFor={id} className="type-label">
          {label}
          {required && <span aria-hidden className="ml-0.5 text-danger">*</span>}
        </label>
        {children}
        {hint && !error && <p id={hintId} className="type-caption">{hint}</p>}
        {error && <p id={errId} className="type-caption !text-danger" role="alert">{error}</p>}
      </div>
    </Ctx.Provider>
  );
}
