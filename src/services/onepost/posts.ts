import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit-actions";
import type { OrgAccess } from "@/lib/session";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import {
  CHANNEL_KEYS,
  CHANNEL_LABELS,
  EDITABLE_STATUSES,
  FLOW_ACTION_LABELS,
  FLOW_FROM,
  FLOW_TO,
  LANGUAGE_KEYS,
  MAX_LOGO_BYTES,
  MAX_MEDIA_BYTES,
  MAX_MEDIA_PER_POST,
  POST_TYPE_KEYS,
  STATUSES,
  TONE_KEYS,
  checkContent,
  contentToText,
  duplicateWarnings,
  flowActionsFor,
  isChannel,
  parseContent,
  type Channel,
  type FlowAction,
  type OnePostRole,
  type PostStatus,
} from "@/lib/onepost";
import { DEMO_MODEL, OnePostAi } from "@/services/onepost/ai";
import type { BrandFacts, PostFacts } from "@/services/onepost/prompts";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const str = (max: number) => z.string().trim().max(max);
const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), "Use a full link that starts with https://");

export const postInputSchema = z.object({
  title: z.string().trim().min(2, "Give the post a title or idea").max(140),
  brief: str(5000).default(""),
  postType: z.enum(POST_TYPE_KEYS).default("general"),
  language: z.enum(LANGUAGE_KEYS).default("en"),
  tone: z.enum(TONE_KEYS).default("friendly"),
  city: str(80).default(""),
  keywords: str(300).default(""),
  spokespersonName: str(120).default(""),
  spokespersonQuote: str(600).default(""),
  videoUrl: optionalUrl.default(""),
});
export type PostInput = z.infer<typeof postInputSchema>;

export const brandInputSchema = z.object({
  businessName: str(120).default(""),
  services: str(600).default(""),
  city: str(80).default(""),
  website: optionalUrl.default(""),
  about: str(1500).default(""),
  tone: z.enum(TONE_KEYS).default("friendly"),
  language: z.enum(LANGUAGE_KEYS).default("en"),
  defaultHashtags: str(300).default(""),
  contactName: str(120).default(""),
  contactEmail: z.string().trim().max(160).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email").default(""),
  contactPhone: str(40).default(""),
});
export type BrandInput = z.infer<typeof brandInputSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const roleOf = (a: OrgAccess): OnePostRole => a.role;
const isManagerUp = (a: OrgAccess) => a.role === null || a.role === "CLIENT_OWNER" || a.role === "MANAGER";

type PostRow = { id: string; organizationId: string; status: string; createdById: string | null };

/** May this person change the content of this post right now? Agents: only their own drafts. */
export function canEditPost(a: OrgAccess, p: PostRow): boolean {
  if (!(EDITABLE_STATUSES as string[]).includes(p.status)) return false;
  if (isManagerUp(a)) return true;
  return p.createdById === a.user.id && (p.status === "draft" || p.status === "changes_requested");
}

export function canDeletePost(a: OrgAccess, p: PostRow): boolean {
  if (isManagerUp(a)) return p.status !== "published";
  return p.createdById === a.user.id && p.status === "draft";
}

async function loadPost(a: OrgAccess, id: string) {
  const p = await db.onePost.findFirst({ where: { id, organizationId: a.organizationId } });
  if (!p) throw new ApiError("NOT_FOUND", "Post not found.");
  return p;
}

async function logEvent(a: OrgAccess, postId: string, action: string, note = "") {
  await db.onePostEvent.create({ data: { organizationId: a.organizationId, postId, actorUserId: a.user.id, action, note: note.slice(0, 500) } });
}

