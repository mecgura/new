import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

export type MetaResetResult = {
  whatsappAccounts: number;
  connections: number;
  webhooks: number;
  adConnections: number;
  channels: number;
  leadSources: number;
};

/**
 * Clears every saved Meta credential and link on the platform so nothing from an old (deleted) Meta app is left.
 * Kept on purpose: conversations, contacts, messages, campaigns, automations, templates and the numbers themselves.
 * Demo data is left alone. Numbers become "disconnected" and can be connected again with the new Meta app.
 */
export async function resetMetaConnections(actor: { userId: string; req?: Request }): Promise<MetaResetResult> {
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    const accounts = await tx.whatsAppAccount.updateMany({
      where: { isDemo: false, status: { not: "disconnected" } },
      data: { status: "disconnected", disconnectedAt: now },
    });
    const connections = await tx.whatsAppConnection.updateMany({
      where: { isDemo: false },
      data: {
        status: "disconnected",
        disconnectedAt: now,
        encryptedAccessToken: "",
        encryptedAppSecret: "",
        encryptedRegistrationPin: "",
        tokenLast4: "",
        stateHash: null,
        stateExpiresAt: null,
      },
    });
    const webhooks = await tx.webhookConfiguration.updateMany({
      where: { connection: { isDemo: false } },
      data: { status: "disabled", verifyTokenHash: "", encryptedVerifyToken: "", error: "" },
    });
    const adConnections = await tx.adConnection.deleteMany({});
    const channels = await tx.channelAccount.updateMany({
      where: { kind: { in: ["instagram", "messenger"] } },
      data: { encryptedToken: "", status: "disabled" },
    });
    const leadSources = await tx.leadSource.updateMany({
      data: { encryptedPageToken: "", tokenLast4: "", status: "paused" },
    });
    return {
      whatsappAccounts: accounts.count,
      connections: connections.count,
      webhooks: webhooks.count,
      adConnections: adConnections.count,
      channels: channels.count,
      leadSources: leadSources.count,
    };
  });
  await audit({ action: "admin.meta_reset", actorUserId: actor.userId, targetType: "platform", metadata: result, req: actor.req });
  return result;
}
