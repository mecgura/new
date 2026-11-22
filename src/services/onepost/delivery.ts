import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit-actions";
import { decryptSecret } from "@/lib/crypto";
import { renderMarkdown } from "@/lib/markdown";
import type { OrgAccess } from "@/lib/session";
import { CHANNEL_LABELS, isChannel, parseContent, type ContentOf } from "@/lib/onepost";
import {
  MAX_ATTEMPTS,
  PUBLISH_CHANNEL_KEYS,
  PUBLISH_LABELS,
  PUBLISH_PROVIDER,
  PublishError,
  channelProblem,
  dateToIstInput,
  istToDate,
  isPublishChannel,
  nextAttemptAfter,
  retryableStatus,
  textFor,
  versionFor,
  videoNote,
  type DeliveryStatus,
  type MediaRef,
  type PublishChannel,
} from "@/lib/onepost-publish";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { publishFacebookPost, publishInstagramPost } from "@/providers/meta/social";
import { MetaApiError } from "@/providers/meta/graph";
import { linkedinPublish } from "@/providers/onepost/linkedin";
import { googlePublish } from "@/providers/onepost/google-business";
import { wpPublish } from "@/providers/onepost/wordpress";
import { youtubeSetThumbnail, youtubeUpload } from "@/providers/onepost/youtube";
import { pickPhoto } from "@/lib/onepost-media";
import { accessTokenFor } from "@/services/onepost/connections";
import { PUBLISHABLE, syncPostState } from "@/services/onepost/state";
import { blobConfigured, fetchBlobBytes, putBlob } from "@/services/onepost/storage";

const MAX_AHEAD_DAYS = 180;

export const publishInputSchema = z.object({
  channels: z.array(z.enum(PUBLISH_CHANNEL_KEYS)).min(1, "Pick at least one channel").max(PUBLISH_CHANNEL_KEYS.length),
  /** "2026-11-25T10:30" in India time, or an ISO date-time with an offset. Empty = publish now. */
  scheduledAt: z.string().trim().max(40).default(""),
});
export const rescheduleSchema = z.object({ scheduledAt: z.string().trim().min(1).max(40) });

const parse = <T,>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

function whenFrom(input: string): Date {
  if (!input) return new Date();
  const d = istToDate(input) ?? (/(?:Z|[+-]\d{2}:\d{2})$/.test(input) ? new Date(input) : null);
  if (!d || Number.isNaN(d.getTime())) throw new ApiError("VALIDATION_ERROR", "Pick a valid date and time.", { details: { scheduledAt: ["Invalid"] } });
  if (d.getTime() > Date.now() + MAX_AHEAD_DAYS * 86_400_000) throw new ApiError("VALIDATION_ERROR", `Schedule up to ${MAX_AHEAD_DAYS} days ahead.`, { details: { scheduledAt: ["Too far ahead"] } });
  if (d.getTime() < Date.now() - 60_000) throw new ApiError("VALIDATION_ERROR", "Pick a time in the future.", { details: { scheduledAt: ["In the past"] } });
  return d;
}

const log = (a: Pick<OrgAccess, "organizationId"> & { user?: { id: string } }, action: AuditAction, targetId: string, metadata: Record<string, unknown>, req?: Request) =>
  audit({ action, actorUserId: a.user?.id ?? null, organizationId: a.organizationId, targetType: "onepost", targetId, metadata, req });

async function event(organizationId: string, postId: string, actorUserId: string | null, action: string, note = "") {
  await db.onePostEvent.create({ data: { organizationId, postId, actorUserId, action, note: note.slice(0, 500) } });
}

// ---------------------------------------------------------------------------
// What can this post be sent to right now?
// ---------------------------------------------------------------------------

type Target = { connectionId: string; label: string };

