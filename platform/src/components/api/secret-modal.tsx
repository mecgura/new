"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Alert, Button, Modal } from "@/components/ds";

/** Shows a secret exactly once. Closing it discards the only copy held by the page. */
export function SecretModal({ title, description, secret, onClose }: { title: string; description: string; secret: string; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      /* the field below is selectable as a fallback */
    }
  }
  return (
    <Modal open onClose={onClose} title={title} description={description} size="lg">
      <div className="space-y-4">
        <Alert tone="warning" title="Copy it now">
          This is the only time the full secret is shown. MECGURA keeps just a fingerprint, so it can&apos;t be shown again — if you lose it, create or rotate again.
        </Alert>
        <div className="flex items-stretch gap-2">
          <input readOnly value={secret} aria-label="Secret" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-app-border bg-app-bg px-3 py-2 font-mono text-small text-app-text" />
          <Button variant="secondary" onClick={copy}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>I&apos;ve saved it</Button>
        </div>
      </div>
    </Modal>
  );
}
