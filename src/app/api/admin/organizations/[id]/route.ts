import { ApiError, handle, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { clientUpdateSchema, deleteClientSchema, idSchema } from "@/lib/validations";
import { deleteClient, setClientStatus, updateClient } from "@/lib/services/clients";
import { getUsageSummary } from "@/lib/services/usage";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const organization = await db.organization.findUnique({
    where: { id },
    include: {
      settings: true,
      services: { orderBy: { service: "asc" } },
      whatsappAccounts: { orderBy: { createdAt: "asc" } },
      subscriptions: { orderBy: { startedAt: "desc" }, include: { plan: { select: { id: true, name: true, slug: true } } } },
      members: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } } },
      },
    },
  });
  if (!organization) throw new ApiError("NOT_FOUND", "Client not found.");
  const current = organization.subscriptions.find((s) => s.status === "active") ?? null;
  const plan = current ? await db.plan.findUnique({ where: { id: current.planId } }) : null;
  return ok({ organization, plan, usage: await getUsageSummary(id) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const { status, ...fields } = await readJson(req, clientUpdateSchema);
  let organization = null;
  if (Object.values(fields).some((v) => v !== undefined)) organization = await updateClient(admin.id, id, fields, req);
  if (status) organization = await setClientStatus(admin.id, id, status, req);
  return ok({ organization });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const { confirmName } = await readJson(req, deleteClientSchema);
  return ok({ ok: true, ...(await deleteClient(admin.id, id, confirmName, req)) });
});
