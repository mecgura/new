import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { updateClinicBranding, whiteLabelCheck } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => whiteLabelCheck(ctx, params.id));
export const PUT = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => updateClinicBranding(ctx, params.id, await readJson(req)));
