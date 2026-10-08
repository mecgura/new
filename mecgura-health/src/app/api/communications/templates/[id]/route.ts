import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { updateTemplate } from "@/lib/services/comms-staff";
export const dynamic = "force-dynamic";
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => updateTemplate(ctx, params.id, await readJson(req)));
