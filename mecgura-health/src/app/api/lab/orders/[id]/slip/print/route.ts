import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { recordSlipLabelAccess } from "@/lib/services/lab-results";

export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => recordSlipLabelAccess(ctx, "SLIP", params.id));
