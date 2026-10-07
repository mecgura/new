import { db } from "@/lib/db";

export type NotificationType = "info" | "success" | "warning" | "security";

export type NotifyInput = {
  userId: string;
  organizationId?: string | null;
  type?: NotificationType;
  title: string;
  body?: string;
  link?: string;
};

/** Creates an in-app notification. Never throws — notifications are best-effort. */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    await db.notification.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        type: input.type ?? "info",
        title: input.title.slice(0, 200),
        body: (input.body ?? "").slice(0, 1000),
        link: safeInternalLink(input.link),
      },
    });
  } catch (e) {
    console.error("[notify] failed", e);
  }
}

/** Only same-site relative links are stored, so a notification can never become an open redirect. */
function safeInternalLink(link?: string): string {
  if (!link) return "";
  return link.startsWith("/") && !link.startsWith("//") ? link.slice(0, 300) : "";
}

export async function listNotifications(userId: string, opts: { page: number; pageSize: number; unreadOnly?: boolean }) {
  const where = { userId, ...(opts.unreadOnly ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, total, unread };
}

/** Marks one notification read. Scoped by userId so users can never touch someone else's row. */
export async function markRead(userId: string, id: string): Promise<boolean> {
  const r = await db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  if (r.count > 0) return true;
  return (await db.notification.count({ where: { id, userId } })) > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const r = await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return r.count;
}
