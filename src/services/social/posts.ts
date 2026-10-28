import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { siteConfig } from "@/config/site";
import type { OrgAccess } from "@/lib/session";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { publishFacebookPost, publishInstagramPost } from "@/providers/meta/social";

/**
 * Social Media Management: a content calendar for a client's Facebook Page and Instagram account. Posts are planned
 * as drafts, scheduled, and published through the Meta accounts connected in Channels (Messenger = the Page,
 * Instagram = the business account). Without a connected account a post can still be planned and marked as posted.
 */
export const SOCIAL_CHANNELS = ["facebook", "instagram"] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const postSchema = z.object({
  caption: z.string().trim().max(2200, "Instagram allows up to 2,200 characters").default(""),
  channels: z.array(z.enum(SOCIAL_CHANNELS)).min(1, "Pick at least one channel").max(2),
  scheduledAt: z
    .string()
    .datetime({ offset: true })
    .or(z.literal(""))
    .default("")
    .transform((v) => (v ? new Date(v) : null)),
  /** data:image/...;base64 to set, "" to remove, omitted to keep. */
  image: z
    .string()
    .max(Math.ceil(MAX_MEDIA_BYTES * 1.4))
    .refine((v) => v === "" || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Use a JPG, PNG or WebP image.")
    .optional(),
  status: z.enum(["draft", "scheduled"]).default("draft"),
});
export type PostInput = z.infer<typeof postSchema>;

type Row = Awaited<ReturnType<typeof db.socialPost.findFirstOrThrow>>;
const parse = <T,>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};
export const mediaUrl = (p: Pick<Row, "mediaKey">) => `${siteConfig.url}/api/social-media/${p.mediaKey}`;

function toDto(p: Row) {
  return {
    id: p.id,
    caption: p.caption,
    channels: parse<SocialChannel[]>(p.channels, []),
    hasImage: Boolean(p.mediaType),
    imageUrl: p.mediaType ? `/api/social-media/${p.mediaKey}?v=${p.updatedAt.getTime()}` : null,
    scheduledAt: p.scheduledAt,
    status: p.status,
    publishedAt: p.publishedAt,
    results: parse<Partial<Record<SocialChannel, { id?: string; error?: string }>>>(p.results, {}),
    createdAt: p.createdAt,
  };
}
export type PostDto = ReturnType<typeof toDto>;

function decodeImage(v: string) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(v);
  if (!m || !IMAGE_TYPES.includes(m[1])) throw new ApiError("VALIDATION_ERROR", "Use a JPG, PNG or WebP image.");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_MEDIA_BYTES) throw new ApiError("VALIDATION_ERROR", "Images can be up to 3 MB.");
  return { type: m[1], bytes: new Uint8Array(bytes) };
}

function check(input: PostInput, hasImage: boolean) {
  if (!input.caption && !hasImage) throw new ApiError("VALIDATION_ERROR", "Write a caption or add an image.", { details: { caption: ["Required"] } });
  if (input.channels.includes("instagram") && !hasImage) throw new ApiError("VALIDATION_ERROR", "Instagram posts need an image.", { details: { image: ["Required for Instagram"] } });
  if (input.status === "scheduled") {
    if (!input.scheduledAt) throw new ApiError("VALIDATION_ERROR", "Pick a date and time to schedule.", { details: { scheduledAt: ["Required"] } });
    if (input.scheduledAt.getTime() < Date.now() - 60_000) throw new ApiError("VALIDATION_ERROR", "Pick a time in the future.", { details: { scheduledAt: ["In the past"] } });
  }
}

/** Which of the client's Meta accounts can publish (from Channels). */
export async function socialAccounts(organizationId: string) {
  const rows = await db.channelAccount.findMany({ where: { organizationId, kind: { in: ["messenger", "instagram"] }, status: "active", encryptedToken: { not: "" } }, select: { kind: true, name: true, address: true } });
  return {
    facebook: rows.find((r) => r.kind === "messenger") ? { name: rows.find((r) => r.kind === "messenger")!.name } : null,
    instagram: rows.find((r) => r.kind === "instagram") ? { name: rows.find((r) => r.kind === "instagram")!.name } : null,
  };
}

export async function listPosts(access: OrgAccess, range: { from: Date; to: Date }) {
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  const rows = await db.socialPost.findMany({
    where: { organizationId: access.organizationId, OR: [{ scheduledAt: { gte: range.from, lt: range.to } }, { publishedAt: { gte: range.from, lt: range.to } }, { scheduledAt: null, publishedAt: null }] },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
    take: 500,
  });
  return { posts: rows.map(toDto), accounts: await socialAccounts(access.organizationId) };
}

export async function createPost(access: OrgAccess, input: PostInput, req?: Request) {
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  const media = input.image ? decodeImage(input.image) : null;
  check(input, Boolean(media));
  const p = await db.socialPost.create({
    data: {
      organizationId: access.organizationId,
      caption: input.caption,
      channels: JSON.stringify(input.channels),
      scheduledAt: input.scheduledAt,
      status: input.status,
      mediaType: media?.type ?? "",
      media: media?.bytes ?? null,
      mediaKey: randomBytes(18).toString("base64url"),
      createdById: access.user.id,
    },
  });
  await audit({ action: "social.post_saved", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "social_post", targetId: p.id, metadata: { status: p.status }, req });
  return toDto(p);
}

