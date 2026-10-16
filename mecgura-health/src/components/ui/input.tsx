"use client";
import { useState } from "react";
import { Eye, EyeOff, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { controlClass, useFieldProps } from "./field";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

/** Generic input. Prefer the typed wrappers below so mobile keyboards and validation hints are right. */
export function TextInput({ className, type = "text", ...rest }: InputProps & { type?: React.HTMLInputTypeAttribute }) {
  return <input type={type} className={cn(controlClass, className)} {...useFieldProps()} {...rest} />;
}
export const EmailInput = (p: InputProps) => <TextInput type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} {...p} />;
export const PhoneInput = (p: InputProps) => <TextInput type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile number" {...p} />;
export const NumberInput = (p: InputProps) => <TextInput type="number" inputMode="decimal" {...p} />;
/** Native date/time pickers: accessible, localised, and the best UX on mobile. */
export const DatePicker = (p: InputProps) => <TextInput type="date" {...p} />;
export const TimePicker = (p: InputProps) => <TextInput type="time" {...p} />;

export function PasswordInput({ className, ...rest }: InputProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input type={shown ? "text" : "password"} className={cn(controlClass, "pr-12", className)} {...useFieldProps()} {...rest} />
      <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-md text-muted hover:text-ink">
        {shown ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
      </button>
    </div>
  );
}

export function SearchInput({ className, "aria-label": ariaLabel = "Search", ...rest }: InputProps) {
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
      <input type="search" aria-label={ariaLabel} className={cn(controlClass, "pl-10", className)} {...rest} />
    </div>
  );
}

export function Textarea({ className, rows = 4, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cn(controlClass, "py-2.5", className)} {...useFieldProps()} {...rest} />;
}

export function Select({ className, options, placeholder, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select className={cn(controlClass, className)} {...useFieldProps()} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
