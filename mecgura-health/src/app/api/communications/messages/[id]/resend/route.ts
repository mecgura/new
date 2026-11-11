import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { resendMessage } from "@/lib/services/comms-staff";
export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => resendMessage(ctx, params.id));