const log = (a: OrgAccess, action: AuditAction, postId: string | null, metadata: Record<string, unknown>, req?: Request) =>
  audit({ action, actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost", targetId: postId ?? "", metadata, req });

/** Any content change after review sends the post back to draft, so nothing approved is changed behind the approver's back. */
async function resetApproval(a: OrgAccess, post: PostRow) {
  if (post.status !== "in_review" && post.status !== "approved") return;
  await db.onePost.update({ where: { id: post.id }, data: { status: "draft", approvedAt: null, approvedById: null, submittedAt: null } });
  await logEvent(a, post.id, "approval_reset", post.status === "approved" ? "Edited after approval: approval removed" : "Edited during review: sent back to draft");
}

const parseJson = <T,>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------------------
// Brand profile
// ---------------------------------------------------------------------------

type BrandRow = Awaited<ReturnType<typeof db.onePostBrand.findUnique>>;
const brandDto = (orgId: string, b: NonNullable<BrandRow>) => ({
  businessName: b.businessName,
  services: b.services,
  city: b.city,
  website: b.website,
  about: b.about,
  tone: b.tone,
  language: b.language,
  defaultHashtags: b.defaultHashtags,
  contactName: b.contactName,
  contactEmail: b.contactEmail,
  contactPhone: b.contactPhone,
  hasLogo: Boolean(b.logoType),
  logoUrl: b.logoType ? `/api/organizations/${orgId}/onepost/brand/logo?v=${b.updatedAt.getTime()}` : null,
});
export type BrandDto = ReturnType<typeof brandDto>;

export async function getBrand(a: OrgAccess) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const b = await db.onePostBrand.findUnique({ where: { organizationId: a.organizationId } });
  if (b) return brandDto(a.organizationId, b);
  const org = await db.organization.findUnique({ where: { id: a.organizationId }, select: { name: true } });
  // Not saved yet: show the workspace name so the first post already has a business name to write from.
  return { businessName: org?.name ?? "", services: "", city: "", website: "", about: "", tone: "friendly", language: "en", defaultHashtags: "", contactName: "", contactEmail: "", contactPhone: "", hasLogo: false, logoUrl: null } satisfies BrandDto;
}

export async function saveBrand(a: OrgAccess, input: BrandInput, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const b = await db.onePostBrand.upsert({ where: { organizationId: a.organizationId }, create: { organizationId: a.organizationId, ...input }, update: input });
  await log(a, "onepost.brand_saved", null, { fields: Object.keys(input).length }, req);
  return brandDto(a.organizationId, b);
}

const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
function decodeImage(dataUrl: string, maxBytes: number, label: string) {
  const m = IMAGE_RE.exec(dataUrl);
  if (!m) throw new ApiError("VALIDATION_ERROR", "Use a JPG, PNG or WebP image.", { details: { image: ["Unsupported"] } });
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length || bytes.length > maxBytes) throw new ApiError("VALIDATION_ERROR", `${label} can be up to ${Math.round(maxBytes / 1024 / 1024)} MB.`, { details: { image: ["Too large"] } });
  return { type: m[1], bytes: new Uint8Array(bytes) };
}

export async function setLogo(a: OrgAccess, dataUrl: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const img = decodeImage(dataUrl, MAX_LOGO_BYTES, "The logo");
  const org = await db.organization.findUnique({ where: { id: a.organizationId }, select: { name: true } });
  const b = await db.onePostBrand.upsert({
    where: { organizationId: a.organizationId },
    create: { organizationId: a.organizationId, businessName: org?.name ?? "", logoType: img.type, logo: img.bytes },
    update: { logoType: img.type, logo: img.bytes },
  });
  await log(a, "onepost.brand_saved", null, { logo: "set" }, req);
  return brandDto(a.organizationId, b);
}

export async function clearLogo(a: OrgAccess, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  await db.onePostBrand.updateMany({ where: { organizationId: a.organizationId }, data: { logoType: "", logo: null } });
  await log(a, "onepost.brand_saved", null, { logo: "removed" }, req);
}

export async function logoFile(a: OrgAccess) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const b = await db.onePostBrand.findUnique({ where: { organizationId: a.organizationId }, select: { logoType: true, logo: true } });
  if (!b?.logo || !b.logoType) throw new ApiError("NOT_FOUND", "No logo uploaded.");
  return { type: b.logoType, bytes: b.logo };
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

type FullPost = NonNullable<Awaited<ReturnType<typeof loadFull>>>;

