import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { brandToCssVars } from "@/theme/tokens";
import type { PublicTenant } from "@/lib/tenant/resolve";

/** Calm, branded frame for the logged-out portal screens (login, activation, help). Uses the clinic's logo, name and colours. */
export function PublicFrame({ tenant, title, subtitle, children, footer }: { tenant: PublicTenant | null; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div style={tenant ? (brandToCssVars(tenant.brand) as React.CSSProperties) : undefined} className="min-h-dvh bg-surface-muted">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
        <div className="mb-6 flex justify-center"><Logo name={tenant?.name ?? "Patient portal"} sub={tenant ? "Patient portal" : null} logoUrl={tenant?.logoUrl} /></div>
        <main id="main" className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
          <h1 className="type-page-title">{title}</h1>
          {subtitle && <p className="type-secondary mb-5 mt-1">{subtitle}</p>}
          {children}
        </main>
        <p className="type-caption mt-5 flex items-center justify-center gap-1.5 text-center"><ShieldCheck aria-hidden className="size-4" />Your health information is private and only visible to you and your clinic.</p>
        {footer}
        {tenant?.isDemo && <p className="type-caption mt-4 rounded-lg bg-warning-soft px-3 py-2 text-center !text-warning">Demo clinic — sample data only.</p>}
        {tenant?.fromHost && <p className="type-caption mt-3 text-center"><Link href="/" className="!text-muted">← Back to the clinic website</Link></p>}
      </div>
    </div>
  );
}