async function resolveTarget(organizationId: string, channel: PublishChannel): Promise<Target | { problem: string }> {
  if (channel === "facebook" || channel === "instagram") {
    // The same accounts the Social Media module publishes through (Channels: Messenger = the Page, Instagram = the business account).
    const kind = channel === "facebook" ? "messenger" : "instagram";
    const acct = await db.channelAccount.findFirst({ where: { organizationId, kind, status: "active", encryptedToken: { not: "" } }, select: { id: true, name: true } });
    return acct ? { connectionId: "", label: acct.name } : { problem: `No ${channel === "facebook" ? "Facebook Page" : "Instagram account"} connected. Connect it in Channels.` };
  }
  const c = await db.onePostConnection.findFirst({ where: { organizationId, provider: PUBLISH_PROVIDER[channel] || "none", status: { not: "expired" } }, orderBy: { createdAt: "asc" } });
  if (!c) return { problem: `${PUBLISH_LABELS[channel]} isn't connected. Connect it in OnePost → Connections.` };
  if (c.status === "needs_target" || !c.externalId) return { problem: `Choose which ${channel === "gbp" ? "business location" : "account"} to use in OnePost → Connections.` };
  return { connectionId: c.id, label: c.externalName || c.externalId };
}

async function mediaRefs(organizationId: string, postId: string): Promise<MediaRef[]> {
  const rows = await db.onePostMedia.findMany({ where: { postId, organizationId }, orderBy: { position: "asc" }, select: { id: true, kind: true, name: true, mimeType: true, storage: true, blobUrl: true } });
  return rows.map((m) => ({ id: m.id, kind: m.kind as "image" | "video", url: m.storage === "blob" ? m.blobUrl : "", mimeType: m.mimeType, name: m.name }));
}

export async function publishOptions(a: OrgAccess, postId: string) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const post = await db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId }, select: { id: true, status: true } });
  if (!post) throw new ApiError("NOT_FOUND", "Post not found.");
  const [versions, media, deliveries] = await Promise.all([
    db.onePostVersion.findMany({ where: { postId, organizationId: a.organizationId } }),
    mediaRefs(a.organizationId, postId),
    db.onePostDelivery.findMany({ where: { postId, organizationId: a.organizationId }, orderBy: { createdAt: "desc" } }),
  ]);
  const options = [];
  for (const ch of PUBLISH_CHANNEL_KEYS) {
    const v = versions.find((x) => x.channel === versionFor(ch));
    const t = await resolveTarget(a.organizationId, ch);
    const problem = !v ? `The ${CHANNEL_LABELS[versionFor(ch)]} version hasn't been written yet.` : "problem" in t ? t.problem : channelProblem(ch, parse(v.content, {}), media);
    const latest = deliveries.find((d) => d.channel === ch);
    const busy = latest && (latest.status === "queued" || latest.status === "publishing" || latest.status === "published");
    options.push({ channel: ch, label: PUBLISH_LABELS[ch], target: "problem" in t ? "" : t.label, problem: busy ? "" : problem, state: (busy ? latest!.status : "") as DeliveryStatus | "", note: videoNote(ch, media) });
  }
  return {
    options,
    deliveries: deliveries.map(deliveryDto),
    canQueue: PUBLISHABLE.includes(post.status),
  };
}

const deliveryDto = (d: { id: string; channel: string; status: string; scheduledAt: Date; attempts: number; error: string; externalUrl: string; publishedAt: Date | null; nextAttemptAt: Date }) => ({
  id: d.id,
  channel: d.channel as PublishChannel,
  label: isPublishChannel(d.channel) ? PUBLISH_LABELS[d.channel] : d.channel,
  status: d.status as DeliveryStatus,
  scheduledAt: d.scheduledAt,
  nextAttemptAt: d.nextAttemptAt,
  attempts: d.attempts,
  error: d.error,
  url: d.externalUrl,
  publishedAt: d.publishedAt,
});
export type DeliveryDto = ReturnType<typeof deliveryDto>;

// ---------------------------------------------------------------------------
// Queue, publish now, cancel, retry, reschedule
// ---------------------------------------------------------------------------

type Snapshot = { channel: PublishChannel; text: string; content: unknown; mediaIds: string[]; language: string; approvedAt: string | null };

