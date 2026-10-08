import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { clinicHealth, clinicSetup, clinicUsage, whiteLabelCheck } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => ({ setup: await clinicSetup(ctx, params.id), health: await clinicHealth(ctx, params.id), usage: await clinicUsage(ctx, params.id), whiteLabel: await whiteLabelCheck(ctx, params.id) }));
