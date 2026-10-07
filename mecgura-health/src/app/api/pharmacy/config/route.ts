import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listConfig, saveConfigItem } from "@/lib/services/pharmacy-master";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => listConfig(ctx));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => saveConfigItem(ctx, null, await readJson(req)));
