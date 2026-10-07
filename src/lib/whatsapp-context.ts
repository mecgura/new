import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getAppContext } from "@/lib/app-context";
import { roleHasPermission } from "@/lib/authz";
import { isEncryptionConfigured } from "@/lib/crypto";
import { getUsageSummary } from "@/lib/services/usage";
import { isDemoAvailable, isMetaConfigured, missingMetaConfig } from "@/providers/meta/config";
import { webhookCallbackUrl } from "@/services/whatsapp";

/** Server context for the client WhatsApp pages (re-validates tenant + role from the DB). */
export async function getWhatsAppContext() {
  const { user, active } = await getAppContext();
  if (!active) {
    if (user.platformRole === "SUPER_ADMIN") redirect("/admin/whatsapp");
    return { user, active: null } as const;
  }
  if (!roleHasPermission(active.role, "whatsapp:read")) redirect("/dashboard");
  const orgId = active.organizationId;
  const [svc, usage] = await Promise.all([
    db.organizationService.findUnique({ where: { organizationId_service: { organizationId: orgId, service: "WHATSAPP_AUTOMATION" } } }),
    getUsageSummary(orgId),
  ]);
  return {
    user,
    active,
    orgId,
    canManage: roleHasPermission(active.role, "whatsapp:manage"),
    serviceEnabled: Boolean(svc?.enabled),
    metaConfigured: isMetaConfigured(),
    missingMeta: missingMetaConfig(),
    demoAvailable: isDemoAvailable(),
    encryptionReady: isEncryptionConfigured(),
    callbackUrl: webhookCallbackUrl(),
    slots: usage.find((u) => u.key === "whatsapp_numbers") ?? { key: "whatsapp_numbers", label: "WhatsApp numbers", used: 0, limit: null },
  } as const;
}
