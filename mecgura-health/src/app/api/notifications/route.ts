import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listNotifications, markNotificationsRead } from "@/lib/services/lab-results";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => listNotifications(ctx));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => markNotificationsRead(ctx, ((await readJson(req).catch(() => ({}))) as { id?: string }).id));
