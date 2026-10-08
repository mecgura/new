import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { updateOwnProfile } from "@/lib/services/clinic-settings";
import { parseOrThrow } from "@/lib/validation";
import { clinicProfileSchema } from "@/lib/validation/clinic";

export const dynamic = "force-dynamic";

/** Own clinic only — the clinic is taken from the session, there is no id in the URL. */
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "clinic.view" }, async ({ ctx }) => ctx.tenant);

export const PATCH = apiRoute<TenantRequestContext>({ tenant: true, permission: "clinic.edit" }, async ({ req, ctx }) => {
  await updateOwnProfile(ctx, parseOrThrow(clinicProfileSchema, await readJson(req)));
  return { saved: true };
});
