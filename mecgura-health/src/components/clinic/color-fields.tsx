"use client";
import { Field } from "@/components/ui";
import type { BrandColors } from "@/theme/tokens";

const LABELS = { primary: "Primary colour", secondary: "Secondary colour", accent: "Accent colour" } as const;

export function ColorFields({ value, onChange, errors = {} }: { value: BrandColors; onChange: (v: BrandColors) => void; errors?: Record<string, string> }) {
  return (
    <div className="grid gap-form sm:grid-cols-3">
      {(["primary", "secondary", "accent"] as const).map((k) => (
        <Field key={k} label={LABELS[k]} error={errors[`${k}Color`]} hint={value[k]}>
          <input type="color" aria-label={LABELS[k]} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value.toLowerCase() })} className="h-control w-full cursor-pointer rounded-md border border-line-strong bg-surface p-1" />
        </Field>
      ))}
    </div>
  );
}
