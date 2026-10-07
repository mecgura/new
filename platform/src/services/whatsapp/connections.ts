import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { decryptSecret, encryptSecret, isEncryptionConfigured, last4, randomToken, sha256 } from "@/lib/crypto";
import { siteConfig } from "@/config/site";
import { isDemoAvailable, isMetaConfigured, publicMetaConfig } from "@/providers/meta/config";
import { MetaApiError } from "@/providers/meta/graph";
import {
  exchangeCodeForToken,
  getPhoneNumber,
  getWaba,
  listPhoneNumbers,
  subscribeAppToWaba,
  toE164,
  unsubscribeAppFromWaba,
  type MetaPhoneNumber,
  type MetaWaba,
} from "@/providers/meta/api";
import { demoIds } from "@/providers/meta/demo";
import { assertNumberSlot, assertWhatsAppEnabled } from "@/services/whatsapp/guards";

export type ActorCtx = { organizationId: string; actorUserId: string; req?: Request };

const STATE_TTL_MS = 15 * 60_000;
export const WEBHOOK_PATH = "/api/webhooks/meta";
export const WEBHOOK_FIELDS = ["messages", "message_template_status_update", "phone_number_quality_update", "account_update"];

export function webhookCallbackUrl() {
  return `${siteConfig.url.replace(/\/$/, "")}${WEBHOOK_PATH}`;
}

/** Turns Graph API failures into user-safe API errors. */
function metaFailure(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof MetaApiError) {
    return e.status === 0
      ? new ApiError("SERVICE_UNAVAILABLE", e.message)
      : new ApiError("VALIDATION_ERROR", `Meta couldn't verify this connection: ${e.message}`);
  }
  console.error("[whatsapp] unexpected connection error", e);
  return new ApiError("SERVER_ERROR");
}

// ---------------------------------------------------------------------------
// Persistence shared by every connection method
// ---------------------------------------------------------------------------

type PersistInput = {
  method: "embedded_signup" | "coexistence" | "manual" | "demo";
  isDemo: boolean;
  existingConnectionId?: string;
  waba: { wabaId: string; name: string; currency: string; timezoneId: string; businessPortfolioId: string };
  phone: {
    phoneNumberId: string;
    display: string;
    e164: string;
    verifiedName: string;
    qualityRating: string;
    messagingLimitTier: string;
    codeVerificationStatus: string;
    nameStatus: string;
    platformType: string;
    status: string;
  };
  accessToken?: string;
  appSecret?: string;
  /** "platform" = MECGURA's Meta app; "own_app" = client's app (needs its own verify token); "none" = demo. */
  webhookMode: "platform" | "own_app" | "none";
  appSubscribed: boolean;
};

