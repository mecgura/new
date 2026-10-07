import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { requireOrgAccess } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { roleHasPermission } from "@/lib/authz";
import { isEncryptionConfigured } from "@/lib/crypto";
import { isDemoAvailable, isMetaConfigured, missingMetaConfig } from "@/providers/meta/config";
import { listAccounts, webhookCallbackUrl } from "@/services/whatsapp";
import { getUsageSummary } from "@/lib/services/usage";

type Ctx = { params: Promise<{ orgId: string }> };

/** Connection Center state: what's available, plan slots and the client's accounts. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:read", req);
  const [svc, usage, accounts] = await Promise.all([
    db.organizationService.findUnique({ where: { organizationId_service: { organizationId: orgId, service: "WHATSAPP_AUTOMATION" } } }),
    getUsageSummary(orgId),
    listAccounts(orgId),
  ]);
  return ok({
    serviceEnabled: Boolean(svc?.enabled),
    canManage: access.isPlatformAdmin || (access.role !== null && roleHasPermission(access.role, "whatsapp:manage")),
    meta: { configured: isMetaConfigured(), missing: missingMetaConfig() },
    encryptionReady: isEncryptionConfigured(),
    demoAvailable: isDemoAvailable(),
    webhookCallbackUrl: webhookCallbackUrl(),
    slots: usage.find((u) => u.key === "whatsapp_numbers") ?? null,
    accounts,
  });
});
