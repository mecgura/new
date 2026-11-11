import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { adminRequestRefund } from "@/lib/services/sub-admin";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => adminRequestRefund(ctx, params.id, (await readJson(req)) as Record<string, never>));
