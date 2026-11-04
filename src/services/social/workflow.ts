import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { roleHasPermission, type OrgRole } from "@/lib/authz";
import type { OrgAccess } from "@/lib/session";
import { assertServiceEnabled } from "@/services/whatsapp/guards";

/**
 * Social media settings and the approval workflow: when approval is on, posts
 * that managers (or MECGURA's team) schedule wait for the workspace owner to
 * approve them; nothing is published until then.
 */
export const socialSettingsSchema = z.object({
  requireApproval: z.boolean().default(false),
  brandVoice: z.string().trim().max(1000).default(""),
  defaultHashtags: z.string().trim().max(300).default(""),
});
export type SocialSettings = z.infer<typeof socialSettingsSchema>;
export const DEFAULT_SOCIAL: SocialSettings = { requireApproval: false, brandVoice: "", defaultHashtags: "" };

export async function getSocialSettings(organizationId: string): Promise<SocialSettings> {
  const s = await db.organizationSettings.findUnique({ where: { organizationId }, select: { social: true } });
  if (!s?.social) return DEFAULT_SOCIAL;
  try {
    return socialSettingsSchema.parse(JSON.parse(s.social));
  } catch {
    return DEFAULT_SOCIAL;
  }
}

export function canApprove(access: OrgAccess) {
  return access.isPlatformAdmin || (access.role ? roleHasPermission(access.role, "social:approve") : false);
}

export async function saveSocialSettings(access: OrgAccess, input: SocialSettings, req?: Request) {
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  const before = await getSocialSettings(access.organizationId);
  // Only someone who can approve may switch approval off (a manager can't remove the owner's check).
  if (before.requireApproval !== input.requireApproval && !canApprove(access)) throw new ApiError("FORBIDDEN", "Only the workspace owner can change whether posts need approval.");
  const social = JSON.stringify(input);
  await db.organizationSettings.upsert({ where: { organizationId: access.organizationId }, create: { organizationId: access.organizationId, social }, update: { social } });
  await audit({ action: "social.settings_changed", actorUserId: access.user.id, organizationId: access.organizationId, metadata: { requireApproval: input.requireApproval }, req });
  return input;
}

/**
 * Status a post gets when someone saves it. With approval on, a non-approver's
 * "schedule" becomes "waiting for approval"; an approver's schedule counts as approved.
 */
export function savedStatus(access: OrgAccess, wanted: "draft" | "scheduled", s: SocialSettings) {
  if (wanted === "draft") return { status: "draft" as const, approved: false };
  if (!s.requireApproval || canApprove(access)) return { status: "scheduled" as const, approved: s.requireApproval };
  return { status: "pending_approval" as const, approved: false };
}

async function approvers(organizationId: string) {
  const members = await db.organizationMember.findMany({ where: { organizationId }, select: { userId: true, role: true } });
  return members.filter((m) => roleHasPermission(m.role as OrgRole, "social:approve")).map((m) => m.userId);
}

export async function notifyApprovers(organizationId: string, postId: string, caption: string, byUserId: string) {
  for (const userId of await approvers(organizationId)) {
    if (userId === byUserId) continue;
    await notify({ userId, organizationId, title: "A social post needs your approval", body: caption.slice(0, 120) || "Image post", link: `/social?post=${postId}` });
  }
}

async function loadPost(organizationId: string, id: string) {
  const p = await db.socialPost.findFirst({ where: { id, organizationId } });
  if (!p) throw new ApiError("NOT_FOUND", "Post not found.");
  return p;
}

/** Owner approves: a future time → scheduled; no time or a past time → approved draft, ready to publish. */
export async function approvePost(access: OrgAccess, id: string, req?: Request) {
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  if (!canApprove(access)) throw new ApiError("FORBIDDEN", "Only the workspace owner can approve posts.");
  const p = await loadPost(access.organizationId, id);
  if (p.status !== "pending_approval") throw new ApiError("CONFLICT", "This post isn't waiting for approval.");
  const future = p.scheduledAt && p.scheduledAt.getTime() > Date.now();
  const u = await db.socialPost.update({ where: { id }, data: { status: future ? "scheduled" : "draft", approvedAt: new Date(), approvedById: access.user.id, reviewNote: "" } });
  await audit({ action: "social.post_approved", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "social_post", targetId: id, req });
  if (p.createdById && p.createdById !== access.user.id) {
    await notify({ userId: p.createdById, organizationId: access.organizationId, title: future ? "Your post was approved and scheduled" : "Your post was approved", body: p.caption.slice(0, 120) || "Image post", link: `/social?post=${id}` });
  }
  return u;
}

export async function requestChanges(access: OrgAccess, id: string, note: string, req?: Request) {
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  if (!canApprove(access)) throw new ApiError("FORBIDDEN", "Only the workspace owner can review posts.");
  const p = await loadPost(access.organizationId, id);
  if (p.status !== "pending_approval") throw new ApiError("CONFLICT", "This post isn't waiting for approval.");
  const u = await db.socialPost.update({ where: { id }, data: { status: "changes_requested", reviewNote: note.slice(0, 500), approvedAt: null, approvedById: null } });
  await audit({ action: "social.changes_requested", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "social_post", targetId: id, req });
  if (p.createdById && p.createdById !== access.user.id) {
    await notify({ userId: p.createdById, organizationId: access.organizationId, title: "Changes requested on your post", body: note.slice(0, 160), link: `/social?post=${id}` });
  }
  return u;
}

/** Publishing now (button or "mark as posted") needs approval first when approval is on. */
export async function assertMayPublish(access: OrgAccess, post: { approvedAt: Date | null; status: string }) {
  const s = await getSocialSettings(access.organizationId);
  if (!s.requireApproval || canApprove(access)) return;
  if (!post.approvedAt || post.status === "pending_approval" || post.status === "changes_requested") throw new ApiError("FORBIDDEN", "This post needs the owner's approval before it can be published.");
}
