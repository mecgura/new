import { requireOrgAccess } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import type { OrgPermission } from "@/lib/authz";

/** Parses route params (all ids validated) and enforces tenant + permission in one step. */
export async function orgRoute<P extends Record<string, string>>(req: Request, params: Promise<P>, permission: OrgPermission) {
  const raw = await params;
  const ids = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, idSchema.parse(v)])) as P;
  const access = await requireOrgAccess(ids.orgId as string, permission, req);
  return { access, ids };
}
