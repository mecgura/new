import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { documentResponse } from "@/lib/agreement-file";
import { adminDocumentFile, deleteDocument, reviewDocument, reviewSchema } from "@/services/agreements/agreements";

type Ctx = { params: Promise<{ docId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  const d = await adminDocumentFile(idSchema.parse((await params).docId));
  return documentResponse(d, new URL(req.url).searchParams.get("download") === "1");
});

/** Mark verified / rejected (with a note the client sees). */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).docId);
  return ok({ agreement: await reviewDocument(id, await readJson(req, reviewSchema), admin.id, req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  return ok({ agreement: await deleteDocument(idSchema.parse((await params).docId), admin.id, req) });
});
