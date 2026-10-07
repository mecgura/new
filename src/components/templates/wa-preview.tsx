"use client";

import * as React from "react";
import { ExternalLink, FileText, Film, Image as ImageIcon, Phone, Reply, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { renderTemplate, type TemplateDef, type SlotValues } from "@/lib/templates";

/** WhatsApp text formatting (*bold*, _italic_, ~strike~, ```mono```) rendered as React nodes — never HTML. */
export function WaText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const re = /```([^`]+)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~|(\{\{\d+\}\})/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<code key={k++} className="font-mono text-[0.92em]">{m[1]}</code>);
    else if (m[2]) parts.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={k++}>{m[3]}</em>);
    else if (m[4]) parts.push(<s key={k++}>{m[4]}</s>);
    else parts.push(<mark key={k++} className="rounded bg-emerald-400/20 px-0.5 text-emerald-200">{m[5]}</mark>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const MEDIA_ICON = { image: ImageIcon, video: Film, document: FileText } as const;

/**
 * Phone-style preview of a template as the customer will see it.
 * `values` fill variables; unfilled ones stay highlighted as {{n}}.
 */
export function WaPreview({ t, values = {}, className }: { t: TemplateDef; values?: SlotValues; className?: string }) {
  const r = renderTemplate(t, values);
  const auth = t.category === "AUTHENTICATION";
  const buttons: { icon: React.ElementType; text: string }[] = auth
    ? [{ icon: Copy, text: t.authOptions.buttonText || "Copy code" }]
    : t.buttons.map((b) => ({ icon: b.type === "URL" ? ExternalLink : b.type === "PHONE_NUMBER" ? Phone : Reply, text: b.text || "Button" }));
  const media = !auth && t.headerType !== "none" && t.headerType !== "text" ? t.headerType : null;
  const MediaIcon = media ? MEDIA_ICON[media] : null;
  return (
    <div className={cn("rounded-2xl border border-app-border bg-[#0b1410] p-3 sm:p-4", className)} aria-label="Message preview">
      <p className="mb-2 text-center text-caption text-app-subtle">Preview</p>
      <div className="max-w-[20rem] rounded-xl rounded-tl-sm bg-app-elevated text-app-text shadow-sm">
        <div className="space-y-1.5 px-3 pb-1.5 pt-2.5">
          {media && MediaIcon ? (
            <div className="flex h-28 items-center justify-center rounded-lg bg-app-hover text-app-subtle">
              {values.header ? <span className="max-w-full truncate px-2 text-caption">{values.header}</span> : <MediaIcon className="size-8" aria-label={`${media} header`} />}
            </div>
          ) : null}
          {r.header ? (
            <p className="text-small font-semibold">
              <WaText text={r.header} />
            </p>
          ) : null}
          <p className="whitespace-pre-wrap break-words text-small leading-relaxed">{r.body ? <WaText text={r.body} /> : <span className="text-app-subtle">Message body…</span>}</p>
          {r.footer ? <p className="text-caption text-app-subtle">{r.footer}</p> : null}
          <p className="text-right text-[10px] text-app-subtle">12:00</p>
        </div>
        {buttons.length ? (
          <div className="divide-y divide-app-border border-t border-app-border">
            {buttons.slice(0, 3).map((b, i) => (
              <p key={i} className="flex items-center justify-center gap-1.5 px-3 py-2 text-small text-sky-300">
                <b.icon className="size-3.5" aria-hidden="true" /> {b.text}
              </p>
            ))}
            {buttons.length > 3 ? <p className="px-3 py-2 text-center text-small text-sky-300">See all options ({buttons.length})</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
