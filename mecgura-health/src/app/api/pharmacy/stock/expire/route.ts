import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { writeOffExpired } from "@/lib/services/pharmacy-inventory";
export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => writeOffExpired(ctx, await readJson(req)));
