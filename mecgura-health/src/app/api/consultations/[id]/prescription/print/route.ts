import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { recordPrescriptionAccess } from "@/lib/services/prescription";

export const dynamic = "force-dynamic";
/** The browser calls this right before window.print() so printing is audited. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => recordPrescriptionAccess(ctx, params.id, "PRINTED", Number(((await readJson(req)) as { version?: unknown }).version) || 1));