async function persistConnection(ctx: ActorCtx, input: PersistInput) {
  const orgId = ctx.organizationId;
  // Cross-tenant conflicts: a WABA / number can belong to exactly one client.
  const [wabaOwner, phoneOwner, numberOwner] = await Promise.all([
    db.whatsAppBusinessAccount.findUnique({ where: { wabaId: input.waba.wabaId }, select: { organizationId: true } }),
    db.phoneNumber.findUnique({ where: { phoneNumberId: input.phone.phoneNumberId }, select: { organizationId: true } }),
    db.whatsAppAccount.findUnique({ where: { phoneNumber: input.phone.e164 }, select: { organizationId: true } }),
  ]);
  if ([wabaOwner, phoneOwner, numberOwner].some((o) => o && o.organizationId !== orgId)) {
    throw new ApiError("CONFLICT", "This WhatsApp number or business account is already connected to another MECGURA workspace.");
  }
  await assertNumberSlot(orgId, input.phone.e164);

  const now = new Date();
  const verifyToken = input.webhookMode === "own_app" ? randomToken(24) : null;
  const encToken = input.accessToken ? encryptSecret(input.accessToken) : "";
  const encSecret = input.appSecret ? encryptSecret(input.appSecret) : "";
  const encVerify = verifyToken ? encryptSecret(verifyToken) : "";

  const account = await db.$transaction(async (tx) => {
    const waba = await tx.whatsAppBusinessAccount.upsert({
      where: { wabaId: input.waba.wabaId },
      update: { name: input.waba.name, currency: input.waba.currency, timezoneId: input.waba.timezoneId, businessPortfolioId: input.waba.businessPortfolioId },
      create: { organizationId: orgId, isDemo: input.isDemo, ...input.waba },
    });
    const connData = {
      status: "active",
      wabaRecordId: waba.id,
      encryptedAccessToken: encToken,
      tokenLast4: input.accessToken ? last4(input.accessToken) : "",
      encryptedAppSecret: encSecret,
      tokenObtainedAt: input.accessToken ? now : null,
      connectedAt: now,
      error: "",
      stateHash: null,
      stateExpiresAt: null,
    };
    const connection = input.existingConnectionId
      ? await tx.whatsAppConnection.update({ where: { id: input.existingConnectionId }, data: connData })
      : await tx.whatsAppConnection.create({ data: { organizationId: orgId, method: input.method, isDemo: input.isDemo, createdById: ctx.actorUserId, ...connData } });

    const { phoneNumberId, display, e164, ...meta } = input.phone;
    const phone = await tx.phoneNumber.upsert({
      where: { phoneNumberId },
      update: { ...meta, displayPhoneNumber: display, e164, wabaRecordId: waba.id, lastSyncedAt: now },
      create: { organizationId: orgId, wabaRecordId: waba.id, phoneNumberId, displayPhoneNumber: display, e164, isDemo: input.isDemo, lastSyncedAt: now, ...meta },
    });

    const existing = await tx.whatsAppAccount.findFirst({ where: { organizationId: orgId, OR: [{ phoneNumber: e164 }, { phoneRecordId: phone.id }] } });
    const accountData = {
      businessName: input.waba.name || input.phone.verifiedName,
      phoneNumber: e164,
      status: input.isDemo ? "demo" : "connected",
      wabaId: input.waba.wabaId,
      phoneNumberId,
      isDemo: input.isDemo,
      wabaRecordId: waba.id,
      phoneRecordId: phone.id,
      connectionId: connection.id,
      connectedAt: now,
      disconnectedAt: null,
    };
    const account = existing
      ? await tx.whatsAppAccount.update({ where: { id: existing.id }, data: accountData })
      : await tx.whatsAppAccount.create({ data: { organizationId: orgId, displayName: input.phone.verifiedName || input.waba.name || "WhatsApp", ...accountData } });

    if (input.webhookMode !== "none") {
      await tx.webhookConfiguration.create({
        data: {
          organizationId: orgId,
          connectionId: connection.id,
          wabaRecordId: waba.id,
          callbackUrl: webhookCallbackUrl(),
          verifyTokenHash: verifyToken ? sha256(verifyToken) : "",
          encryptedVerifyToken: encVerify,
          subscribedFields: JSON.stringify(WEBHOOK_FIELDS),
          status: input.webhookMode === "platform" ? (input.appSubscribed ? "subscribed" : "failed") : "pending",
          error: input.webhookMode === "platform" && !input.appSubscribed ? "Meta didn't confirm the webhook subscription" : "",
        },
      });
    }
    return account;
  });

  await audit({
    action: "whatsapp.connected",
    actorUserId: ctx.actorUserId,
    organizationId: orgId,
    targetType: "whatsapp_account",
    targetId: account.id,
    metadata: { method: input.method, isDemo: input.isDemo, phoneNumber: input.phone.e164, wabaId: input.waba.wabaId },
    req: ctx.req,
  });
  const owners = await db.organizationMember.findMany({ where: { organizationId: orgId, role: "CLIENT_OWNER" }, select: { userId: true } });
  for (const o of owners) {
    await notify({
      userId: o.userId,
      organizationId: orgId,
      type: "success",
      title: input.isDemo ? "Demo WhatsApp number added" : `WhatsApp number ${input.phone.display} connected`,
      link: `/whatsapp/accounts/${account.id}`,
    });
  }
  return account;
}

function fromMeta(waba: MetaWaba, phone: MetaPhoneNumber) {
  return {
    waba: {
      wabaId: waba.id,
      name: waba.name ?? "",
      currency: waba.currency ?? "",
      timezoneId: waba.timezone_id ?? "",
      businessPortfolioId: waba.owner_business_info?.id ?? "",
    },
    phone: {
      phoneNumberId: phone.id,
      display: phone.display_phone_number,
      e164: toE164(phone.display_phone_number),
      verifiedName: phone.verified_name ?? "",
      qualityRating: phone.quality_rating ?? "UNKNOWN",
      messagingLimitTier: phone.messaging_limit_tier ?? "",
      codeVerificationStatus: phone.code_verification_status ?? "",
      nameStatus: phone.name_status ?? "",
      platformType: phone.platform_type ?? "",
      status: phone.status ?? "",
    },
  };
}

