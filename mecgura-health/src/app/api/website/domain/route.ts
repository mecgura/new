import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { requestDomain } from "@/lib/services/website-content";

/** Clinic admin REQUESTS a custom domain; a Super Admin attaches and verifies it. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "clinic.settings" }, async ({ req, ctx }) => requestDomain(ctx, await readJson(req)));
