"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { AlertOctagon, CheckCircle2, Info, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "info" | "warning" | "danger";
interface ToastItem { id: number; tone: ToastTone; title: string; description?: string }

const Ctx = createContext<{ toast: (t: Omit<ToastItem, "id">) => void } | null>(null);
const icons = { success: CheckCircle2, info: Info, warning: AlertTriangle, danger: AlertOctagon };
const accent = { success: "text-success", info: "text-info", warning: "text-warning", danger: "text-danger" };

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.tone === "danger" ? 8000 : 5000);
  }, [dismiss]);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {/* aria-live region: toasts are announced without stealing focus */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--size-bottom-nav)+0.75rem)] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6">
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div key={t.id} role={t.tone === "danger" ? "alert" : "status"} className="pointer-events-auto flex w-full max-w-sm animate-[toast-in_.2s_ease-out] items-start gap-3 rounded-lg border border-line bg-surface p-3.5 shadow-pop">
              <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", accent[t.tone])} />
              <div className="min-w-0 flex-1"><p className="type-label">{t.title}</p>{t.description && <p className="type-secondary">{t.description}</p>}</div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-muted"><X aria-hidden className="size-4" /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