/** Fetches + cross-checks WABA and phone with the given token (phone must belong to the WABA). */
async function fetchFromMeta(wabaId: string, phoneNumberId: string, token: string) {
  const [waba, phone, numbers] = await Promise.all([getWaba(wabaId, token), getPhoneNumber(phoneNumberId, token), listPhoneNumbers(wabaId, token)]);
  if (!numbers.some((n) => n.id === phoneNumberId)) {
    throw new ApiError("VALIDATION_ERROR", "That Phone Number ID doesn't belong to this WhatsApp Business Account.", { details: { phoneNumberId: ["Not part of this WABA"] } });
  }
  return fromMeta(waba, phone);
}

// ---------------------------------------------------------------------------
// 1. Meta Embedded Signup (and coexistence, which is the same flow + feature type)
// ---------------------------------------------------------------------------

export async function startEmbeddedSignup(ctx: ActorCtx, method: "embedded_signup" | "coexistence") {
  if (!isMetaConfigured()) {
    throw new ApiError("SERVICE_UNAVAILABLE", "Meta onboarding isn't configured on MECGURA yet. Use the demo or developer setup, or contact MECGURA.");
  }
  if (!isEncryptionConfigured()) throw new ApiError("SERVICE_UNAVAILABLE", "Secure credential storage is not configured on this server yet.");
  await assertWhatsAppEnabled(ctx.organizationId);
  await assertNumberSlot(ctx.organizationId);
  const state = randomToken(32);
  const connection = await db.whatsAppConnection.create({
    data: {
      organizationId: ctx.organizationId,
      method,
      status: "pending",
      stateHash: sha256(state),
      stateExpiresAt: new Date(Date.now() + STATE_TTL_MS),
      createdById: ctx.actorUserId,
    },
  });
  await audit({ action: "whatsapp.connect_started", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "whatsapp_connection", targetId: connection.id, metadata: { method }, req: ctx.req });
  return {
    state,
    meta: publicMetaConfig(),
    // Meta Embedded Signup "featureType": empty for a new number; coexistence onboarding for WhatsApp Business app numbers.
    featureType: method === "coexistence" ? "whatsapp_business_app_onboarding" : "",
  };
}

/** Atomically claims a pending state for this org (single use, unexpired). */
async function claimState(organizationId: string, state: string) {
  const conn = await db.whatsAppConnection.findUnique({ where: { stateHash: sha256(state) } });
  const invalid = new ApiError("VALIDATION_ERROR", "This connection session is invalid or has expired. Please start again.");
  if (!conn || conn.organizationId !== organizationId || conn.status !== "pending" || !conn.stateExpiresAt || conn.stateExpiresAt < new Date()) throw invalid;
  const claimed = await db.whatsAppConnection.updateMany({ where: { id: conn.id, status: "pending", stateHash: conn.stateHash }, data: { stateHash: null } });
  if (claimed.count !== 1) throw invalid;
  return conn;
}

export async function completeEmbeddedSignup(ctx: ActorCtx, input: { state: string; code: string; wabaId: string; phoneNumberId: string }) {
  const conn = await claimState(ctx.organizationId, input.state);
  try {
    await assertWhatsAppEnabled(ctx.organizationId);
    const { accessToken } = await exchangeCodeForToken(input.code);
    const details = await fetchFromMeta(input.wabaId, input.phoneNumberId, accessToken);
    const appSubscribed = await subscribeAppToWaba(input.wabaId, accessToken).catch(() => false);
    return await persistConnection(ctx, {
      method: conn.method as "embedded_signup" | "coexistence",
      isDemo: false,
      existingConnectionId: conn.id,
      ...details,
      accessToken,
      webhookMode: "platform",
      appSubscribed,
    });
  } catch (e) {
    const err = metaFailure(e);
    await db.whatsAppConnection.update({ where: { id: conn.id }, data: { status: "failed", error: err.message.slice(0, 500) } });
    await audit({ action: "whatsapp.connect_failed", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "whatsapp_connection", targetId: conn.id, metadata: { method: conn.method, reason: err.message }, req: ctx.req });
    throw err;
  }
}

export async function cancelEmbeddedSignup(ctx: ActorCtx, state: string, reason: string) {
  const conn = await claimState(ctx.organizationId, state);
  await db.whatsAppConnection.update({ where: { id: conn.id }, data: { status: "cancelled", error: reason.slice(0, 300) } });
  await audit({ action: "whatsapp.connect_failed", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "whatsapp_connection", targetId: conn.id, metadata: { method: conn.method, reason: reason || "cancelled" }, req: ctx.req });
}

