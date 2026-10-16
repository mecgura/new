import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { resetBranding, updateBranding } from "@/lib/services/clinic-settings";
import { parseOrThrow } from "@/lib/validation";
import { brandingSchema } from "@/lib/validation/clinic";

export const PATCH = apiRoute<TenantRequestContext>({ tenant: true, permission: "clinic.settings" }, async ({ req, ctx }) =>
  updateBranding(ctx, parseOrThrow(brandingSchema, await readJson(req))),
);

export const DELETE = apiRoute<TenantRequestContext>({ tenant: true, permission: "clinic.settings" }, async ({ ctx }) => {
  await resetBranding(ctx);
  return { reset: true };
});
