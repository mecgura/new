import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { deleteTemplate } from "@/lib/services/consultation";

export const dynamic = "force-dynamic";
export const DELETE = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => deleteTemplate(ctx, params.id));
