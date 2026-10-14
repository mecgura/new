"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Button, Dropdown, Field, Modal, PasswordInput, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { ImportReport } from "@/lib/services/data-import";

/** Saves a response body as a file without navigating (and without leaving it in the page). */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const nameFrom = (res: Response, fallback: string) => /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallback;

/* ------------------------------------------------------------------ export ------------------------------------------------------------------ */
export function ExportMenu({ kind, label = "Download", sensitive = false, size = "sm" }: { kind: string; label?: string; sensitive?: boolean; size?: "sm" | "md" }) {
  const toast = useToast();
  const [format, setFormat] = useState<"xlsx" | "csv" | null>(null);
  const [password, setPassword] = useState(""); const [code, setCode] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();

  async function run(fmt: "xlsx" | "csv", confirm?: { password: string; code: string }) {
    setBusy(true); setError(undefined);
    try {
      const res = await fetch(`/api/exports/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: fmt, ...confirm }) });
      if (!res.ok) { const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null; throw new Error(j?.error?.message ?? "The download didn't work. Try again."); }
      saveBlob(await res.blob(), nameFrom(res, `${kind}.${fmt}`));
      setFormat(null); setPassword(""); setCode("");
      toast({ tone: "success", title: "Download ready", description: `${res.headers.get("x-row-count") ?? ""} rows saved to your device.`.trim() });
    } catch (e) { const m = e instanceof Error ? e.message : "The download didn't work."; if (sensitive) setError(m); else toast({ tone: "danger", title: "Couldn't download", description: m }); }
    finally { setBusy(false); }
  }
  const pick = (fmt: "xlsx" | "csv") => { if (sensitive) { setFormat(fmt); setError(undefined); } else void run(fmt); };

  return (
    <>
      <Dropdown triggerLabel={`${label} as Excel or CSV`} triggerClassName={size === "sm" ? "min-h-9 px-3 text-sm" : undefined}
        trigger={<span className="inline-flex items-center gap-2"><Download aria-hidden className="size-4" />{label}</span>}
        items={[{ type: "label", label: "Download as" }, { label: "Excel (.xlsx)", icon: <FileSpreadsheet aria-hidden className="size-4" />, onSelect: () => pick("xlsx") }, { label: "CSV (.csv)", icon: <FileSpreadsheet aria-hidden className="size-4" />, onSelect: () => pick("csv") }]} />
      {sensitive && (
        <Modal open={!!format} onClose={() => !busy && setFormat(null)} title="Confirm it's you" description="This file contains patients' personal details. Enter your password to download it. The download is recorded in the audit log."
          footer={<><Button variant="outline" onClick={() => setFormat(null)} disabled={busy}>Cancel</Button><Button loading={busy} onClick={() => format && run(format, { password, code })}>Download {format === "csv" ? "CSV" : "Excel"}</Button></>}>
          <form className="space-y-form" onSubmit={(e) => { e.preventDefault(); if (format) void run(format, { password, code }); }}>
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Your password" required><PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Authentication code" hint="Only if you use two-factor sign-in."><TextInput inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <button type="submit" className="sr-only">Download</button>
          </form>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ import ------------------------------------------------------------------ */
const STATUS_TEXT: Record<string, string> = { ok: "Ready", created: "Added", duplicate: "Already there", error: "Needs fixing" };
export function ImportButton({ kind, label = "Import", title, description, onDone }: { kind: string; label?: string; title: string; description: string; onDone?: () => void }) {
  const toast = useToast(); const router = useRouter(); const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false); const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const reset = () => { setFile(null); setReport(null); setError(undefined); if (input.current) input.current.value = ""; };
  const close = () => { if (busy) return; setOpen(false); reset(); };

  async function send(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(true); setError(undefined);
    const form = new FormData(); form.set("file", file); form.set("mode", mode);
    const r = await apiFetch<ImportReport>(`/api/imports/${kind}`, { method: "POST", body: form });
    setBusy(false);
    if (!r.ok) { setError(r.error.message); if (mode === "preview") setReport(null); return; }
    setReport(r.data);
    if (mode === "commit") { toast({ tone: r.data.created ? "success" : "info", title: `${r.data.created} added`, description: `${r.data.duplicates} skipped as already there, ${r.data.errors} need fixing.` }); onDone?.(); router.refresh(); }
  }
  const downloadProblems = () => report?.problemsCsv && saveBlob(new Blob([report.problemsCsv], { type: "text/csv;charset=utf-8" }), `${kind}-rows-to-fix.csv`);
  const done = report?.mode === "commit";

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Upload aria-hidden className="size-4" />{label}</Button>
      <Modal open={open} onClose={close} title={title} description={description}
        footer={<>
          <Button variant="outline" onClick={close} disabled={busy}>{done ? "Close" : "Cancel"}</Button>
          {!done && <Button variant="outline" onClick={() => void send("preview")} disabled={!file} loading={busy && !report}>Check file</Button>}
          {report && !done && report.ok > 0 && <Button onClick={() => void send("commit")} loading={busy}>Import {report.ok} row{report.ok === 1 ? "" : "s"}</Button>}
        </>}>
        <div className="space-y-form">
          {error && <Alert tone="danger">{error}</Alert>}
          {!done && (
            <>
              <p className="type-secondary">1. Download the template, fill it in Excel, 2. choose the file, 3. check it, 4. import. Nothing is saved until you press Import.</p>
              <div className="flex flex-wrap gap-2">
                <a className="inline-flex items-center gap-1.5 text-sm font-semibold" href={`/api/imports/${kind}/template?format=xlsx`}><FileSpreadsheet aria-hidden className="size-4" />Excel template</a>
                <span aria-hidden className="text-muted">·</span>
                <a className="text-sm font-semibold" href={`/api/imports/${kind}/template?format=csv`}>CSV template</a>
              </div>
              <Field label="Excel (.xlsx) or CSV file" hint="Up to 1,000 rows and 5 MB per file. Larger lists: split into several files.">
                <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setError(undefined); }} className="type-body block w-full min-h-control rounded-md border border-line-strong bg-white/70 px-3 py-2 file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:font-semibold file:text-primary" />
              </Field>
            </>
          )}
          {report && (
            <div aria-live="polite" className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat n={done ? report.created : report.ok} label={done ? "Added" : "Ready to add"} tone="success" />
                <Stat n={report.duplicates} label="Already there" tone="neutral" />
                <Stat n={report.errors} label="Need fixing" tone={report.errors ? "danger" : "neutral"} />
              </div>
              {report.truncated && <Alert tone="warning">Only the first 1,000 rows were read. Import the rest in another file.</Alert>}
              {report.unknownColumns.length > 0 && <Alert tone="info">These columns aren&apos;t used and were ignored: {report.unknownColumns.join(", ")}.</Alert>}
              {report.rows.filter((r) => r.status === "error" || r.status === "duplicate").length > 0 && (
                <div className="max-h-56 overflow-auto rounded-lg border border-line bg-white/60">
                  <table className="type-table w-full text-left"><caption className="sr-only">Rows that need attention</caption>
                    <thead><tr className="border-b border-line"><th scope="col" className="px-3 py-2">Row</th><th scope="col" className="px-3 py-2">Record</th><th scope="col" className="px-3 py-2">Problem</th></tr></thead>
                    <tbody>{report.rows.filter((r) => r.status === "error" || r.status === "duplicate").slice(0, 100).map((r) => (
                      <tr key={r.row} className="border-b border-line/60 last:border-0 align-top"><td className="px-3 py-2 tabular-nums">{r.row}</td><td className="px-3 py-2">{r.summary || "—"}</td><td className="px-3 py-2"><span className="font-semibold">{STATUS_TEXT[r.status]}:</span> {r.messages.join("; ")}</td></tr>
                    ))}</tbody></table>
                </div>
              )}
              {report.problemsCsv && <Button variant="outline" size="sm" onClick={downloadProblems}><Download aria-hidden className="size-4" />Download rows to fix</Button>}
              {!done && report.ok === 0 && <Alert tone="warning">No row can be imported yet. Fix the rows above in your file, then choose it again.</Alert>}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
function Stat({ n, label, tone }: { n: number; label: string; tone: "success" | "danger" | "neutral" }) {
  return <div className="rounded-lg border border-line bg-white/60 px-2 py-2"><p className={`text-xl font-bold tabular-nums ${tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-ink"}`}>{n}</p><p className="type-caption">{label}</p></div>;
}
