import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { listPlans, savePlan } from "@/lib/services/sub-plans";

export const dynamic = "force-dynamic";
const sp = (req: Request) => new URL(req.url).searchParams;
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => listPlans(ctx, { status: sp(req).get("status") ?? undefined, q: sp(req).get("q") ?? undefined }));
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => savePlan(ctx, null, await readJson(req)));
