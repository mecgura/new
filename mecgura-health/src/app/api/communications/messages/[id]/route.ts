import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getMessage } from "@/lib/services/comms-staff";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => getMessage(ctx, params.id));
