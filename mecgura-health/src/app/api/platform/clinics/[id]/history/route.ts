import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { statusHistory } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => ({ history: await statusHistory(ctx, params.id) }));
