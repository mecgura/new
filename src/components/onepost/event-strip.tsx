"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { STATUS_LABELS, STATUS_TONES, type PostStatus } from "@/lib/onepost";
import type { PostDetail } from "@/services/onepost/posts";

/** The other posts of the same event campaign, and a button to reuse this post's photos in all of them. */
export function EventStrip({ orgId, post, canEdit, onChanged }: { orgId: string; post: PostDetail; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  if (!post.eventGroupId) return null;
  async function share() {
    setBusy(true);
    const r = await apiFetch<{ copied: number; posts: number }>(`/api/organizations/${orgId}/onepost/posts/${post.id}/event/share-media`, { method: "POST", body: {} });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(r.data.copied ? `Photos added to ${r.data.posts} other post${r.data.posts === 1 ? "" : "s"}` : "Nothing new to add. The other posts already have these photos.", "success");
    onChanged();
  }
  return (
    <Card>
      <CardHeader title={post.eventName || "Event campaign"} description="The five posts of this event share the same facts. Each is written, approved and published on its own." />
      <CardBody className="space-y-3">
        <ul className="flex flex-wrap gap-2">
          {post.siblings.map((s) => (
            <li key={s.id}>
              <Link href={`/onepost/${s.id}`} aria-current={s.id === post.id ? "page" : undefined} className={`flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-1.5 text-small ${s.id === post.id ? "border-app-primary text-app-text" : "border-app-border text-app-muted hover:text-app-text"}`}>
                <CalendarDays className="size-3.5" aria-hidden="true" /> {s.label}
                <Badge tone={STATUS_TONES[s.status as PostStatus] ?? "neutral"}>{STATUS_LABELS[s.status as PostStatus] ?? s.status}</Badge>
              </Link>
            </li>
          ))}
        </ul>
        {canEdit && post.media.length ? <Button variant="secondary" loading={busy} onClick={() => void share()}>Use these photos in all event posts</Button> : null}
      </CardBody>
    </Card>
  );
}
