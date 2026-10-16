import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getDoctorForEdit, saveDoctorProfile } from "@/lib/services/website-doctors";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "website.view" }, async ({ ctx, params }) => getDoctorForEdit(ctx, params.userId));
export const PATCH = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => saveDoctorProfile(ctx, params.userId, await readJson(req)));
