import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { createIncident, listIncidents } from "@/lib/services/sec-center";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => { const q = new URL(req.url).searchParams; return listIncidents(ctx, { status: q.get("status") ?? undefined, page: Number(q.get("page")) || 1 }); });
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => createIncident(ctx, (await readJson(req)) as Record<string, string>));
