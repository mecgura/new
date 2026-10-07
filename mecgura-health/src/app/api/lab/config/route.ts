import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { addConfigItem, listConfig } from "@/lib/services/lab-master";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => listConfig(ctx));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => addConfigItem(ctx, await readJson(req)));
