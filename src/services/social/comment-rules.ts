import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import type { OrgAccess } from "@/lib/session";
import { replyToComment, sendCommentPrivateReply } from "@/providers/meta/social";

/**
 * "Comment PRICE and we'll DM you": when someone comments a chosen word on the business's Instagram post or reel,
 * they get one private message (and optionally a public reply). One private reply per comment is all Meta allows.
 */
export const commentRuleSchema = z.object({
  channelAccountId: z.string().min(1),
  name: z.string().trim().min(2).max(60),
  keywords: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  dmText: z.string().trim().min(5).max(900),
  publicReply: z.string().trim().max(280).default(""),
  status: z.enum(["active", "paused"]).default("active"),
});
export type CommentRuleInput = z.infer<typeof commentRuleSchema>;

const words = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
const dto = (r: { id: string; channelAccountId: string; name: string; keywords: string; dmText: string; publicReply: string; status: string; repliesCount: number; lastReplyAt: Date | null }) => ({
  id: r.id,
  channelAccountId: r.channelAccountId,
  name: r.name,
  keywords: words(r.keywords),
  dmText: r.dmText,
  publicReply: r.publicReply,
  status: r.status,
  repliesCount: r.repliesCount,
  lastReplyAt: r.lastReplyAt,
});

async function instagramAccount(organizationId: string, id: string) {
  const a = await db.channelAccount.findFirst({ where: { id, organizationId, kind: "instagram" } });
  if (!a) throw new ApiError("VALIDATION_ERROR", "Choose a connected Instagram account.", { details: { channelAccountId: ["Not an Instagram inbox"] } });
  return a;
}

export async function listCommentRules(organizationId: string) {
  const [rules, accounts, recent] = await Promise.all([
    db.commentRule.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    db.channelAccount.findMany({ where: { organizationId, kind: "instagram" }, select: { id: true, name: true, status: true } }),
    db.commentReply.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, fromUsername: true, text: true, status: true, error: true, createdAt: true } }),
  ]);
  return { rules: rules.map(dto), accounts, recent };
}

export async function createCommentRule(access: OrgAccess, input: CommentRuleInput, req?: Request) {
  await instagramAccount(access.organizationId, input.channelAccountId);
  if ((await db.commentRule.count({ where: { organizationId: access.organizationId } })) >= 30) throw new ApiError("CONFLICT", "You can have up to 30 comment rules.");
  const r = await db.commentRule.create({ data: { organizationId: access.organizationId, ...input, keywords: JSON.stringify(input.keywords.map((k) => k.toLowerCase())) } });
  await audit({ action: "comment_rule.saved", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "comment_rule", targetId: r.id, metadata: { name: r.name }, req });
  return dto(r);
}

export async function updateCommentRule(access: OrgAccess, id: string, input: CommentRuleInput, req?: Request) {
  const before = await db.commentRule.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!before) throw new ApiError("NOT_FOUND", "Rule not found.");
  await instagramAccount(access.organizationId, input.channelAccountId);
  const r = await db.commentRule.update({ where: { id }, data: { ...input, keywords: JSON.stringify(input.keywords.map((k) => k.toLowerCase())) } });
  await audit({ action: "comment_rule.saved", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "comment_rule", targetId: r.id, metadata: { name: r.name }, req });
  return dto(r);
}

export async function deleteCommentRule(access: OrgAccess, id: string, req?: Request) {
  const r = await db.commentRule.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!r) throw new ApiError("NOT_FOUND", "Rule not found.");
  await db.commentRule.delete({ where: { id } });
  await audit({ action: "comment_rule.deleted", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "comment_rule", targetId: id, metadata: { name: r.name }, req });
}

/** A rule with no keywords answers every comment; otherwise the comment must contain one of the words. */
export function ruleMatches(keywords: string[], text: string) {
  const t = text.toLowerCase();
  return keywords.length === 0 || keywords.some((k) => t.includes(k.toLowerCase()));
}

type Comment = { commentId: string; text: string; fromId: string; username: string };

/** Answers one Instagram comment. Returns what happened; the same comment is never answered twice. */
export async function handleInstagramComment(account: { id: string; organizationId: string; address: string; encryptedToken: string; status: string }, c: Comment): Promise<"replied" | "failed" | "duplicate" | "ignored"> {
  if (!c.commentId || !c.text.trim() || c.fromId === account.address || account.status !== "active" || !account.encryptedToken) return "ignored";
  const rules = await db.commentRule.findMany({ where: { channelAccountId: account.id, status: "active" }, orderBy: { createdAt: "asc" } });
  // Rules with keywords win over a catch-all rule.
  const rule = rules.find((r) => words(r.keywords).length && ruleMatches(words(r.keywords), c.text)) ?? rules.find((r) => !words(r.keywords).length);
  if (!rule) return "ignored";
  let log;
  try {
    log = await db.commentReply.create({ data: { organizationId: account.organizationId, ruleId: rule.id, commentId: c.commentId, fromUsername: c.username.slice(0, 80), text: c.text.slice(0, 300), status: "sent" } });
  } catch {
    return "duplicate";
  }
  try {
    const token = decryptSecret(account.encryptedToken);
    const name = c.username ? `@${c.username}` : "there";
    await sendCommentPrivateReply(token, c.commentId, rule.dmText.replaceAll("{{name}}", name));
    if (rule.publicReply) await replyToComment(token, c.commentId, rule.publicReply.replaceAll("{{name}}", name)).catch(() => "");
    await db.commentRule.update({ where: { id: rule.id }, data: { repliesCount: { increment: 1 }, lastReplyAt: new Date() } });
    return "replied";
  } catch (e) {
    await db.commentReply.update({ where: { id: log.id }, data: { status: "failed", error: (e instanceof Error ? e.message : "Instagram refused the message.").slice(0, 300) } });
    return "failed";
  }
}