// ---------------------------------------------------------------------------
// 2. API / developer setup (client's own Meta app + system user token)
// ---------------------------------------------------------------------------

export async function connectManual(ctx: ActorCtx, input: { wabaId: string; phoneNumberId: string; accessToken: string; appSecret?: string }) {
  if (!isEncryptionConfigured()) throw new ApiError("SERVICE_UNAVAILABLE", "Secure credential storage is not configured on this server yet.");
  await assertWhatsAppEnabled(ctx.organizationId);
  let details;
  let appSubscribed = false;
  try {
    details = await fetchFromMeta(input.wabaId, input.phoneNumberId, input.accessToken);
    appSubscribed = await subscribeAppToWaba(input.wabaId, input.accessToken).catch(() => false);
  } catch (e) {
    const err = metaFailure(e);
    await audit({ action: "whatsapp.connect_failed", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "whatsapp_connection", metadata: { method: "manual", wabaId: input.wabaId, reason: err.message }, req: ctx.req });
    throw err;
  }
  return persistConnection(ctx, {
    method: "manual",
    isDemo: false,
    ...details,
    accessToken: input.accessToken,
    appSecret: input.appSecret || undefined,
    webhookMode: "own_app",
    appSubscribed,
  });
}

// ---------------------------------------------------------------------------
// 3. Demo (no Meta involved; clearly labelled everywhere)
// ---------------------------------------------------------------------------