/** Queues the post for the chosen channels. Everything is checked first: if any channel has a problem, nothing is queued. */
export async function queueDeliveries(a: OrgAccess, postId: string, input: z.infer<typeof publishInputSchema>, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const post = await db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId } });
  if (!post) throw new ApiError("NOT_FOUND", "Post not found.");
  // A person approved this content; anything not approved never goes out.
  if (!PUBLISHABLE.includes(post.status) || !post.approvedAt) throw new ApiError("CONFLICT", "Only an approved post can be published. Send it for review and have an owner approve it first.");
  const when = whenFrom(input.scheduledAt);
  const now = Date.now() + 60_000 >= when.getTime();
  const channels = [...new Set(input.channels)];
  const [versions, media, live] = await Promise.all([
    db.onePostVersion.findMany({ where: { postId, organizationId: a.organizationId } }),
    mediaRefs(a.organizationId, postId),
    db.onePostDelivery.findMany({ where: { postId, organizationId: a.organizationId, status: { in: ["queued", "publishing", "published"] } } }),
  ]);
  const problems: Record<string, string[]> = {};
  const plans: { channel: PublishChannel; target: Target; content: unknown }[] = [];
  for (const channel of channels) {
    const taken = live.find((d) => d.channel === channel);
    if (taken) {
      (problems[channel] ??= []).push(taken.status === "published" ? "Already published to this channel." : "Already queued for this channel.");
      continue;
    }
    const v = versions.find((x) => x.channel === versionFor(channel));
    if (!v) {
      (problems[channel] ??= []).push(`Write the ${CHANNEL_LABELS[versionFor(channel)]} version first.`);
      continue;
    }
    const content = parse<unknown>(v.content, {});
    const t = await resolveTarget(a.organizationId, channel);
    if ("problem" in t) {
      (problems[channel] ??= []).push(t.problem);
      continue;
    }
    const issue = channelProblem(channel, content, media);
    if (issue) {
      (problems[channel] ??= []).push(issue);
      continue;
    }
    plans.push({ channel, target: t, content });
  }
  if (Object.keys(problems).length) {
    const first = Object.values(problems)[0][0];
    throw new ApiError("VALIDATION_ERROR", `Nothing was queued. ${first}`, { details: problems });
  }

  const ids: string[] = [];
  for (const p of plans) {
    const snapshot: Snapshot = { channel: p.channel, text: textFor(p.channel, p.content), content: p.content, mediaIds: media.map((m) => m.id), language: post.language, approvedAt: post.approvedAt.toISOString() };
    const d = await db.onePostDelivery.create({ data: { organizationId: a.organizationId, postId, channel: p.channel, connectionId: p.target.connectionId, status: "queued", scheduledAt: when, nextAttemptAt: when, snapshot: JSON.stringify(snapshot), createdById: a.user.id } });
    ids.push(d.id);
  }
  await db.onePost.update({ where: { id: postId }, data: { status: "scheduled", scheduledAt: when } });
  await event(a.organizationId, postId, a.user.id, now ? "publish_requested" : "scheduled", `${plans.map((p) => PUBLISH_LABELS[p.channel]).join(", ")}${now ? "" : ` — ${dateToIstInput(when).replace("T", " ")} IST`}`);
  await log(a, "onepost.scheduled", postId, { channels: plans.map((p) => p.channel), at: when.toISOString(), now }, req);
  if (now) for (const id of ids) await processDelivery(id).catch(() => null);
  return publishOptions(a, postId);
}

export async function cancelScheduled(a: OrgAccess, postId: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const r = await db.onePostDelivery.updateMany({ where: { postId, organizationId: a.organizationId, status: "queued" }, data: { status: "cancelled", error: "Cancelled by a person." } });
  if (!r.count) throw new ApiError("CONFLICT", "Nothing is waiting to be published.");
  await syncPostState(a.organizationId, postId);
  await event(a.organizationId, postId, a.user.id, "schedule_cancelled", `${r.count} channel(s)`);
  await log(a, "onepost.schedule_cancelled", postId, { cancelled: r.count }, req);
  return publishOptions(a, postId);
}

