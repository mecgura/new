import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-app-primary text-app-on-primary hover:bg-app-primary-hover",
        secondary: "border border-app-border bg-app-elevated text-app-text hover:border-app-border-strong hover:bg-app-hover",
        outline: "border border-app-border-strong bg-transparent text-app-text hover:border-app-primary/60 hover:text-app-primary-hover",
        ghost: "text-app-muted hover:bg-app-hover hover:text-app-text",
        danger: "border border-app-danger/40 bg-app-danger/10 text-red-300 hover:bg-app-danger/20",
      },
      size: {
        sm: "h-8 px-3 text-small",
        md: "h-10 px-4 text-body",
        lg: "h-11 px-5 text-body",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  )
);
Button.displayName = "Button";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons must have an accessible name. */
  label: string;
  variant?: "ghost" | "secondary";
  size?: "sm" | "md";
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, className, variant = "ghost", size = "md", type = "button", children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors disabled:opacity-50 [&_svg]:size-[18px]",
        size === "sm" ? "h-8 w-8" : "h-10 w-10",
        variant === "ghost"
          ? "text-app-muted hover:bg-app-hover hover:text-app-text"
          : "border border-app-border bg-app-elevated text-app-text hover:bg-app-hover",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
);
IconButton.displayName = "IconButton";
