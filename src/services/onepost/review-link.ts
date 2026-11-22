import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { sha256 } from "@/lib/crypto";
import { siteConfig } from "@/config/site";
import { notify } from "@/lib/notifications";
import type { OrgAccess } from "@/lib/session";
import { isChannel, type Channel } from "@/lib/onepost";
import { assertServiceEnabled } from "@/services/whatsapp/guards";

export const reviewLinkSchema = z.object({ days: z.number().int().min(1).max(30).default(7) });
export const decisionSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  note: z.string().trim().max(500).default(""),
  name: z.string().trim().min(2, "Please type your name").max(80),
});
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

type PostFor = { id: string; title: string; organizationId: string };

/** A fingerprint of everything the client is shown. If any of it changes, the link stops working, so nobody approves text they did not see. */
async function fingerprint(organizationId: string, post: PostFor) {
  const [versions, media] = await Promise.all([
    db.onePostVersion.findMany({ where: { postId: post.id, organizationId }, orderBy: { channel: "asc" }, select: { channel: true, content: true } }),
    db.onePostMedia.findMany({ where: { postId: post.id, organizationId }, orderBy: { id: "asc" }, select: { id: true, blobUrl: true, thumbUrl: true } }),
  ]);
  return sha256(JSON.stringify({ t: post.title, v: versions, m: media }));
}

export type ReviewLinkStatus = "active" | "expired" | "decided" | "revoked" | "stale";

async function statusOf(l: { organizationId: string; postId: string; contentHash: string; expiresAt: Date; decision: string; revokedAt: Date | null }, post: PostFor & { status: string }): Promise<ReviewLinkStatus> {
  if (l.revokedAt) return "revoked";
  if (l.decision) return "decided";
  if (l.expiresAt < new Date()) return "expired";
  if (post.status !== "in_review" || (await fingerprint(l.organizationId, post)) !== l.contentHash) return "stale";
  return "active";
}

/** Creates a private link a client can open without logging in. The link itself is shown once; only its hash is stored. */
export async function createReviewLink(a: OrgAccess, postId: string, days: number, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const post = await db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId } });
  if (!post) throw new ApiError("NOT_FOUND", "Post not found.");
  if (post.status !== "in_review") throw new ApiError("CONFLICT", "Send the post for review first. A client link is for a post that is waiting for approval.");
  if (!(await db.onePostVersion.count({ where: { postId, organizationId: a.organizationId } }))) throw new ApiError("VALIDATION_ERROR", "Write the channel versions first.");
  const token = randomBytes(32).toString("base64url");
  const l = await db.onePostApprovalLink.create({ data: { organizationId: a.organizationId, postId, tokenHash: sha256(token), contentHash: await fingerprint(a.organizationId, post), expiresAt: new Date(Date.now() + days * 86_400_000), createdById: a.user.id } });
  await db.onePostEvent.create({ data: { organizationId: a.organizationId, postId, actorUserId: a.user.id, action: "review_link_created", note: `valid ${days} day(s)` } });
  await audit({ action: "onepost.review_link", actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost", targetId: postId, metadata: { linkId: l.id, days, action: "created" }, req });
  return { id: l.id, url: `${siteConfig.url}/review/${token}`, expiresAt: l.expiresAt };
}

export async function listReviewLinks(a: OrgAccess, postId: string) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const post = await db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId }, select: { id: true, title: true, organizationId: true, status: true } });
  if (!post) throw new ApiError("NOT_FOUND", "Post not found.");
  const rows = await db.onePostApprovalLink.findMany({ where: { postId, organizationId: a.organizationId }, orderBy: { createdAt: "desc" }, take: 10 });
  return { links: await Promise.all(rows.map(async (l) => ({ id: l.id, createdAt: l.createdAt, expiresAt: l.expiresAt, status: await statusOf(l, post), decision: l.decision, decidedBy: l.decidedBy, decisionNote: l.decisionNote, decidedAt: l.decidedAt }))) };
}

