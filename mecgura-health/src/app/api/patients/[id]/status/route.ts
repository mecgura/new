import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { setPatientStatus } from "@/lib/services/patient-crm";

export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => setPatientStatus(ctx, params.id, ((await readJson(req)) as { status?: unknown }).status));