async function loadFull(organizationId: string, id: string) {
  return db.onePost.findFirst({
    where: { id, organizationId },
    include: {
      media: { select: { id: true, name: true, mimeType: true, sizeBytes: true, position: true }, orderBy: { position: "asc" } },
      versions: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "desc" }, take: 40 },
    },
  });
}

const summary = (orgId: string, p: { id: string; title: string; postType: string; language: string; status: string; reviewNote: string; createdById: string | null; createdAt: Date; updatedAt: Date; _count?: { versions: number; media: number } }) => ({
  id: p.id,
  title: p.title,
  postType: p.postType,
  language: p.language,
  status: p.status as PostStatus,
  reviewNote: p.reviewNote,
  createdById: p.createdById,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  versionCount: p._count?.versions ?? 0,
  mediaCount: p._count?.media ?? 0,
  orgId,
});
export type PostSummary = ReturnType<typeof summary>;

async function detailDto(a: OrgAccess, p: FullPost) {
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set([p.createdById, ...p.events.map((e) => e.actorUserId)].filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name || u.email]),
  );
  const row = { id: p.id, organizationId: p.organizationId, status: p.status, createdById: p.createdById };
  return {
    id: p.id,
    title: p.title,
    brief: p.brief,
    postType: p.postType,
    language: p.language,
    tone: p.tone,
    city: p.city,
    keywords: p.keywords,
    spokespersonName: p.spokespersonName,
    spokespersonQuote: p.spokespersonQuote,
    videoUrl: p.videoUrl,
    status: p.status as PostStatus,
    reviewNote: p.reviewNote,
    createdById: p.createdById,
    createdByName: p.createdById ? names.get(p.createdById) ?? "" : "",
    submittedAt: p.submittedAt,
    approvedAt: p.approvedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    media: p.media.map((m) => ({ id: m.id, name: m.name, mimeType: m.mimeType, sizeBytes: m.sizeBytes, url: `/api/organizations/${p.organizationId}/onepost/posts/${p.id}/media/${m.id}` })),
    versions: p.versions
      .filter((v) => isChannel(v.channel))
      .map((v) => ({ channel: v.channel as Channel, content: parseJson<unknown>(v.content, {}), checks: parseJson<string[]>(v.checks, []), model: v.model, generation: v.generation, edited: Boolean(v.editedAt), updatedAt: v.updatedAt })),
    events: p.events.map((e) => ({ id: e.id, action: e.action, note: e.note, actor: e.actorUserId ? names.get(e.actorUserId) ?? "Someone" : "System", createdAt: e.createdAt })),
    can: { edit: canEditPost(a, row), delete: canDeletePost(a, row), actions: flowActionsFor(p.status as PostStatus, roleOf(a)).map((k) => ({ key: k, label: FLOW_ACTION_LABELS[k] })) },
    live: await OnePostAi.isLive(),
  };
}
export type PostDetail = Awaited<ReturnType<typeof detailDto>>;

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export async function listPosts(a: OrgAccess, filter: { status?: string; q?: string } = {}) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const status = (STATUSES as readonly string[]).includes(filter.status ?? "") ? filter.status : undefined;
  const q = filter.q?.trim();
  const rows = await db.onePost.findMany({
    where: { organizationId: a.organizationId, ...(status ? { status } : {}), ...(q ? { OR: [{ title: { contains: q } }, { brief: { contains: q } }] } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { _count: { select: { versions: true, media: true } } },
  });
  const counts = await db.onePost.groupBy({ by: ["status"], where: { organizationId: a.organizationId }, _count: { _all: true } });
  return { posts: rows.map((p) => summary(a.organizationId, p)), counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number> };
}

export async function getPost(a: OrgAccess, id: string) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const p = await loadFull(a.organizationId, id);
  if (!p) throw new ApiError("NOT_FOUND", "Post not found.");
  return detailDto(a, p);
}

export async function createPost(a: OrgAccess, input: PostInput, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const p = await db.onePost.create({ data: { organizationId: a.organizationId, createdById: a.user.id, ...input } });
  await logEvent(a, p.id, "created");
  await log(a, "onepost.created", p.id, { type: input.postType, language: input.language }, req);
  return getPost(a, p.id);
}

