import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-brand-400 text-[#062026] hover:bg-brand-300",
        secondary: "bg-[#E8F0E8] dark:bg-[#1A1A24] text-[#0C160D] dark:text-[#f4f4f6] border border-[#DFE8DF] dark:border-[#262633] hover:border-brand-500/60 hover:bg-[#DFE8DF]",
        outline: "border border-[#DFE8DF] dark:border-[#262633] bg-transparent text-[#0C160D] dark:text-[#f4f4f6] hover:border-brand-400/60 hover:text-brand-700 hover:dark:text-brand-300",
        whatsapp: "bg-[#10B981] text-[#04120c] hover:bg-[#34d399]",
        ghost: "text-[#42553F] dark:text-[#C6C6CF] hover:text-[#0C160D] hover:dark:text-[#f4f4f6] hover:bg-black/5 dark:hover:bg-white/5",
        danger: "bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30 hover:bg-red-500/25",
      },
      size: {
        default: "h-11 px-6 py-2",
        sm: "h-9 px-4 text-[13px]",
        lg: "h-13 px-8 text-base py-3.5",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
