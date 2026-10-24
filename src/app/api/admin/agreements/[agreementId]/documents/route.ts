import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { readUpload } from "@/lib/agreement-file";
import { adminUploadDocument } from "@/services/agreements/agreements";

type Ctx = { params: Promise<{ agreementId: string }> };

/** MECGURA adds a document the client sent on WhatsApp or email. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).agreementId);
  const { kind, file } = await readUpload(req);
  return ok({ agreement: await adminUploadDocument(id, kind, file, admin.id, req) }, { status: 201 });
});
