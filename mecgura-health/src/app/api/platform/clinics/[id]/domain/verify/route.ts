import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { verifyCustomDomain } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => verifyCustomDomain(ctx, params.id));
