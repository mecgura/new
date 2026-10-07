"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Menu-button pattern: Enter/Space/ArrowDown open, arrows move, Escape closes
 * and returns focus to the trigger, click-outside closes.
 */
export function Dropdown({
  trigger,
  label,
  children,
  align = "end",
  className,
  panelClassName,
}: {
  trigger: React.ReactNode;
  /** Accessible name for the trigger button. */
  label: string;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "start" | "end";
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState<{ top: number; bottom: number; left: number; right: number } | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const menuId = React.useId();
  const triggerId = React.useId();
  const close = React.useCallback(() => {
    setOpen(false);
    document.getElementById(triggerId)?.focus();
  }, [triggerId]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Fixed positioning escapes scroll containers (e.g. menus inside tables);
    // flip above the trigger when there's no room below.
    const panel = panelRef.current;
    if (panel && anchor) {
      const h = panel.offsetHeight;
      const below = anchor.bottom + 8;
      panel.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, anchor.top - 8 - h) : below}px`;
      panel.style.visibility = "visible";
    }
    const onViewportChange = (e: Event) => {
      if (e.type === "scroll" && panel?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    const first = rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, anchor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        id={triggerId}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ top: r.top, bottom: r.bottom, left: r.left, right: window.innerWidth - r.right });
          setOpen((v) => !v);
        }}
        className="relative inline-flex items-center gap-2 rounded-[var(--radius-control)] text-app-muted hover:bg-app-hover hover:text-app-text"
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={label}
          style={{
            visibility: "hidden",
            top: anchor ? anchor.bottom + 8 : 0,
            ...(align === "end" ? { right: Math.max(8, anchor?.right ?? 0) } : { left: Math.max(8, anchor?.left ?? 0) }),
          }}
          className={cn(
            "fixed z-[60] max-h-[min(28rem,calc(100dvh-1rem))] min-w-56 overflow-y-auto rounded-[var(--radius-card)] border border-app-border bg-app-surface py-1 text-left shadow-[var(--shadow-pop)]",
            panelClassName
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export const DropdownItem = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; tone?: "default" | "danger" }
>(({ className, icon, tone = "default", children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="menuitem"
    className={cn(
      "flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-small outline-none hover:bg-app-hover focus-visible:bg-app-hover",
      tone === "danger" ? "text-red-300" : "text-app-text",
      className
    )}
    {...props}
  >
    {icon}
    {children}
  </button>
));
DropdownItem.displayName = "DropdownItem";

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-3.5 py-2 text-caption text-app-subtle">{children}</div>;
}

export function DropdownSeparator() {
  return <div role="separator" className="my-1 h-px bg-app-border" />;
}
