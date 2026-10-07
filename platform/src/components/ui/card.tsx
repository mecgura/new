import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-[#DFE8DF] dark:border-[#262633] bg-[#F2F7F2] dark:bg-[#12121A] p-6", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-lg font-semibold text-[#0C160D] dark:text-[#f4f4f6]", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm text-black dark:text-[#f4f4f6]", className)} {...props} />;
}
