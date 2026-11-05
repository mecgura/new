"use client";

import * as React from "react";
import { FileText, ImageIcon, Upload, X } from "lucide-react";
import { Button, IconButton, Input } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import type { MessageMedia } from "@/lib/automations";

export const EMPTY_MEDIA: MessageMedia = { kind: "", url: "", filename: "" };
const MAX_MB = 3;

/** Upload (or link) one image / PDF brochure for an automation message. */
export function MediaField({ orgId, value, onChange, accept = "both", label }: { orgId: string; value: MessageMedia; onChange: (m: MessageMedia) => void; accept?: "image" | "document" | "both"; label?: string }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [paste, setPaste] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const types = accept === "image" ? "image/jpeg,image/png" : accept === "document" ? "application/pdf" : "image/jpeg,image/png,application/pdf";

  const pick = async (file: File) => {
    setError("");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB — up to ${MAX_MB} MB. Compress it (e.g. ilovepdf.com / tinypng.com) and try again.`);
    setBusy(true);
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    const r = await apiFetch<{ media: { kind: "image" | "document"; url: string; filename: string } }>(`/api/organizations/${orgId}/automations/media`, { method: "POST", body: { filename: file.name, data } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onChange({ kind: r.data.media.kind, url: r.data.media.url, filename: r.data.media.filename });
  };

  if (value.kind && value.url) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-app-border bg-app-surface p-2">
        {value.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.url.includes("/api/automation-media/") ? `/api/automation-media/${value.url.split("/api/automation-media/")[1]}` : value.url} alt="" className="size-14 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="grid size-14 shrink-0 place-items-center rounded-md bg-app-hover text-app-muted"><FileText aria-hidden="true" /></span>
        )}
        <div className="min-w-0 flex-1 text-small">
          <p className="font-medium text-app-text">{value.kind === "image" ? "Image" : "Brochure (PDF)"}</p>
          <p className="truncate text-caption text-app-subtle">{value.filename || value.url}</p>
        </div>
        <IconButton label="Remove file" onClick={() => onChange(EMPTY_MEDIA)}>
          <X aria-hidden="true" />
        </IconButton>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {label ? <p className="text-small font-medium text-app-text">{label}</p> : null}
      <input ref={input} type="file" accept={types} className="sr-only" aria-label={label ?? "Upload a file"} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
          {accept === "document" ? <FileText aria-hidden="true" /> : accept === "image" ? <ImageIcon aria-hidden="true" /> : <Upload aria-hidden="true" />}
          {busy ? "Uploading…" : accept === "image" ? "Upload image" : accept === "document" ? "Upload brochure (PDF)" : "Upload image or PDF"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setPaste((p) => !p)}>Paste a link</Button>
      </div>
      {paste ? (
        <Input
          aria-label="File link (https)"
          placeholder="https://… (public link to a JPG, PNG or PDF)"
          onBlur={(e) => {
            const url = e.target.value.trim();
            if (!url) return;
            if (!/^https:\/\/\S+$/.test(url)) return setError("Use a public https link.");
            const isPdf = /\.pdf(\?|$)/i.test(url) || accept === "document";
            onChange({ kind: isPdf ? "document" : "image", url, filename: isPdf ? "Brochure.pdf" : "" });
          }}
        />
      ) : null}
      <p className="text-caption text-app-subtle">JPG / PNG image or PDF, up to {MAX_MB} MB.</p>
      {error ? <p role="alert" className="text-caption text-app-danger">{error}</p> : null}
    </div>
  );
}