export async function revokeReviewLink(a: OrgAccess, postId: string, linkId: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const r = await db.onePostApprovalLink.updateMany({ where: { id: linkId, postId, organizationId: a.organizationId, revokedAt: null, decision: "" }, data: { revokedAt: new Date() } });
  if (!r.count) throw new ApiError("NOT_FOUND", "That link isn't active.");
  await audit({ action: "onepost.review_link", actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost", targetId: postId, metadata: { linkId, action: "revoked" }, req });
}

async function byToken(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  const l = await db.onePostApprovalLink.findUnique({ where: { tokenHash: sha256(token) }, include: { post: true } });
  return l ?? null;
}

const GONE: Record<Exclude<ReviewLinkStatus, "active">, string> = {
  expired: "This review link has expired. Please ask for a new one.",
  decided: "This post has already been reviewed. Thank you.",
  revoked: "This review link was cancelled. Please ask for a new one.",
  stale: "This post was changed after the link was sent, so this link no longer works. Please ask for a new link.",
};

/** What a client sees at their link (no login). Nothing else about the workspace is exposed. */
export async function getReviewView(token: string) {
  const l = await byToken(token);
  if (!l) return { state: "invalid" as const, message: "This review link isn't valid." };
  const st = await statusOf(l, l.post);
  if (st !== "active") return { state: st, message: GONE[st] };
  const [brand, org, versions, media] = await Promise.all([
    db.onePostBrand.findUnique({ where: { organizationId: l.organizationId }, select: { businessName: true, website: true } }),
    db.organization.findUnique({ where: { id: l.organizationId }, select: { name: true } }),
    db.onePostVersion.findMany({ where: { postId: l.postId, organizationId: l.organizationId } }),
    db.onePostMedia.findMany({ where: { postId: l.postId, organizationId: l.organizationId, variantOf: "" }, orderBy: { position: "asc" }, select: { id: true, kind: true, storage: true, blobUrl: true, name: true } }),
  ]);
  return {
    state: "ok" as const,
    message: "",
    expiresAt: l.expiresAt,
    business: brand?.businessName || org?.name || "",
    website: brand?.website ?? "",
    title: l.post.title,
    versions: versions.filter((v) => isChannel(v.channel)).map((v) => ({ channel: v.channel as Channel, content: JSON.parse(v.content) as unknown })),
    media: media.map((m) => ({ id: m.id, kind: m.kind as "image" | "video", name: m.name, url: m.storage === "blob" && m.blobUrl ? m.blobUrl : `/api/onepost-review/${token}/media/${m.id}` })),
  };
}

/** The client's answer. It counts as the approval step for this one post, and records who said so. */
export async function submitReviewDecision(token: string, input: z.infer<typeof decisionSchema>, req?: Request) {
  const l = await byToken(token);
  if (!l) throw new ApiError("NOT_FOUND", "This review link isn't valid.");
  const st = await statusOf(l, l.post);
  if (st !== "active") throw new ApiError("CONFLICT", GONE[st]);
  if (input.decision === "changes_requested" && !input.note) throw new ApiError("VALIDATION_ERROR", "Please say what should change.", { details: { note: ["Required"] } });
  // The link is spent first, so two quick clicks can't decide twice.
  const claimed = await db.onePostApprovalLink.updateMany({ where: { id: l.id, decision: "", revokedAt: null }, data: { decision: input.decision, decisionNote: input.note, decidedBy: input.name, decidedAt: new Date() } });
  if (!claimed.count) throw new ApiError("CONFLICT", GONE.decided);
  const approved = input.decision === "approved";
  await db.onePost.update({
    where: { id: l.postId },
    data: approved ? { status: "approved", approvedAt: new Date(), approvedById: null, reviewNote: "" } : { status: "changes_requested", reviewNote: `${input.name}: ${input.note}`.slice(0, 500), approvedAt: null, approvedById: null },
  });
  await db.onePostEvent.create({ data: { organizationId: l.organizationId, postId: l.postId, actorUserId: null, action: approved ? "client_approved" : "client_requested_changes", note: `${input.name}${input.note ? `: ${input.note}` : ""}`.slice(0, 500) } });
  await audit({ action: "onepost.client_decision", actorUserId: null, organizationId: l.organizationId, targetType: "onepost", targetId: l.postId, metadata: { decision: input.decision, by: input.name }, req });
  const owners = await db.organizationMember.findMany({ where: { organizationId: l.organizationId, role: "CLIENT_OWNER" }, select: { userId: true } });
  const who = new Set([...owners.map((o) => o.userId), ...(l.post.createdById ? [l.post.createdById] : [])]);
  for (const userId of who) await notify({ userId, organizationId: l.organizationId, title: approved ? `${input.name} approved “${l.post.title}”` : `${input.name} asked for changes on “${l.post.title}”`, body: input.note.slice(0, 120) || (approved ? "Ready to publish." : ""), link: `/onepost/${l.postId}` }).catch(() => null);
  return { ok: true, decision: input.decision };
}

/** A file attached to the post, for the client page. Only files of the post this link belongs to, and only while the link is active. */
export async function reviewMedia(token: string, mediaId: string) {
  const l = await byToken(token);
  if (!l || (await statusOf(l, l.post)) !== "active") return null;
  const m = await db.onePostMedia.findFirst({ where: { id: mediaId, postId: l.postId, organizationId: l.organizationId }, select: { mimeType: true, bytes: true, storage: true, blobUrl: true } });
  return m ?? null;
}
