import { apiRoute, readJson } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { submitEnquiry } from "@/lib/services/enquiries";
import { findTenantByHost } from "@/lib/tenant/resolve-core";

/**
 * Public contact form endpoint. The clinic is resolved from the request HOST — the body never names a tenant, so a
 * visitor on clinic-a's domain can only ever write to clinic A.
 */
export const POST = apiRoute<null>({ auth: false }, async ({ req }) => {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const tenant = await findTenantByHost(host);
  if (!tenant) throw new AppError("NOT_FOUND");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  return submitEnquiry(tenant.id, await readJson(req), ip);
});
