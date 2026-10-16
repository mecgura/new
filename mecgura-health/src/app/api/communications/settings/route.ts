import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getCommSettingsView, saveCommSettings } from "@/lib/services/comms-staff";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => getCommSettingsView(ctx));
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { await saveCommSettings(ctx, await readJson(req)); return getCommSettingsView(ctx); });
