import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getPrescriptionForDispensing } from "@/lib/services/pharmacy-dispensing";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => getPrescriptionForDispensing(ctx, params.id));
