import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { setPlanStatus } from "@/lib/services/sub-plans";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => setPlanStatus(ctx, params.id, String(((await readJson(req)) as { status?: string }).status ?? "")));
