import { db } from "@/lib/db";
import { postStateFrom, type DeliveryStatus } from "@/lib/onepost-publish";

/** Statuses from which a post can be queued (its content was approved by a person and is now locked). */
export const PUBLISHABLE = ["approved", "scheduled", "failed", "published"];

/** The post's overall status follows its channels: scheduled while any is waiting, failed if any failed, published when all are done. */
export async function syncPostState(organizationId: string, postId: string) {
  const post = await db.onePost.findFirst({ where: { id: postId, organizationId }, select: { status: true } });
  if (!post || !PUBLISHABLE.includes(post.status)) return;
  const rows = await db.onePostDelivery.findMany({ where: { postId, organizationId }, select: { status: true, publishedAt: true, scheduledAt: true } });
  const state = postStateFrom(rows.map((r) => r.status as DeliveryStatus));
  const waiting = rows.filter((r) => r.status === "queued").map((r) => r.scheduledAt.getTime());
  const published = rows.map((r) => r.publishedAt?.getTime() ?? 0);
  await db.onePost.update({ where: { id: postId }, data: { status: state, scheduledAt: waiting.length ? new Date(Math.min(...waiting)) : null, publishedAt: Math.max(0, ...published) ? new Date(Math.max(...published)) : null } });
}
