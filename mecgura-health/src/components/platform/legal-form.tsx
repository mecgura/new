"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

type Kind = "terms" | "privacy";
const area = "type-form w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm";

/** Edits one public legal page. Empty text restores the built-in "draft outline" (which shows a draft banner to visitors). */
export function LegalForm({ kind, title, initial, draft }: { kind: Kind; title: string; initial: string; draft: boolean }) {
  const router = useRouter(); const toast = useToast(); const [text, setText] = useState(draft ? "" : initial); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3" aria-label={title} onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); const res = await apiFetch("/api/platform/legal", { method: "PUT", body: JSON.stringify({ kind, text }) }); setBusy(false); if (!res.ok) { setErr(res.error.message); return; } toast({ tone: "success", title: `${title} saved` }); router.refresh(); }}>
      <label className="type-label block" htmlFor={`legal-${kind}`}>{title} <span className="type-caption">(use ## for headings, - for bullets) — {draft ? "currently showing the DRAFT outline" : "published"}</span></label>
      <textarea id={`legal-${kind}`} className={area} rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the reviewed text here. Leave empty to show the draft outline." maxLength={40000} />
      {err && <p role="alert" className="type-secondary text-danger">{err}</p>}
      <div className="flex items-center gap-3"><Button type="submit" loading={busy}>Save {title}</Button><a className="type-secondary" href={`/${kind}`} target="_blank" rel="noreferrer">Open public page</a></div>
    </form>
  );
}
