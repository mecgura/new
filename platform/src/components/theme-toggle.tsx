"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      title={isDark ? "Light mode" : "Dark mode"}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#DFE8DF] bg-white text-[#42553F] transition-colors hover:border-brand-500/60 hover:text-brand-700 dark:border-[#262633] dark:bg-[#12121A] dark:text-[#C6C6CF] dark:hover:border-brand-400/60 dark:hover:text-brand-300",
        className
      )}
    >
      {isDark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
    </button>
  );
}