export async function connectDemo(ctx: ActorCtx, input: { businessName: string }) {
  if (!isDemoAvailable()) throw new ApiError("FORBIDDEN", "Demo connections are disabled on this installation.");
  await assertWhatsAppEnabled(ctx.organizationId);
  let ids = demoIds();
  for (let i = 0; i < 5 && (await db.whatsAppAccount.findUnique({ where: { phoneNumber: ids.e164 } })); i++) ids = demoIds();
  return persistConnection(ctx, {
    method: "demo",
    isDemo: true,
    waba: { wabaId: ids.wabaId, name: input.businessName, currency: "INR", timezoneId: "", businessPortfolioId: ids.businessPortfolioId },
    phone: {
      phoneNumberId: ids.phoneNumberId,
      display: ids.display,
      e164: ids.e164,
      verifiedName: input.businessName,
      qualityRating: "UNKNOWN",
      messagingLimitTier: "",
      codeVerificationStatus: "",
      nameStatus: "",
      platformType: "DEMO",
      status: "DEMO",
    },
    webhookMode: "none",
    appSubscribed: false,
  });
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const accountInclude = {
  phone: true,
  waba: { select: { wabaId: true, name: true, isDemo: true } },
  connection: { select: { id: true, method: true, status: true, tokenLast4: true, connectedAt: true, isDemo: true, webhook: { select: { status: true, lastEventAt: true, lastVerifiedAt: true } } } },
} as const;

type AccountRow = Awaited<ReturnType<typeof loadAccounts>>[number];

function loadAccounts(organizationId: string, id?: string) {
  return db.whatsAppAccount.findMany({
    where: { organizationId, ...(id ? { id } : {}), status: { not: "disabled" } },
    orderBy: { createdAt: "asc" },
    include: accountInclude,
  });
}

/** Browser-safe projection — no secrets, ever. */
function toDto(a: AccountRow) {
  return {
    id: a.id,
    displayName: a.displayName,
    businessName: a.businessName || a.waba?.name || a.phone?.verifiedName || "",
    phoneNumber: a.phone?.displayPhoneNumber || a.phoneNumber,
    e164: a.phoneNumber,
    wabaId: a.waba?.wabaId ?? (a.wabaId || null),
    phoneNumberId: a.phoneNumberId || null,
    status: a.status,
    isDemo: a.isDemo,
    quality: a.phone?.qualityRating ?? "UNKNOWN",
    messagingLimitTier: a.phone?.messagingLimitTier ?? "",
    verifiedName: a.phone?.verifiedName ?? "",
    codeVerificationStatus: a.phone?.codeVerificationStatus ?? "",
    messagesSent: a.phone?.messagesSent ?? 0,
    messagesReceived: a.phone?.messagesReceived ?? 0,
    connectedAt: a.connectedAt,
    disconnectedAt: a.disconnectedAt,
    createdAt: a.createdAt,
    connection: a.connection
      ? {
          method: a.connection.method,
          status: a.connection.status,
          credentialStored: Boolean(a.connection.tokenLast4),
          tokenHint: a.connection.tokenLast4 ? `••••${a.connection.tokenLast4}` : null,
          webhookStatus: a.connection.webhook?.status ?? null,
          webhookLastEventAt: a.connection.webhook?.lastEventAt ?? null,
        }
      : null,
  };
}

export type WhatsAppAccountDto = ReturnType<typeof toDto>;

export async function listAccounts(organizationId: string) {
  return (await loadAccounts(organizationId)).map(toDto);
}

export async function getAccount(organizationId: string, accountId: string) {
  const [row] = await loadAccounts(organizationId, accountId);
  if (!row) throw new ApiError("NOT_FOUND", "WhatsApp account not found.");
  return toDto(row);
}

export async function updateAccountSettings(ctx: ActorCtx, accountId: string, input: { displayName: string }) {
  const acc = await db.whatsAppAccount.findFirst({ where: { id: accountId, organizationId: ctx.organizationId } });
  if (!acc) throw new ApiError("NOT_FOUND", "WhatsApp account not found.");
  await db.whatsAppAccount.update({ where: { id: acc.id }, data: { displayName: input.displayName } });
  await audit({ action: "whatsapp.settings_changed", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "whatsapp_account", targetId: acc.id, metadata: { fields: ["displayName"] }, req: ctx.req });
  return getAccount(ctx.organizationId, acc.id);
}

/**
 * Disconnect: best-effort webhook unsubscribe at Meta, then credentials are
 * wiped (not just flagged) and the number frees its plan slot. History stays.
 */
export async function disconnectAccount(ctx: ActorCtx, accountId: string) {
  const acc = await db.whatsAppAccount.findFirst({
    where: { id: accountId, organizationId: ctx.organizationId },
    include: { connection: true, waba: true },
  });
  if (!acc) throw new ApiError("NOT_FOUND", "WhatsApp account not found.");
  if (acc.status === "disconnected") return getAccount(ctx.organizationId, acc.id);

  let metaUnsubscribed: boolean | null = null;
  if (acc.connection?.encryptedAccessToken && acc.waba && !acc.isDemo) {
    try {
      metaUnsubscribed = await unsubscribeAppFromWaba(acc.waba.wabaId, decryptSecret(acc.connection.encryptedAccessToken));
    } catch {
      metaUnsubscribed = false;
    }
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.whatsAppAccount.update({ where: { id: acc.id }, data: { status: "disconnected", disconnectedAt: now } });
    if (acc.connectionId) {
      await tx.whatsAppConnection.update({
        where: { id: acc.connectionId },
        data: { status: "disconnected", disconnectedAt: now, encryptedAccessToken: "", encryptedAppSecret: "", tokenLast4: "" },
      });
      await tx.webhookConfiguration.updateMany({ where: { connectionId: acc.connectionId }, data: { status: "disabled", verifyTokenHash: "", encryptedVerifyToken: "" } });
    }
  });
  await audit({ action: "whatsapp.disconnected", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "whatsapp_account", targetId: acc.id, metadata: { phoneNumber: acc.phoneNumber, isDemo: acc.isDemo, metaUnsubscribed }, req: ctx.req });
  return getAccount(ctx.organizationId, acc.id);
}

/** Webhook setup details for one account (owners only — includes the verify token for developer setups). */
export async function getWebhookInfo(organizationId: string, accountId: string) {
  const acc = await db.whatsAppAccount.findFirst({ where: { id: accountId, organizationId }, include: { connection: { include: { webhook: true } } } });
  if (!acc) throw new ApiError("NOT_FOUND", "WhatsApp account not found.");
  const wh = acc.connection?.webhook;
  return {
    callbackUrl: wh?.callbackUrl ?? webhookCallbackUrl(),
    mode: acc.isDemo ? "demo" : acc.connection?.method === "manual" ? "own_app" : "platform",
    verifyToken: wh?.encryptedVerifyToken ? decryptSecret(wh.encryptedVerifyToken) : null,
    fields: wh ? (JSON.parse(wh.subscribedFields) as string[]) : WEBHOOK_FIELDS,
    status: wh?.status ?? (acc.isDemo ? "disabled" : "pending"),
    lastVerifiedAt: wh?.lastVerifiedAt ?? null,
    lastEventAt: wh?.lastEventAt ?? null,
    signatureSecretStored: Boolean(acc.connection?.encryptedAppSecret),
  };
}
