import { db } from "@/lib/db";
import { EVENT_PHASES } from "@/lib/onepost-event";

/** The other posts of the same event campaign. */
export async function siblingsOf(organizationId: string, groupId: string) {
  if (!groupId) return [];
  const rows = await db.onePost.findMany({ where: { organizationId, eventGroupId: groupId }, select: { id: true, title: true, eventPhase: true, status: true }, orderBy: { createdAt: "asc" } });
  const order = EVENT_PHASES.map((p) => p.key as string);
  return rows.sort((x, y) => order.indexOf(x.eventPhase) - order.indexOf(y.eventPhase)).map((r) => ({ id: r.id, title: r.title, phase: r.eventPhase, label: EVENT_PHASES.find((p) => p.key === r.eventPhase)?.label ?? r.eventPhase, status: r.status }));
}
