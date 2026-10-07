import { handle, ok, readJson } from "@/lib/api";
import { requireOrgAccess } from "@/lib/session";
import { addMemberSchema, idSchema } from "@/lib/validations";
import { addMember, listMembers } from "@/lib/services/organizations";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  await requireOrgAccess(orgId, "members:read", req);
  return ok({ members: await listMembers(orgId) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  const access = await requireOrgAccess(orgId, "members:manage", req);
  const input = await readJson(req, addMemberSchema);
  const { member, created } = await addMember(access, input, req);
  return ok({ member: { id: member.id, role: member.role, userId: member.userId }, createdAccount: created }, { status: 201 });
});