async function load(organizationId: string, id: string) {
  const p = await db.socialPost.findFirst({ where: { id, organizationId } });
  if (!p) throw new ApiError("NOT_FOUND", "Post not found.");
  return p;
}

export async function updatePost(access: OrgAccess, id: string, input: PostInput, req?: Request) {
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  const p = await load(access.organizationId, id);
  if (p.status === "published" || p.status === "publishing") throw new ApiError("CONFLICT", "This post is already published.");
  const media = input.image ? decodeImage(input.image) : input.image === "" ? null : undefined;
  check(input, media === undefined ? Boolean(p.mediaType) : Boolean(media));
  const u = await db.socialPost.update({
    where: { id },
    data: {
      caption: input.caption,
      channels: JSON.stringify(input.channels),
      scheduledAt: input.scheduledAt,
      status: input.status,
      results: "{}",
      ...(media === undefined ? {} : { mediaType: media?.type ?? "", media: media?.bytes ?? null }),
    },
  });
  await audit({ action: "social.post_saved", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "social_post", targetId: id, metadata: { status: u.status }, req });
  return toDto(u);
}

export async function deletePost(access: OrgAccess, id: string, req?: Request) {
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  await load(access.organizationId, id);
  await db.socialPost.delete({ where: { id } });
  await audit({ action: "social.post_deleted", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "social_post", targetId: id, req });
}

/** For posts made outside MECGURA (no connected account): records it as posted so the calendar stays true. */
export async function markPosted(access: OrgAccess, id: string, req?: Request) {
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  await load(access.organizationId, id);
  const u = await db.socialPost.update({ where: { id }, data: { status: "published", publishedAt: new Date(), results: JSON.stringify({ manual: true }) } });
  await audit({ action: "social.post_published", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "social_post", targetId: id, metadata: { manual: true }, req });
  return toDto(u);
}

/** Publishes one post to its channels now. Claims the post first, so a cron tick and a click can't publish twice. */
export async function publishPost(organizationId: string, id: string, actorUserId: string | null, req?: Request) {
  const claimed = await db.socialPost.updateMany({ where: { id, organizationId, status: { in: ["draft", "scheduled", "failed"] } }, data: { status: "publishing" } });
  if (!claimed.count) throw new ApiError("CONFLICT", "This post is already published or being published.");
  const p = await db.socialPost.findUniqueOrThrow({ where: { id } });
  const channels = parse<SocialChannel[]>(p.channels, []);
  const accounts = await db.channelAccount.findMany({ where: { organizationId, kind: { in: ["messenger", "instagram"] }, status: "active", encryptedToken: { not: "" } } });
  const image = p.mediaType ? mediaUrl(p) : undefined;
  const results: Partial<Record<SocialChannel, { id?: string; error?: string }>> = {};
  for (const ch of channels) {
    const acct = accounts.find((a) => a.kind === (ch === "facebook" ? "messenger" : "instagram"));
    if (!acct) {
      results[ch] = { error: `No ${ch === "facebook" ? "Facebook Page" : "Instagram account"} connected. Connect it in Channels.` };
      continue;
    }
    try {
      const token = decryptSecret(acct.encryptedToken);
      const postId = ch === "facebook" ? await publishFacebookPost(token, acct.address, p.caption, image) : await publishInstagramPost(token, acct.address, p.caption, image!);
      results[ch] = { id: postId };
    } catch (e) {
      results[ch] = { error: e instanceof Error ? e.message.slice(0, 300) : "Publishing failed." };
    }
  }
  const ok = Object.values(results).some((r) => r?.id);
  const failed = Object.values(results).some((r) => r?.error);
  const u = await db.socialPost.update({ where: { id }, data: { status: ok ? "published" : "failed", publishedAt: ok ? new Date() : null, results: JSON.stringify(results) } });
  await audit({ action: "social.post_published", actorUserId, organizationId, targetType: "social_post", targetId: id, metadata: { ok, partial: ok && failed }, req });
  return toDto(u);
}

/** Scheduler: publishes posts whose time has come. */
export async function runDueSocialPosts(limit = 20) {
  const due = await db.socialPost.findMany({ where: { status: "scheduled", scheduledAt: { lte: new Date() } }, orderBy: { scheduledAt: "asc" }, take: limit, select: { id: true, organizationId: true } });
  let published = 0;
  for (const d of due) {
    try {
      const r = await publishPost(d.organizationId, d.id, null);
      if (r.status === "published") published++;
    } catch {
      /* claimed elsewhere */
    }
  }
  return { due: due.length, published };
}

/** Public image for Meta to fetch while publishing (random key, never the post id). */
export async function postMedia(key: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(key)) return null;
  const p = await db.socialPost.findUnique({ where: { mediaKey: key }, select: { media: true, mediaType: true } });
  return p?.media && p.mediaType ? { type: p.mediaType, bytes: p.media } : null;
}