export async function retryFailed(a: OrgAccess, postId: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const failed = await db.onePostDelivery.findMany({ where: { postId, organizationId: a.organizationId, status: "failed" }, select: { id: true, channel: true } });
  if (!failed.length) throw new ApiError("CONFLICT", "No failed channels to retry.");
  await db.onePostDelivery.updateMany({ where: { id: { in: failed.map((f) => f.id) } }, data: { status: "queued", attempts: 0, error: "", nextAttemptAt: new Date() } });
  await db.onePost.update({ where: { id: postId }, data: { status: "scheduled" } });
  await event(a.organizationId, postId, a.user.id, "retry", failed.map((f) => (isPublishChannel(f.channel) ? PUBLISH_LABELS[f.channel] : f.channel)).join(", "));
  await log(a, "onepost.scheduled", postId, { retry: failed.map((f) => f.channel) }, req);
  for (const f of failed) await processDelivery(f.id).catch(() => null);
  return publishOptions(a, postId);
}

export async function rescheduleDelivery(a: OrgAccess, deliveryId: string, scheduledAt: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const when = whenFrom(scheduledAt);
  const d = await db.onePostDelivery.findFirst({ where: { id: deliveryId, organizationId: a.organizationId } });
  if (!d) throw new ApiError("NOT_FOUND", "Scheduled post not found.");
  const r = await db.onePostDelivery.updateMany({ where: { id: deliveryId, organizationId: a.organizationId, status: "queued" }, data: { scheduledAt: when, nextAttemptAt: when, attempts: 0 } });
  if (!r.count) throw new ApiError("CONFLICT", "Only a post that is still waiting can be moved.");
  await db.onePost.update({ where: { id: d.postId }, data: { scheduledAt: when } });
  await event(a.organizationId, d.postId, a.user.id, "rescheduled", `${isPublishChannel(d.channel) ? PUBLISH_LABELS[d.channel] : d.channel} — ${dateToIstInput(when).replace("T", " ")} IST`);
  await log(a, "onepost.rescheduled", d.postId, { channel: d.channel, at: when.toISOString() }, req);
  return { id: deliveryId, scheduledAt: when };
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

function fromMeta(e: unknown): PublishError {
  if (e instanceof PublishError) return e;
  if (e instanceof MetaApiError) {
    const reconnect = e.code === 190 || e.status === 401;
    return new PublishError((e.userMessage || e.message).slice(0, 300), !reconnect && retryableStatus(e.status), reconnect);
  }
  return new PublishError(e instanceof Error ? e.message.slice(0, 300) : "Publishing failed.", false);
}

async function publicImageUrl(organizationId: string, mediaId: string): Promise<string> {
  const m = await db.onePostMedia.findFirst({ where: { id: mediaId, organizationId } });
  if (!m) throw new PublishError("The photo was removed.", false);
  if (m.storage === "blob" && m.blobUrl) return m.blobUrl;
  if (!blobConfigured()) throw new PublishError("Photo storage isn't set up on this server (Vercel Blob), so channels can't fetch the photo.", false);
  // An older photo kept in the database: move it to Blob once so channels can fetch it.
  const b = await putBlob(organizationId, m.postId, m.name, new Uint8Array(m.bytes), m.mimeType);
  await db.onePostMedia.update({ where: { id: m.id }, data: { storage: "blob", blobUrl: b.url, blobPath: b.pathname, bytes: new Uint8Array(0) } });
  return b.url;
}

async function imageBytes(organizationId: string, mediaId: string) {
  const m = await db.onePostMedia.findFirst({ where: { id: mediaId, organizationId } });
  if (!m) throw new PublishError("The photo was removed.", false);
  try {
    const bytes = m.storage === "blob" && m.blobUrl ? await fetchBlobBytes(m.blobUrl) : new Uint8Array(m.bytes);
    return { bytes, contentType: m.mimeType, filename: m.name };
  } catch (e) {
    throw new PublishError(e instanceof Error ? e.message : "The photo could not be read.", true);
  }
}

const GBP_LANG: Record<string, string> = { en: "en-IN", hinglish: "en-IN", hi: "hi-IN", pa: "pa-IN" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Sends one queued delivery. What goes out is the snapshot taken when it was queued, never the live (possibly edited) version. */
export async function processDelivery(id: string): Promise<DeliveryStatus | "skipped"> {
  const claimed = await db.onePostDelivery.updateMany({ where: { id, status: "queued" }, data: { status: "publishing", attempts: { increment: 1 } } });
  if (!claimed.count) return "skipped";
  const d = await db.onePostDelivery.findUniqueOrThrow({ where: { id } });
  const org = d.organizationId;
  const channel = d.channel as PublishChannel;
  try {
    if (!isPublishChannel(channel)) throw new PublishError("Unknown channel.", false);
    const snap = parse<Snapshot>(d.snapshot, {} as Snapshot);
    const rows = await db.onePostMedia.findMany({ where: { postId: d.postId, organizationId: org, id: { in: snap.mediaIds ?? [] } }, orderBy: { position: "asc" }, select: { id: true, kind: true, variantOf: true, ratio: true, watermarked: true, position: true, sizeBytes: true, mimeType: true, blobUrl: true, thumbUrl: true, storage: true } });
    // The photo in the shape this channel likes best (a resized copy if one was made), else the original.
    const photo = pickPhoto(channel, rows);
    const images = photo ? [photo.id] : [];
    let result: { id: string; url: string };
    if (channel === "facebook" || channel === "instagram") {
      const acct = await db.channelAccount.findFirst({ where: { organizationId: org, kind: channel === "facebook" ? "messenger" : "instagram", status: "active", encryptedToken: { not: "" } } });
      if (!acct) throw new PublishError(`${channel === "facebook" ? "The Facebook Page" : "The Instagram account"} is no longer connected. Connect it in Channels.`, false, true);
      const token = decryptSecret(acct.encryptedToken);
      const image = images[0] ? await publicImageUrl(org, images[0]) : undefined;
      // Reuses the Social Media module's own publishing calls, unchanged.
      const postId = channel === "facebook" ? await publishFacebookPost(token, acct.address, snap.text, image).catch((e) => { throw fromMeta(e); }) : await publishInstagramPost(token, acct.address, snap.text, image ?? "").catch((e) => { throw fromMeta(e); });
      result = { id: postId, url: "" };
    } else {
      const conn = await db.onePostConnection.findFirst({ where: { id: d.connectionId, organizationId: org } });
      if (!conn || !conn.externalId) throw new PublishError("This account was disconnected. Connect it again in OnePost → Connections.", false, true);
      if (channel === "linkedin") {
        const token = await accessTokenFor(conn);
        const img = images[0] ? await imageBytes(org, images[0]) : undefined;
        result = await linkedinPublish(token, conn.externalId, snap.text, img ? { bytes: img.bytes, contentType: img.contentType } : undefined);
      } else if (channel === "gbp") {
        const token = await accessTokenFor(conn);
        const c = snap.content as ContentOf<"gbp">;
        result = await googlePublish(token, conn.externalId, { summary: c.text, languageCode: GBP_LANG[snap.language] ?? "en-IN", cta: c.cta, ctaUrl: c.ctaUrl, imageUrl: images[0] ? await publicImageUrl(org, images[0]) : undefined });
      } else if (channel === "youtube") {
        const token = await accessTokenFor(conn);
        const video = rows.find((m) => m.kind === "video" && !m.variantOf);
        if (!video || video.storage !== "blob" || !video.blobUrl) throw new PublishError("The video was removed, or isn't in file storage.", false);
        const c = parseContent("youtube", snap.content);
        const privacy = parse<{ ytPrivacy?: "public" | "unlisted" | "private" }>(conn.settings, {}).ytPrivacy ?? "public";
        result = await youtubeUpload(token, { title: c.title, description: c.description, tags: c.tags, privacy, videoUrl: video.blobUrl, size: video.sizeBytes, contentType: video.mimeType });
        if (video.thumbUrl) {
          const bytes = await fetchBlobBytes(video.thumbUrl).catch(() => null);
          if (bytes) await youtubeSetThumbnail(token, result.id, { bytes, contentType: "image/jpeg" });
        }
      } else {
        const c = parseContent("blog", snap.content);
        const [user, pass] = (() => {
          const s = decryptSecret(conn.encryptedAccess);
          const i = s.indexOf(":");
          return [s.slice(0, i), s.slice(i + 1)];
        })();
        const faq = c.faq.length ? `<h2>FAQ</h2>${c.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("")}` : "";
        const img = images[0] ? await imageBytes(org, images[0]) : undefined;
        const status = parse<{ wpStatus?: "publish" | "draft" }>(conn.settings, {}).wpStatus ?? "publish";
        result = await wpPublish(conn.externalId, user, pass, { title: c.headline, slug: c.slug, html: renderMarkdown(c.body).html + faq, excerpt: c.metaDescription, status, image: img });
      }
    }
    await db.onePostDelivery.update({ where: { id }, data: { status: "published", externalId: result.id, externalUrl: result.url, publishedAt: new Date(), error: "" } });
    await event(org, d.postId, d.createdById, "published", PUBLISH_LABELS[channel]);
    await log({ organizationId: org, user: d.createdById ? { id: d.createdById } : undefined }, "onepost.published", d.postId, { channel, externalId: result.id }, undefined);
    await syncPostState(org, d.postId);
    return "published";
  } catch (e) {
    const err = e instanceof PublishError ? e : fromMeta(e);
    const again = err.retryable && d.attempts < MAX_ATTEMPTS;
    const when = nextAttemptAfter(d.attempts);
    await db.onePostDelivery.update({
      where: { id },
      data: again ? { status: "queued", nextAttemptAt: when, error: `${err.message} Will try again automatically.` } : { status: "failed", error: err.reconnect ? `${err.message}` : err.message },
    });
    await event(org, d.postId, d.createdById, again ? "publish_retry" : "publish_failed", `${isPublishChannel(channel) ? PUBLISH_LABELS[channel] : channel}: ${err.message}`);
    await log({ organizationId: org, user: d.createdById ? { id: d.createdById } : undefined }, "onepost.publish_failed", d.postId, { channel, retry: again, error: err.message }, undefined);
    await syncPostState(org, d.postId);
    return again ? "queued" : "failed";
  }
}

/** Scheduler tick: sends deliveries whose time has come (and retries whose wait is over). */
export async function runDueOnePost(limit = 20) {
  const due = await db.onePostDelivery.findMany({ where: { status: "queued", nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: "asc" }, take: limit, select: { id: true } });
  // A delivery stuck in "publishing" (the server stopped mid-send) is put back once, after ten minutes.
  await db.onePostDelivery.updateMany({ where: { status: "publishing", updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: "queued", nextAttemptAt: new Date() } });
  let published = 0;
  let failed = 0;
  for (const d of due) {
    const r = await processDelivery(d.id).catch(() => "failed" as const);
    if (r === "published") published++;
    if (r === "failed") failed++;
  }
  return { due: due.length, published, failed };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export async function listCalendar(a: OrgAccess, range: { from: Date; to: Date }) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const rows = await db.onePostDelivery.findMany({
    where: { organizationId: a.organizationId, status: { not: "cancelled" }, OR: [{ scheduledAt: { gte: range.from, lt: range.to } }, { publishedAt: { gte: range.from, lt: range.to } }] },
    orderBy: { scheduledAt: "asc" },
    take: 800,
    include: { post: { select: { id: true, title: true } } },
  });
  const ready = await db.onePost.findMany({ where: { organizationId: a.organizationId, status: "approved" }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, title: true } });
  return {
    items: rows.map((r) => ({ ...deliveryDto(r), postId: r.post.id, title: r.post.title, at: r.status === "published" && r.publishedAt ? r.publishedAt : r.scheduledAt, movable: r.status === "queued" })),
    ready,
  };
}

export { isChannel };
