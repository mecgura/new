import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { readOpdSettings, saveOpdSettings } from "@/lib/services/schedule";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => readOpdSettings(ctx));
export const PUT = apiRoute<TenantRequestContext>({ tenant: true, permission: "schedule.manage" }, async ({ req, ctx }) => saveOpdSettings(ctx, await readJson(req)));
