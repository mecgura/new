import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { orgRoute } from "@/lib/route-helpers";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "contacts:read");
  const tags = await db.tag.findMany({ where: { organizationId: access.organizationId }, orderBy: { name: "asc" }, include: { _count: { select: { contacts: true } } } });
  return ok({ tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color, contacts: t._count.contacts })) });
});
