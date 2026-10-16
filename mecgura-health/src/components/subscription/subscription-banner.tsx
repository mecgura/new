import Link from "next/link";
import { Alert } from "@/components/ui";

const TEXT: Record<string, { tone: "warning" | "danger" | "info"; title: string; body: string }> = {
  PENDING_PAYMENT: { tone: "warning", title: "Subscription not active yet", body: "Pay your first invoice to start your plan." },
  PAST_DUE: { tone: "warning", title: "Payment overdue", body: "Please pay your subscription invoice to avoid interruption." },
  GRACE: { tone: "danger", title: "Grace period", body: "Payment is overdue. Pay now to keep full access." },
  SUSPENDED: { tone: "danger", title: "Subscription suspended", body: "Pay the open invoice to restore access. Your data is safe." },
  PAUSED: { tone: "info", title: "Subscription paused", body: "The workspace is read-only until the subscription resumes." },
  CANCELLED: { tone: "info", title: "Subscription cancelled", body: "Your data is kept. Choose a plan to continue." },
  EXPIRED: { tone: "info", title: "Subscription ended", body: "Your trial or plan has ended. Your data is kept — choose a plan to continue." },
};
export function SubscriptionBanner({ status, readOnly, canManage }: { status: string | null | undefined; readOnly?: boolean; canManage: boolean }) {
  const t = status ? TEXT[status] : null; if (!t) return null;
  return <Alert tone={t.tone} title={t.title} className="mb-4">{t.body}{readOnly ? " The workspace is read-only for now." : ""} {canManage ? <Link href="/subscription">Open subscription</Link> : "Ask your clinic admin to open Subscription."}</Alert>;
}
