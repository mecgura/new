"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Alert, Button } from "@/components/ui";

/**
 * Shown right after creating/re-inviting a user. Email delivery is NOT configured in this release, so
 * nothing has been sent: the admin must share this one-time link securely. It is never shown again.
 */
export function InviteLinkCard({ token, expiresAt, name }: { token: string; expiresAt: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? `/invite/${token}` : `${window.location.origin}/invite/${token}`;
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: user can select the text */ }
  }
  return (
    <div className="space-y-3">
      <Alert tone="warning" title="No email was sent">Email delivery is not configured. Share this invitation link with {name} yourself (e.g. in person). It works once, expires on {new Date(expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}, and is not shown again.</Alert>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className="type-form min-h-control min-w-0 flex-1 rounded-md border border-line-strong bg-surface-muted px-3" />
        <Button variant="outline" onClick={copy}>{copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}{copied ? "Copied" : "Copy link"}</Button>
      </div>
    </div>
  );
}
