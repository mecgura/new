import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { ensureAgreementTemplate } from "@/services/agreements/agreements";

/** Creates the agreement WhatsApp template on MECGURA's number and submits it to Meta. */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  return ok({ whatsapp: await ensureAgreementTemplate(admin, req) });
});
