import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { opdStats } from "@/lib/services/opd";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "appointments.view" }, async ({ ctx }) => opdStats(ctx));
