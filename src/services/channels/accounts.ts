import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { isEmailConfigured } from "@/lib/mailer";
import { encryptSecret } from "@/lib/crypto";
import { MetaApiError } from "@/providers/meta/graph";
import { verifySocialAccount } from "@/providers/meta/social";

export const CHANNEL_KINDS = ["email", "webchat", "messenger", "instagram"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

type Row = Awaited<ReturnType<typeof db.channelAccount.findFirstOrThrow>>;

function parseSettings(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The inbound address a provider (or a mail forwarder) posts customer emails to. The key in the URL is the secret. */
export function inboundPath(kind: string, publicKey: string) {
  return kind === "email" ? `/api/webhooks/channels/${publicKey}` : "";
}

export function toChannelDto(a: Row, conversations = 0) {
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    address: a.address,
    status: a.status,
    settings: parseSettings(a.settings),
    inboundPath: inboundPath(a.kind, a.publicKey),
    publicKey: a.kind === "webchat" ? a.publicKey : undefined,
    embedPath: a.kind === "webchat" ? "/widget.js" : undefined,
    conversations,
    createdAt: a.createdAt,
  };
}

export async function listChannels(organizationId: string) {
  const rows = await db.channelAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, include: { _count: { select: { conversations: true } } } });
  return {
    channels: rows.map((r) => toChannelDto(r, r._count.conversations)),
    emailSending: isEmailConfigured() ? "ready" : "not_configured",
  };
}

export async function createChannel(access: OrgAccess, input: { kind: ChannelKind; name: string; address: string; accessToken?: string }, req?: Request) {
  const orgId = access.organizationId;
  if (input.kind === "email" && !input.address) throw new ApiError("VALIDATION_ERROR", "Enter the email address customers write to.", { details: { address: ["Required"] } });
  if (await db.channelAccount.count({ where: { organizationId: orgId } }) >= 20) throw new ApiError("CONFLICT", "You can connect up to 20 inboxes.");
  const social = input.kind === "messenger" || input.kind === "instagram";
  let encryptedToken = "";
  if (social) {
    if (await db.channelAccount.findFirst({ where: { kind: input.kind, address: input.address } })) throw new ApiError("CONFLICT", "That account is already connected to a workspace.");
    try {
      await verifySocialAccount(input.kind as "messenger" | "instagram", input.address, input.accessToken ?? "");
    } catch (e) {
      throw new ApiError("VALIDATION_ERROR", e instanceof MetaApiError ? `Meta rejected the token: ${e.message}` : "That ID and access token don't match.", { details: { accessToken: ["Could not be verified with Meta"] } });
    }
    encryptedToken = encryptSecret(input.accessToken ?? "");
  }
  const a = await db.channelAccount.create({
    data: { organizationId: orgId, kind: input.kind, name: input.name, address: input.kind === "email" ? input.address.toLowerCase() : social ? input.address : "", encryptedToken, publicKey: randomBytes(24).toString("hex"), status: input.kind === "email" ? "demo" : "active", settings: input.kind === "webchat" ? JSON.stringify({ greeting: "Hi! How can we help you?", color: "#0f766e" }) : "{}" },
  });
  await audit({ action: "channel.connected", actorUserId: access.user.id, organizationId: orgId, targetType: "channel", targetId: a.id, metadata: { kind: input.kind }, req });
  return toChannelDto(a);
}

export async function updateChannel(access: OrgAccess, id: string, input: { name?: string; status?: "demo" | "active" | "disabled"; settings?: Record<string, string> }) {
  const a = await db.channelAccount.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!a) throw new ApiError("NOT_FOUND", "Inbox not found.");
  if (input.status === "active" && a.kind === "email" && !isEmailConfigured()) {
    throw new ApiError("CONFLICT", "Email sending isn't configured on the platform yet (Resend key and sender domain). The inbox stays in demo mode until then.");
  }
  const next = await db.channelAccount.update({
    where: { id },
    data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.status ? { status: input.status } : {}), ...(input.settings ? { settings: JSON.stringify(input.settings) } : {}) },
  });
  return toChannelDto(next);
}

export async function deleteChannel(access: OrgAccess, id: string, req?: Request) {
  const r = await db.channelAccount.deleteMany({ where: { id, organizationId: access.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Inbox not found.");
  await audit({ action: "channel.removed", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "channel", targetId: id, req });
}
