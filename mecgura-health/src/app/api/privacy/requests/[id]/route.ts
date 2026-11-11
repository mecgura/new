import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { resolveRightsRequest } from "@/lib/services/sec-privacy";

export const dynamic = "force-dynamic";
/** { outcome, note } — closes a data-rights request (never deletes records by itself). */
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "privacy.manage" }, async ({ ctx, req, params }) => resolveRightsRequest(ctx, params.id, (await readJson(req)) as Record<string, string>));
