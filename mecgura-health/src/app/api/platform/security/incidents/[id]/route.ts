import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { getIncident, updateIncident } from "@/lib/services/sec-center";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => getIncident(ctx, params.id));
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => updateIncident(ctx, params.id, (await readJson(req)) as Record<string, string>));
