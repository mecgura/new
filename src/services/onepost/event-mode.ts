import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { LANGUAGE_KEYS, MAX_MEDIA_PER_POST, TONE_KEYS } from "@/lib/onepost";
import { EVENT_PHASES } from "@/lib/onepost-event";
import { istToDate } from "@/lib/onepost-publish";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { canEditPost } from "@/services/onepost/posts";
export { siblingsOf } from "@/services/onepost/event-siblings";

const str = (max: number) => z.string().trim().max(max);

export const eventInputSchema = z.object({
  eventName: z.string().trim().min(2, "Name the event").max(120),
  /** "2026-12-05" or "2026-12-05T10:00" (India time). */
  eventDate: z.string().trim().min(8, "Pick the event date").max(20),
  eventPlace: z.string().trim().min(2, "Where is it?").max(160),
  highlights: str(2000).default(""),
  language: z.enum(LANGUAGE_KEYS).default("en"),
  tone: z.enum(TONE_KEYS).default("friendly"),
  city: str(80).default(""),
});

const when = (s: string) => istToDate(s.includes("T") ? s : `${s}T09:00`);

/**
 * One event becomes five draft posts (teaser, live update, recap blog, gallery, press release) that share the event's facts.
 * Nothing is written by the AI yet and nothing is published: each post is written, edited, approved and published on its own.
 */
export async function createEventCampaign(a: OrgAccess, input: z.infer<typeof eventInputSchema>, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const date = when(input.eventDate);
  if (!date) throw new ApiError("VALIDATION_ERROR", "Pick a valid event date.", { details: { eventDate: ["Invalid date"] } });
  const groupId = randomBytes(9).toString("base64url");
  const dateLabel = date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const facts = [`Event: ${input.eventName}`, `Date: ${dateLabel}`, `Place: ${input.eventPlace}`, input.highlights ? `Highlights:\n${input.highlights}` : ""].filter(Boolean).join("\n");
  const posts = [];
  for (const phase of EVENT_PHASES) {
    const p = await db.onePost.create({
      data: {
        organizationId: a.organizationId,
        createdById: a.user.id,
        title: `${phase.label}: ${input.eventName}`.slice(0, 140),
        brief: facts,
        postType: "event",
        language: input.language,
        tone: input.tone,
        city: input.city,
        eventName: input.eventName,
        eventDate: date,
        eventPlace: input.eventPlace,
        eventHighlights: input.highlights,
        eventGroupId: groupId,
        eventPhase: phase.key,
      },
    });
    await db.onePostEvent.create({ data: { organizationId: a.organizationId, postId: p.id, actorUserId: a.user.id, action: "created", note: `Event campaign: ${phase.label}` } });
    posts.push({ id: p.id, phase: phase.key, label: phase.label, title: p.title });
  }
  await audit({ action: "onepost.event_campaign", actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost", targetId: posts[0].id, metadata: { groupId, event: input.eventName }, req });
  return { groupId, posts };
}

/**
 * Uses one post's photos and videos in every other post of the event. The posts point at the same stored files (nothing is uploaded
 * twice), and a shared file is only deleted when the last post using it lets go.
 */
export async function shareMediaWithGroup(a: OrgAccess, postId: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const src = await db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId } });
  if (!src) throw new ApiError("NOT_FOUND", "Post not found.");
  if (!src.eventGroupId) throw new ApiError("VALIDATION_ERROR", "This post isn't part of an event campaign.");
  const originals = await db.onePostMedia.findMany({ where: { postId, organizationId: a.organizationId, variantOf: "" }, orderBy: { position: "asc" } });
  if (!originals.length) throw new ApiError("VALIDATION_ERROR", "Add photos to this post first.");
  const sibs = await db.onePost.findMany({ where: { organizationId: a.organizationId, eventGroupId: src.eventGroupId, NOT: { id: postId } } });
  let copied = 0;
  for (const s of sibs) {
    if (!canEditPost(a, s)) continue;
    const have = await db.onePostMedia.findMany({ where: { postId: s.id, organizationId: a.organizationId, variantOf: "" }, select: { blobUrl: true, name: true, sizeBytes: true } });
    let position = have.length;
    for (const m of originals) {
      if (position >= MAX_MEDIA_PER_POST) break;
      if (have.some((h) => (m.blobUrl ? h.blobUrl === m.blobUrl : h.name === m.name && h.sizeBytes === m.sizeBytes))) continue;
      await db.onePostMedia.create({ data: { organizationId: a.organizationId, postId: s.id, name: m.name, mimeType: m.mimeType, sizeBytes: m.sizeBytes, bytes: m.bytes, position: position++, kind: m.kind, storage: m.storage, blobUrl: m.blobUrl, blobPath: m.blobPath, thumbUrl: m.thumbUrl } });
      copied++;
    }
  }
  await db.onePostEvent.create({ data: { organizationId: a.organizationId, postId, actorUserId: a.user.id, action: "media_shared", note: `${copied} file(s) copied to the other event posts` } });
  return { copied, posts: sibs.length };
}
