import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { consentState, recordConsent } from "@/lib/services/sec-privacy";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => consentState(ctx, params.patientId));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, req, params }) => recordConsent(ctx, params.patientId, (await readJson(req)) as Record<string, string>));