export async function updatePost(a: OrgAccess, id: string, input: PostInput, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const p = await loadPost(a, id);
  if (!canEditPost(a, p)) throw new ApiError("FORBIDDEN", "You can't edit this post right now.");
  await db.onePost.update({ where: { id }, data: input });
  await resetApproval(a, p);
  await log(a, "onepost.updated", id, {}, req);
  return getPost(a, id);
}

export async function deletePost(a: OrgAccess, id: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const p = await loadPost(a, id);
  if (!canDeletePost(a, p)) throw new ApiError("FORBIDDEN", "You can't delete this post.");
  await db.onePost.delete({ where: { id } });
  await log(a, "onepost.deleted", id, { title: p.title }, req);
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export async function addMedia(a: OrgAccess, postId: string, input: { name: string; image: string }, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const p = await loadPost(a, postId);
  if (!canEditPost(a, p)) throw new ApiError("FORBIDDEN", "You can't edit this post right now.");
  const count = await db.onePostMedia.count({ where: { postId, organizationId: a.organizationId } });
  if (count >= MAX_MEDIA_PER_POST) throw new ApiError("VALIDATION_ERROR", `A post can have up to ${MAX_MEDIA_PER_POST} images.`);
  const img = decodeImage(input.image, MAX_MEDIA_BYTES, "Images");
  await db.onePostMedia.create({ data: { organizationId: a.organizationId, postId, name: input.name.slice(0, 120) || "Image", mimeType: img.type, sizeBytes: img.bytes.length, bytes: img.bytes, position: count } });
  await resetApproval(a, p);
  await log(a, "onepost.updated", postId, { media: "added" }, req);
  return getPost(a, postId);
}

export async function removeMedia(a: OrgAccess, postId: string, mediaId: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const p = await loadPost(a, postId);
  if (!canEditPost(a, p)) throw new ApiError("FORBIDDEN", "You can't edit this post right now.");
  const r = await db.onePostMedia.deleteMany({ where: { id: mediaId, postId, organizationId: a.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Image not found.");
  await resetApproval(a, p);
  await log(a, "onepost.updated", postId, { media: "removed" }, req);
  return getPost(a, postId);
}

export async function mediaFile(a: OrgAccess, postId: string, mediaId: string) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const m = await db.onePostMedia.findFirst({ where: { id: mediaId, postId, organizationId: a.organizationId }, select: { mimeType: true, bytes: true } });
  if (!m) throw new ApiError("NOT_FOUND", "Image not found.");
  return m;
}

// ---------------------------------------------------------------------------
// AI conversion
// ---------------------------------------------------------------------------

async function facts(organizationId: string, p: { title: string; brief: string; postType: string; language: string; tone: string; city: string; keywords: string; spokespersonName: string; spokespersonQuote: string; videoUrl: string; id: string }) {
  const [b, org, media] = await Promise.all([
    db.onePostBrand.findUnique({ where: { organizationId } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    db.onePostMedia.count({ where: { postId: p.id, organizationId } }),
  ]);
  const brand: BrandFacts = {
    businessName: b?.businessName || org?.name || "",
    services: b?.services ?? "",
    city: b?.city ?? "",
    website: b?.website ?? "",
    about: b?.about ?? "",
    tone: b?.tone ?? "friendly",
    language: b?.language ?? "en",
    defaultHashtags: b?.defaultHashtags ?? "",
    contactName: b?.contactName ?? "",
    contactEmail: b?.contactEmail ?? "",
    contactPhone: b?.contactPhone ?? "",
  };
  const post: PostFacts = { title: p.title, brief: p.brief, postType: p.postType, language: p.language, tone: p.tone, city: p.city, keywords: p.keywords, spokespersonName: p.spokespersonName, spokespersonQuote: p.spokespersonQuote, videoUrl: p.videoUrl, hasMedia: media > 0 };
  return { brand, post };
}

/** At most this many AI calls run at once. */
const CONCURRENCY = 4;

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.allSettled(items.slice(i, i + size).map(fn))));
  return out;
}

/**
 * Writes (or rewrites) versions of a post.
 * Each channel is written separately with its own angle. When two channels still come out too similar, the later one is rewritten once
 * with the other's wording as "do not reuse", and anything still too close is flagged on the card.
 */
export async function generateVersions(a: OrgAccess, postId: string, channels: Channel[] | undefined, opts: { instruction?: string } = {}, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const p = await loadPost(a, postId);
  if (!canEditPost(a, p)) throw new ApiError("FORBIDDEN", "You can't edit this post right now.");
  const wanted = (channels?.length ? [...new Set(channels)] : [...CHANNEL_KEYS]) as Channel[];
  const { brand, post } = await facts(a.organizationId, p);
  if (wanted.includes("press_release") && post.spokespersonQuote && !post.spokespersonName) {
    throw new ApiError("VALIDATION_ERROR", "Add the name of the person who said the quote, so the press release can credit them.", { details: { spokespersonName: ["Required with a quote"] } });
  }

  const existing = await db.onePostVersion.findMany({ where: { postId, organizationId: a.organizationId } });
  const byChannel = new Map(existing.map((v) => [v.channel, v]));
  const failures: { channel: Channel; error: string }[] = [];
  const fresh = new Map<Channel, { content: unknown; model: string; inputTokens: number; outputTokens: number }>();

  const results = await inBatches(wanted, CONCURRENCY, async (channel) => {
    const g = await OnePostAi.generate({ brand, post, channel, instruction: opts.instruction });
    return { channel, g };
  });
  results.forEach((r, i) => {
    if (r.status === "fulfilled") fresh.set(r.value.channel, r.value.g);
    else failures.push({ channel: wanted[i], error: r.reason instanceof Error ? r.reason.message : "Could not write this version." });
  });
  if (!fresh.size) throw new ApiError("SERVICE_UNAVAILABLE", failures[0]?.error ?? "The AI could not write the versions. Please try again.");

  const current = (): { channel: Channel; content: unknown; model: string }[] => [
    ...existing.filter((v) => isChannel(v.channel) && !fresh.has(v.channel as Channel)).map((v) => ({ channel: v.channel as Channel, content: parseJson<unknown>(v.content, {}), model: v.model })),
    ...[...fresh].map(([channel, g]) => ({ channel, content: g.content, model: g.model })),
  ];

  // One rewrite for versions that came out too close to another channel.
  const live = [...fresh.values()].every((g) => g.model !== DEMO_MODEL);
  if (live) {
    const dups = duplicateWarnings(current());
    const redo = [...fresh.keys()].filter((c) => dups.has(c));
    for (const channel of redo) {
      const avoid = current()
        .filter((v) => v.channel !== channel)
        .map((v) => `${CHANNEL_LABELS[v.channel]}: ${contentToText(v.channel, v.content).slice(0, 500)}`)
        .join("\n---\n");
      try {
        const g = await OnePostAi.generate({ brand, post, channel, avoid, instruction: opts.instruction });
        const prev = fresh.get(channel)!;
        fresh.set(channel, { ...g, inputTokens: g.inputTokens + prev.inputTokens, outputTokens: g.outputTokens + prev.outputTokens });
      } catch {
        /* keep the first version; the card will carry the "too similar" warning */
      }
    }
  }

  const all = current();
  const dups = all.every((v) => v.model !== DEMO_MODEL) ? duplicateWarnings(all) : new Map<Channel, string[]>();
  for (const [channel, g] of fresh) {
    const checks = [...checkContent(channel, g.content, { quote: post.spokespersonQuote }), ...(dups.get(channel) ?? [])];
    const prev = byChannel.get(channel);
    const data = { content: JSON.stringify(g.content), checks: JSON.stringify(checks), model: g.model, inputTokens: g.inputTokens, outputTokens: g.outputTokens, editedById: null, editedAt: null };
    if (prev) await db.onePostVersion.update({ where: { id: prev.id }, data: { ...data, generation: prev.generation + 1 } });
    else await db.onePostVersion.create({ data: { organizationId: a.organizationId, postId, channel, ...data } });
  }
  await resetApproval(a, p);
  await logEvent(a, postId, "generated", [...fresh.keys()].map((c) => CHANNEL_LABELS[c]).join(", "));
  await log(a, "onepost.generated", postId, { channels: [...fresh.keys()], failed: failures.length, demo: !live }, req);
  return { post: await getPost(a, postId), failures };
}

/** Saves a person's edit of one version (strictly validated). */
export async function saveVersion(a: OrgAccess, postId: string, channel: Channel, content: unknown, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const p = await loadPost(a, postId);
  if (!canEditPost(a, p)) throw new ApiError("FORBIDDEN", "You can't edit this post right now.");
  const v = await db.onePostVersion.findUnique({ where: { postId_channel: { postId, channel } } });
  if (!v || v.organizationId !== a.organizationId) throw new ApiError("NOT_FOUND", "That version hasn't been written yet. Generate it first.");
  const clean = parseContent(channel, content);
  const others = (await db.onePostVersion.findMany({ where: { postId, organizationId: a.organizationId, NOT: { channel } } })).filter((o) => isChannel(o.channel));
  const all = [...others.map((o) => ({ channel: o.channel as Channel, content: parseJson<unknown>(o.content, {}) })), { channel, content: clean }];
  const dup = v.model === DEMO_MODEL ? [] : duplicateWarnings(all).get(channel) ?? [];
  const checks = [...checkContent(channel, clean, { quote: p.spokespersonQuote }), ...dup];
  await db.onePostVersion.update({ where: { id: v.id }, data: { content: JSON.stringify(clean), checks: JSON.stringify(checks), editedById: a.user.id, editedAt: new Date() } });
  await resetApproval(a, p);
  await logEvent(a, postId, "version_edited", CHANNEL_LABELS[channel]);
  await log(a, "onepost.version_edited", postId, { channel }, req);
  return getPost(a, postId);
}

// ---------------------------------------------------------------------------
// Approval flow
// ---------------------------------------------------------------------------

export async function runFlow(a: OrgAccess, postId: string, action: FlowAction, note: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const p = await loadPost(a, postId);
  const allowed = flowActionsFor(p.status as PostStatus, roleOf(a));
  if (!allowed.includes(action)) {
    const fromOk = FLOW_FROM[action].includes(p.status as PostStatus);
    throw new ApiError(fromOk ? "FORBIDDEN" : "CONFLICT", fromOk ? "Your role can't do this." : `This post is ${p.status.replace("_", " ")}, so “${FLOW_ACTION_LABELS[action]}” isn't available.`);
  }
  if ((action === "submit" || action === "approve") && !(await db.onePostVersion.count({ where: { postId, organizationId: a.organizationId } }))) {
    throw new ApiError("VALIDATION_ERROR", "Write the channel versions first. There is nothing to review yet.");
  }
  const text = note.trim();
  if (action === "request_changes" && !text) throw new ApiError("VALIDATION_ERROR", "Say what should change.", { details: { note: ["Required"] } });
  const now = new Date();
  const to = FLOW_TO[action];
  await db.onePost.update({
    where: { id: postId },
    data: {
      status: to,
      reviewNote: action === "request_changes" ? text : action === "approve" || action === "submit" || action === "reopen" ? "" : p.reviewNote,
      submittedAt: action === "submit" ? now : action === "reopen" ? null : p.submittedAt,
      approvedAt: action === "approve" ? now : null,
      approvedById: action === "approve" ? a.user.id : null,
    },
  });
  await logEvent(a, postId, action, text);
  const audited: Record<FlowAction, AuditAction> = { submit: "onepost.submitted", approve: "onepost.approved", request_changes: "onepost.changes_requested", reopen: "onepost.reopened" };
  await log(a, audited[action], postId, { from: p.status, to }, req);
  return getPost(a, postId);
}

export const flowInputSchema = z.object({ action: z.enum(["submit", "approve", "request_changes", "reopen"]), note: str(500).default("") });
export const generateInputSchema = z.object({ channels: z.array(z.enum(CHANNEL_KEYS)).max(CHANNEL_KEYS.length).optional(), instruction: str(500).optional() });
export const versionInputSchema = z.object({ content: z.unknown() });
