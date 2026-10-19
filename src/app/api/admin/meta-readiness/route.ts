import { handle, ok } from "@/lib/api";
import { isEncryptionConfigured } from "@/lib/crypto";
import { requireSuperAdmin } from "@/lib/session";
import { getMetaConfig, missingMetaConfig } from "@/providers/meta/config";
import { webhookCallbackUrl } from "@/services/whatsapp";

/** What MECGURA's own Meta app still needs before "Connect with Meta" works for clients. Names only, never values. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const missing = missingMetaConfig();
  return ok({
    embeddedSignupReady: missing.length === 0,
    missing,
    encryptionReady: isEncryptionConfigured(),
    graphVersion: getMetaConfig().graphVersion,
    callbackUrl: webhookCallbackUrl(),
  });
});
