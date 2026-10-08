import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { adminAssign } from "@/lib/services/sub-core";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => adminAssign(ctx, params.tenantId, (await readJson(req)) as Record<string, never>));
