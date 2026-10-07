"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; message: string };

const ToastContext = React.createContext<{ toast: (message: string, tone?: ToastTone) => void } | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info } as const;
const TONE = {
  success: "border-app-success/40 text-green-200",
  error: "border-app-danger/40 text-red-200",
  info: "border-app-info/40 text-blue-200",
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);

  const dismiss = React.useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), []);
  const toast = React.useCallback(
    (message: string, tone: ToastTone = "success") => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-3), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
    },
    [dismiss]
  );
  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
        {items.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className={cn("pointer-events-auto flex items-start gap-3 rounded-[var(--radius-control)] border bg-app-elevated px-4 py-3 text-small shadow-[var(--shadow-pop)]", TONE[t.tone])}
            >
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p className="flex-1 text-app-text">{t.message}</p>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="text-app-muted hover:text-app-text">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
