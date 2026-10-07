import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-lg border border-[#DFE8DF] dark:border-[#262633] bg-white dark:bg-[#12121A] px-3.5 text-sm text-[#0C160D] dark:text-[#f4f4f6] placeholder:text-[#5C6E5F] dark:placeholder:text-gray-500 transition-colors focus:border-brand-400/70 focus:outline-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-28 w-full rounded-lg border border-[#DFE8DF] dark:border-[#262633] bg-white dark:bg-[#12121A] px-3.5 py-2.5 text-sm text-[#0C160D] dark:text-[#f4f4f6] placeholder:text-[#5C6E5F] dark:placeholder:text-gray-500 transition-colors focus:border-brand-400/70 focus:outline-none disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-lg border border-[#DFE8DF] dark:border-[#262633] bg-white dark:bg-[#12121A] px-3.5 text-sm text-[#0C160D] dark:text-[#f4f4f6] transition-colors focus:border-brand-400/70 focus:outline-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("mb-1.5 block text-sm font-medium text-[#1A2B1D] dark:text-[#E9EDE9]", className)} {...props} />
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-[13px] text-red-400">
      {message}
    </p>
  );
}

export function Badge({
  className,
  tone = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "default" | "green" | "brand" | "amber" | "red" | "gray";
}) {
  const tones: Record<string, string> = {
    default: "bg-black/5 dark:bg-white/5 text-[#2B3D2E] dark:text-[#DCDCE2] border-black/10 dark:border-white/10",
    green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    brand: "bg-brand-500/10 text-brand-700 dark:text-brand-300 border-brand-500/30",
    amber: "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30",
    red: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
    gray: "bg-black/5 dark:bg-white/5 text-[#5C6E5F] dark:text-[#A7A7B8] border-black/10 dark:border-white/10",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
