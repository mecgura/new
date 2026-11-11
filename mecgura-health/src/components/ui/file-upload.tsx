"use client";
import { useId, useRef, useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * File picker with client-side checks (type, size) and a removable list. It only COLLECTS files:
 * no upload destination exists in Phase 0. Servers must re-validate type/size/content — see
 * src/lib/security/uploads.ts for the shared rules future upload endpoints must apply.
 */
export function FileUpload({ label, accept, maxSizeMB = 10, multiple, onFilesChange, hint }: { label: string; accept?: string; maxSizeMB?: number; multiple?: boolean; onFilesChange?: (files: File[]) => void; hint?: string }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string>();

  function accepted(f: File) {
    if (f.size > maxSizeMB * 1024 * 1024) return `"${f.name}" is larger than ${maxSizeMB} MB.`;
    if (accept) {
      const rules = accept.split(",").map((r) => r.trim().toLowerCase());
      const ok = rules.some((r) => (r.startsWith(".") ? f.name.toLowerCase().endsWith(r) : r.endsWith("/*") ? f.type.startsWith(r.slice(0, -1)) : f.type === r));
      if (!ok) return `"${f.name}" isn't an allowed file type.`;
    }
    return null;
  }

  function add(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const bad = incoming.map(accepted).find(Boolean);
    setError(bad ?? undefined);
    const good = incoming.filter((f) => !accepted(f));
    const next = multiple ? [...files, ...good] : good.slice(0, 1);
    setFiles(next);
    onFilesChange?.(next);
    if (inputRef.current) inputRef.current.value = "";
  }
  const remove = (i: number) => { const next = files.filter((_, idx) => idx !== i); setFiles(next); onFilesChange?.(next); };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={cn("flex min-h-28 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line-strong bg-surface-muted/50 p-4 text-center hover:border-primary focus-within:border-primary")}>
        <UploadCloud aria-hidden className="size-6 text-muted" />
        <span className="type-label">{label}</span>
        <span className="type-caption max-w-full break-words">{hint ?? `Up to ${maxSizeMB} MB`}</span>
        <input ref={inputRef} id={id} type="file" className="sr-only" accept={accept} multiple={multiple} onChange={(e) => add(e.target.files)} aria-describedby={error ? `${id}-e` : undefined} />
      </label>
      {error && <p id={`${id}-e`} role="alert" className="type-caption !text-danger">{error}</p>}
      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
              <FileText aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="type-table min-w-0 flex-1 truncate">{f.name}</span>
              <span className="type-caption shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
              <button type="button" onClick={() => remove(i)} aria-label={`Remove ${f.name}`} className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted"><X aria-hidden className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
