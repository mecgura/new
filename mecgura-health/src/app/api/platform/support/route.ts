import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { listSupportAccess } from "@/lib/services/platform-admin";

export const dynamic = "force-dynamic";
const sp = (req: Request) => new URL(req.url).searchParams;
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => ({ sessions: await listSupportAccess(ctx, sp(req).get("tenantId") ?? undefined) }));
