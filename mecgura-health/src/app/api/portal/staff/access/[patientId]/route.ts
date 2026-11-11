import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { issuePortalInvite, portalAccessFor, setPortalAccountStatus } from "@/lib/services/portal-auth";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => portalAccessFor(ctx, params.patientId));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => { const b = (await readJson(req)) as { action?: string }; if (b.action === "invite") return issuePortalInvite(ctx, params.patientId); if (b.action === "suspend" || b.action === "reactivate") return setPortalAccountStatus(ctx, params.patientId, b.action); throw new AppError("VALIDATION_ERROR", { message: "Unknown action." }); });
