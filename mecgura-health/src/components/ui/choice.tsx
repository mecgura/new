"use client";
import { useId } from "react";
import { cn } from "@/lib/cn";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

function Choice({ type, label, description, className, ...rest }: InputProps & { type: "checkbox" | "radio"; label: string; description?: string }) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input id={id} type={type} className="mt-0.5 size-5 shrink-0 accent-[var(--brand-primary)]" aria-describedby={description ? `${id}-d` : undefined} {...rest} />
      <label htmlFor={id} className="type-body cursor-pointer">
        {label}
        {description && <span id={`${id}-d`} className="type-caption block">{description}</span>}
      </label>
    </div>
  );
}
export const Checkbox = (p: InputProps & { label: string; description?: string }) => <Choice type="checkbox" {...p} />;
export const Radio = (p: InputProps & { label: string; description?: string }) => <Choice type="radio" {...p} />;

export function RadioGroup({ legend, name, options, value, onChange, defaultValue }: { legend: string; name: string; options: { value: string; label: string }[]; value?: string; onChange?: (v: string) => void; defaultValue?: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="type-label mb-1">{legend}</legend>
      {options.map((o) => (
        <Radio key={o.value} name={name} label={o.label} value={o.value}
          {...(value !== undefined ? { checked: value === o.value, onChange: () => onChange?.(o.value) } : { defaultChecked: defaultValue === o.value })} />
      ))}
    </fieldset>
  );
}

/** Switch. Controlled (checked + onChange) or uncontrolled via native checkbox semantics. */
export function Toggle({ label, checked, onChange, disabled, name }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; name?: string }) {
  return (
    <label className={cn("inline-flex min-h-control items-center gap-3", disabled ? "opacity-50" : "cursor-pointer")}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 shrink-0 rounded-pill transition-colors", checked ? "bg-primary" : "bg-line-strong")}>
        <span aria-hidden className={cn("absolute top-0.5 left-0.5 size-5 rounded-pill bg-surface shadow-xs transition-transform", checked && "translate-x-5")} />
      </button>
      {name && <input type="hidden" name={name} value={checked ? "true" : "false"} />}
      <span className="type-body" aria-hidden>{label}</span>
    </label>
  );
}
