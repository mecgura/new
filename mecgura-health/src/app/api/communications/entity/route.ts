import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { entityComms } from "@/lib/services/comms-staff";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return entityComms(ctx, { entityType: s.get("entityType") ?? undefined, entityId: s.get("entityId") ?? undefined, patientId: s.get("patientId") ?? undefined }); });
