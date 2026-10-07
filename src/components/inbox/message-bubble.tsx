"use client";

import * as React from "react";
import { AlertCircle, Check, CheckCheck, Clock, CornerUpLeft, FileText, Film, Image as ImageIcon, Lock, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ds";
import { timeFmt, type Message } from "@/components/inbox/types";

const KIND_ICON = { image: ImageIcon, video: Film, audio: Mic, document: FileText } as const;

/** Delivery state with an icon AND a text label (never colour alone). */
function DeliveryState({ m }: { m: Message }) {
  const map: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
    pending: { icon: <Clock className="size-3.5" aria-hidden="true" />, label: "Sending", cls: "text-app-subtle" },
    sent: { icon: <Check className="size-3.5" aria-hidden="true" />, label: "Sent", cls: "text-app-subtle" },
    delivered: { icon: <CheckCheck className="size-3.5" aria-hidden="true" />, label: "Delivered", cls: "text-app-subtle" },
    read: { icon: <CheckCheck className="size-3.5" aria-hidden="true" />, label: "Read", cls: "text-sky-400" },
    failed: { icon: <AlertCircle className="size-3.5" aria-hidden="true" />, label: "Failed", cls: "text-red-300" },
  };
  const s = map[m.status] ?? map.pending;
  return (
    <span className={cn("inline-flex items-center gap-0.5", s.cls)} title={m.error || s.label}>
      {s.icon}
      <span className="sr-only">{s.label}</span>
    </span>
  );
}

function AttachmentView({ a, orgId }: { a: Message["attachments"][number]; orgId: string }) {
  const Icon = KIND_ICON[a.kind as keyof typeof KIND_ICON] ?? FileText;
  const src = a.downloadable ? `/api/organizations/${orgId}/inbox/attachments/${a.id}` : null;
  if (src && a.kind === "image") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated proxy, not optimisable */}
        <img src={src} alt={a.caption || a.filename || "Image"} className="max-h-64 w-auto max-w-full object-cover" loading="lazy" />
      </a>
    );
  }
  if (src && (a.kind === "video" || a.kind === "audio")) {
    return a.kind === "video" ? <video src={src} controls preload="none" className="max-h-64 max-w-full rounded-lg" /> : <audio src={src} controls preload="none" className="w-full max-w-xs" />;
  }
  const label = a.filename || `${a.kind} file`;
  const body = (
    <span className="flex items-center gap-2 rounded-lg border border-app-border bg-app-bg/60 px-3 py-2">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-small">{label}</span>
        <span className="block text-caption text-app-subtle">{src ? "Download" : a.url ? "Sent by link" : "Not stored (demo)"}</span>
      </span>
    </span>
  );
  if (src) return <a href={src}>{body}</a>;
  if (a.url) return <a href={a.url} target="_blank" rel="noreferrer noopener">{body}</a>;
  return body;
}

export function MessageBubble({
  m,
  orgId,
  onReply,
  demoTools,
}: {
  m: Message;
  orgId: string;
  onReply?: (m: Message) => void;
  demoTools?: React.ReactNode;
}) {
  if (m.type === "system") {
    return (
      <li className="flex justify-center py-1">
        <span className="rounded-full bg-app-elevated px-3 py-1 text-caption text-app-muted">
          {m.body} · {timeFmt.format(new Date(m.createdAt))}
        </span>
      </li>
    );
  }
  const outbound = m.direction === "outbound";
  const note = m.direction === "internal";
  const payload = m.payload as { templateName?: string; language?: string; footer?: string; campaignName?: string; buttons?: { id?: string; title: string }[]; flowName?: string; origin?: string };
  return (
    <li className={cn("group flex", outbound || note ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative max-w-[85%] rounded-2xl px-3.5 py-2 text-body sm:max-w-[70%]",
          note && "border border-amber-500/30 bg-amber-500/10 text-amber-50",
          outbound && "rounded-br-md bg-emerald-900/70 text-app-text",
          !outbound && !note && "rounded-bl-md bg-app-elevated text-app-text"
        )}
      >
        {note ? (
          <p className="mb-1 flex items-center gap-1 text-caption font-semibold text-amber-300">
            <Lock className="size-3" aria-hidden="true" /> Internal note · {m.sender?.name ?? "Team"}
          </p>
        ) : null}
        {m.replyTo ? (
          <p className="mb-1.5 border-l-2 border-app-primary/70 pl-2 text-caption text-app-muted">
            <span className="sr-only">Replying to: </span>
            {m.replyTo.body || m.replyTo.type}
          </p>
        ) : null}
        {m.type === "template" ? (
          <p className="mb-1 text-caption text-app-muted">
            <Badge tone="info">{payload.campaignName ? "Campaign" : "Template"}</Badge> {payload.campaignName ? `${payload.campaignName} · ` : ""}
            {payload.templateName} · {payload.language}
          </p>
        ) : null}
        {m.type === "flow" ? (
          <p className="mb-1 text-caption text-app-muted">
            <Badge tone="info">WhatsApp Flow</Badge> {payload.flowName}
            {!outbound ? " · form submitted" : ""}
          </p>
        ) : null}
        {payload.origin === "ai" || payload.origin === "ai_demo" ? (
          <p className="mb-1 text-caption text-app-muted">
            <Badge tone={payload.origin === "ai" ? "info" : "warning"}>{payload.origin === "ai" ? "AI agent" : "Demo AI · rule-based"}</Badge>
          </p>
        ) : null}
        {m.attachments.length ? (
          <div className="mb-1.5 space-y-1.5">
            {m.attachments.map((a) => (
              <AttachmentView key={a.id} a={a} orgId={orgId} />
            ))}
          </div>
        ) : null}
        {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
        {payload.footer ? <p className="mt-1 text-caption text-app-subtle">{payload.footer}</p> : null}
        {m.type === "button" ? <p className="mt-1 text-caption text-app-muted">Tapped a button</p> : null}
        {payload.buttons?.length ? (
          <div className="mt-2 grid gap-1">
            {payload.buttons.map((b, i) => (
              <span key={b.id ?? `${i}-${b.title}`} className="rounded-lg border border-app-border-strong px-3 py-1.5 text-center text-small text-sky-300">
                {b.title}
              </span>
            ))}
          </div>
        ) : null}
        {m.status === "failed" && m.error ? <p className="mt-1 text-caption text-red-300">{m.error}</p> : null}
        <p className="mt-1 flex items-center justify-end gap-1.5 text-caption text-app-subtle">
          {outbound && m.sender ? <span className="truncate">{m.sender.name}</span> : null}
          <time dateTime={m.createdAt}>{timeFmt.format(new Date(m.createdAt))}</time>
          {outbound ? <DeliveryState m={m} /> : null}
        </p>
        {onReply && !note ? (
          <button
            type="button"
            onClick={() => onReply(m)}
            aria-label="Reply to this message"
            className={cn(
              "absolute top-1 hidden rounded-full border border-app-border bg-app-surface p-1 text-app-muted hover:text-app-text group-hover:block group-focus-within:block focus:block",
              outbound ? "-left-8" : "-right-8"
            )}
          >
            <CornerUpLeft className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
        {demoTools}
      </div>
    </li>
  );
}
