import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { createAgreement, getAgreement, listAgreements, templateStatus } from "@/services/agreements/agreements";

type Ctx = { params: Promise<{ id: string }> };

/** All agreement versions for this client (newest first) plus whether WhatsApp sending is ready. */
export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  return ok({ agreements: await listAgreements(id), whatsapp: await templateStatus() });
});

/** Starts an agreement prefilled from the client (returns the open one if there already is one). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const a = await createAgreement(id, admin.id, req);
  return ok({ agreement: await getAgreement(a.id) }, { status: 201 });
});
