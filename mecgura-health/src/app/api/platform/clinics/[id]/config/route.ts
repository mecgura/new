import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { clinicConfig, updateClinicConfig } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => clinicConfig(ctx, params.id));
export const PUT = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => updateClinicConfig(ctx, params.id, (await readJson(req)) as Record<string, unknown>));
