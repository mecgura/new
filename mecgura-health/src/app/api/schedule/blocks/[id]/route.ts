import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { deleteBlock } from "@/lib/services/schedule";

export const dynamic = "force-dynamic";
export const DELETE = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => deleteBlock(ctx, params.id));
