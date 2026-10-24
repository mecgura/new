import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { sendAgreement } from "@/services/agreements/agreements";

type Ctx = { params: Promise<{ agreementId: string }> };
const body = z.object({ whatsapp: z.boolean().default(true), email: z.boolean().default(true) });

/** Sends (or re-sends) the agreement link on WhatsApp and/or email. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).agreementId);
  return ok(await sendAgreement(id, await readJson(req, body), admin.id, req));
});
