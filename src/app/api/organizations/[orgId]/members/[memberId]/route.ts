import { handle, ok, readJson } from "@/lib/api";
import { requireOrgAccess } from "@/lib/session";
import { idSchema, updateMemberSchema } from "@/lib/validations";
import { removeMember, updateMemberRole } from "@/lib/services/organizations";

type Ctx = { params: Promise<{ orgId: string; memberId: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const p = await params;
  const orgId = idSchema.parse(p.orgId);
  const memberId = idSchema.parse(p.memberId);
  const access = await requireOrgAccess(orgId, "members:manage", req);
  const { role } = await readJson(req, updateMemberSchema);
  const member = await updateMemberRole(access, memberId, role, req);
  return ok({ member: { id: member.id, role: member.role } });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const p = await params;
  const orgId = idSchema.parse(p.orgId);
  const memberId = idSchema.parse(p.memberId);
  const access = await requireOrgAccess(orgId, "members:manage", req);
  await removeMember(access, memberId, req);
  return ok({ ok: true });
});
