import "server-only";
import { AppError } from "@/lib/errors";
import { findTenantByHost } from "@/lib/tenant/resolve-core";

/** Public routes: the clinic comes from the request HOST only (never from the body, query or path). */
export async function publicTenantId(req: Request): Promise<string> {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const tenant = await findTenantByHost(host);
  if (!tenant) throw new AppError("NOT_FOUND");
  return tenant.id;
}
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
