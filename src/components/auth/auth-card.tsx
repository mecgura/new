import * as React from "react";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-app-border bg-app-surface p-6 shadow-[var(--shadow-card)] sm:p-8">
      <h1 className="text-center text-h1 text-app-text">{title}</h1>
      {subtitle ? <p className="mt-1.5 text-center text-body text-app-muted">{subtitle}</p> : null}
      <div className="mt-7">{children}</div>
      {footer ? <div className="mt-6 text-center text-small text-app-muted">{footer}</div> : null}
    </div>
  );
}
