import { apiRoute, readJson } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
import { syncReminders } from "@/lib/services/followup-reminders";
export const dynamic = "force-dynamic";
export const GET = apiRoute({}, async ({ req, ctx }) => { if (ctx.tenant && ctx.user.role !== "SUPER_ADMIN") await syncReminders(ctx as never).catch(() => undefined); return N.listNotifications(N.staffActor(ctx), Object.fromEntries(new URL(req.url).searchParams)); });
export const POST = apiRoute({}, async ({ req, ctx }) => { const b = ((await readJson(req).catch(() => ({}))) as { id?: string }); return b.id ? N.markRead(N.staffActor(ctx), b.id) : N.markAllRead(N.staffActor(ctx)); }); // kept for the Phase 6 lab card
