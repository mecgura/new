import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { clinicFeatures, setClinicFeature } from "@/lib/services/platform-clinics";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => ({ features: await clinicFeatures(ctx, params.id) }));
export const PUT = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => setClinicFeature(ctx, params.id, (await readJson(req)) as { key: string; enabled: boolean; notes?: string; password?: string }));
