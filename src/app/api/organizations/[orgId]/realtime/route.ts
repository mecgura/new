import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { db } from "@/lib/db";
import { orgRoute } from "@/lib/route-helpers";
import { can } from "@/services/inbox/conversations";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ after: z.coerce.number().int().min(0).optional() });
const PAGE = 200;
const KEEP_MS = 60 * 60_000;

/**
 * Live updates by polling. Serverless instances don't share memory, so events are stored (see lib/realtime/broker) and the
 * browser asks for what's new after its cursor. Without a cursor it just returns the current one. Events contain ids only,
 * and agents only get conversation events for chats they can see.
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:read");
  const { after } = readQuery(req, query);
  const orgId = access.organizationId;

  if (Math.random() < 0.02) void db.realtimeEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } }).catch(() => undefined);

  if (after === undefined) {
    const last = await db.realtimeEvent.findFirst({ where: { organizationId: orgId }, orderBy: { seq: "desc" }, select: { seq: true } });
    return ok({ cursor: last?.seq ?? 0, events: [], resync: false });
  }
  const rows = await db.realtimeEvent.findMany({ where: { organizationId: orgId, seq: { gt: after } }, orderBy: { seq: "asc" }, take: PAGE + 1 });
  const overflow = rows.length > PAGE;
  const batch = overflow ? rows.slice(0, PAGE) : rows;
  const viewAll = can(access, "inbox:view_all");
  const me = access.user.id;
  const events = batch
    .filter((r) => viewAll || !r.assignedToUserId || r.assignedToUserId === me)
    .map((r) => {
      try {
        return JSON.parse(r.data) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((e): e is Record<string, unknown> => e !== null);
  // Too far behind (more than a page of events): jump to the latest and tell the screen to reload.
  if (overflow) {
    const last = await db.realtimeEvent.findFirst({ where: { organizationId: orgId }, orderBy: { seq: "desc" }, select: { seq: true } });
    return ok({ cursor: last?.seq ?? after, events: [], resync: true });
  }
  return ok({ cursor: batch.length ? batch[batch.length - 1].seq : after, events, resync: false });
});
