import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { adminDetailsSchema, getAgreement, updateAgreement, voidAgreement } from "@/services/agreements/agreements";

type Ctx = { params: Promise<{ agreementId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  return ok({ agreement: await getAgreement(idSchema.parse((await params).agreementId)) });
});

/** Corrects details. A signed agreement becomes a new version for the client to accept again. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).agreementId);
  return ok({ agreement: await updateAgreement(id, await readJson(req, adminDetailsSchema), admin.id, req) });
});

/** Cancels the agreement (the link stops accepting changes). The record is kept. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  return ok({ agreement: await voidAgreement(idSchema.parse((await params).agreementId), admin.id, req) });
});
