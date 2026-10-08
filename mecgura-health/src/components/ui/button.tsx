import Link from "next/link";
import { cn } from "@/lib/cn";
import { Spinner } from "./states";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-btn text-on-brand hover:bg-primary-hover",
  secondary: "bg-secondary text-on-brand hover:brightness-90",
  outline: "border border-line-strong bg-surface text-ink hover:bg-surface-muted",
  ghost: "text-ink hover:bg-surface-muted",
  danger: "bg-danger text-on-brand hover:brightness-90",
  success: "bg-success text-on-brand hover:brightness-90",
};
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-control px-btn",
  lg: "min-h-12 px-6 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cn(
    "type-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    variants[variant],
    sizes[size],
    extra,
  );
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean };

export function Button({ variant, size, loading, className, children, disabled, type = "button", ...rest }: Common & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant, size, className, ...rest }: Common & React.ComponentProps<typeof Link>) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
