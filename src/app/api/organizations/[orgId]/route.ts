import { ApiError, handle, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { requireOrgAccess } from "@/lib/session";
import { idSchema, organizationUpdateSchema } from "@/lib/validations";
import { updateOrganization } from "@/lib/services/organizations";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  const access = await requireOrgAccess(orgId, "org:read", req);
  const organization = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true, status: true, createdAt: true, _count: { select: { members: true } } },
  });
  if (!organization) throw new ApiError("NOT_FOUND");
  return ok({ organization, role: access.role });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  const access = await requireOrgAccess(orgId, "org:update", req);
  const { name } = await readJson(req, organizationUpdateSchema);
  return ok({ organization: await updateOrganization(access, name, req) });
});
