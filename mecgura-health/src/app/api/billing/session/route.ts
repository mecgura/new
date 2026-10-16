import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { closeSession, currentSession, openSession } from "@/lib/services/billing-payments";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => currentSession(ctx));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const b = (await readJson(req)) as { action?: string }; return b.action === "close" ? closeSession(ctx, b) : openSession(ctx, b); });
