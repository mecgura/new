import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret, isEncryptionConfigured, sha256 } from "@/lib/crypto";
import type { OrgAccess } from "@/lib/session";
import { requireOrgAccess, requireUser } from "@/lib/session";
import { PublishError, type ConnectionProvider } from "@/lib/onepost-publish";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { socialAccounts } from "@/services/social/posts";
import { blobConfigured } from "@/services/onepost/storage";
import { syncPostState } from "@/services/onepost/state";
import { MISSING_ENV, oauthConfig, oauthConfigured } from "@/providers/onepost/config";
import { linkedinAuthUrl, linkedinExchange, linkedinOrganizations, linkedinProfile, linkedinRefresh } from "@/providers/onepost/linkedin";
import { googleAuthUrl, googleExchange, googleLocations, googleRefresh } from "@/providers/onepost/google-business";
import { normaliseSite, wpVerify } from "@/providers/onepost/wordpress";

const STATE_MINUTES = 10;

type Row = Awaited<ReturnType<typeof db.onePostConnection.findFirstOrThrow>>;
const parse = <T,>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const toDto = (c: Row) => {
  const settings = parse<{ wpStatus?: "publish" | "draft"; username?: string }>(c.settings, {});
  return {
    id: c.id,
    provider: c.provider as ConnectionProvider,
    name: c.externalName || (c.provider === "wordpress" ? c.externalId : ""),
    status: c.status as "active" | "needs_target" | "expired",
    expiresAt: c.expiresAt,
    pages: c.provider === "linkedin" && c.scopes.split(/[\s,]+/).includes("w_organization_social"),
    wpStatus: settings.wpStatus ?? "publish",
    username: settings.username ?? "",
    createdAt: c.createdAt,
  };
};
export type ConnectionDto = ReturnType<typeof toDto>;

export async function listConnections(a: OrgAccess) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const rows = await db.onePostConnection.findMany({ where: { organizationId: a.organizationId }, orderBy: { createdAt: "asc" } });
  return {
    connections: rows.map(toDto),
    // Facebook and Instagram are the accounts already connected in Channels (the Social Media module uses the same ones).
    channels: await socialAccounts(a.organizationId),
    configured: { linkedin: oauthConfigured("linkedin"), gbp: oauthConfigured("gbp") },
    missingEnv: { linkedin: MISSING_ENV.linkedin, gbp: MISSING_ENV.gbp },
    storage: blobConfigured(),
  };
}

// ---------------------------------------------------------------------------
// OAuth (LinkedIn, Google Business Profile)
// ---------------------------------------------------------------------------

export async function startOAuth(a: OrgAccess, provider: "linkedin" | "gbp") {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  if (!isEncryptionConfigured()) throw new ApiError("SERVICE_UNAVAILABLE", "Secure credential storage isn't configured on this server yet.");
  if (!oauthConfigured(provider)) throw new ApiError("SERVICE_UNAVAILABLE", `${provider === "linkedin" ? "LinkedIn" : "Google"} sign-in isn't set up on this server yet. MECGURA needs to add ${MISSING_ENV[provider]}.`);
  const state = randomBytes(32).toString("base64url");
  await db.onePostOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.onePostOAuthState.create({ data: { stateHash: sha256(state), organizationId: a.organizationId, userId: a.user.id, provider, expiresAt: new Date(Date.now() + STATE_MINUTES * 60_000) } });
  return { url: provider === "linkedin" ? linkedinAuthUrl(state) : googleAuthUrl(state) };
}

/** The sign-in came back from the provider. Returns where to send the person next (never throws for provider-side refusals). */
export async function completeOAuth(provider: "linkedin" | "gbp", params: { code?: string | null; state?: string | null; error?: string | null }, req?: Request): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  if (params.error) return { ok: false, message: params.error === "access_denied" || params.error === "user_cancelled_authorize" ? "You cancelled the connection." : `The provider refused the connection (${params.error.slice(0, 60)}).` };
  if (!params.code || !params.state) return { ok: false, message: "The sign-in was incomplete. Please try again." };
  const row = await db.onePostOAuthState.findUnique({ where: { stateHash: sha256(params.state) } });
  // One use only, and only for the person and provider that started it.
  if (row) await db.onePostOAuthState.delete({ where: { id: row.id } }).catch(() => null);
  if (!row || row.expiresAt < new Date() || row.userId !== user.id || row.provider !== provider) return { ok: false, message: "This sign-in link expired or isn't yours. Please start again." };
  const access = await requireOrgAccess(row.organizationId, "onepost:connect", req);
  await assertServiceEnabled(access.organizationId, "ONEPOST");
  try {
    if (provider === "linkedin") {
      const t = await linkedinExchange(params.code);
      const me = await linkedinProfile(t.accessToken);
      await upsertConnection(access, "linkedin", { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresIn: t.expiresIn, scopes: t.scope, externalId: me.urn, externalName: `${me.name} (personal profile)`, status: "active" }, req);
    } else {
      const t = await googleExchange(params.code);
      await upsertConnection(access, "gbp", { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresIn: t.expiresIn, scopes: t.scope || oauthConfig("gbp").scopes.join(" "), externalId: "", externalName: "", status: "needs_target" }, req);
    }
  } catch (e) {
    return { ok: false, message: e instanceof PublishError ? e.message : "Could not finish connecting. Please try again." };
  }
  return { ok: true, message: provider === "gbp" ? "Google connected. Now choose the business location." : "LinkedIn connected." };
}

async function upsertConnection(a: OrgAccess, provider: ConnectionProvider, v: { accessToken: string; refreshToken: string; expiresIn: number; scopes: string; externalId: string; externalName: string; status: string; settings?: object }, req?: Request) {
  const data = {
    status: v.status,
    encryptedAccess: encryptSecret(v.accessToken),
    encryptedRefresh: v.refreshToken ? encryptSecret(v.refreshToken) : "",
    expiresAt: v.expiresIn ? new Date(Date.now() + v.expiresIn * 1000) : null,
    scopes: v.scopes,
    externalId: v.externalId,
    externalName: v.externalName,
    connectedById: a.user.id,
    ...(v.settings ? { settings: JSON.stringify(v.settings) } : {}),
  };
  // One connection per provider and workspace (WordPress: one per site).
  const existing = await db.onePostConnection.findFirst({ where: { organizationId: a.organizationId, provider, ...(provider === "wordpress" ? { externalId: v.externalId } : {}) } });
  const row = existing ? await db.onePostConnection.update({ where: { id: existing.id }, data }) : await db.onePostConnection.create({ data: { organizationId: a.organizationId, provider, ...data } });
  await audit({ action: "onepost.connection_added", actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost_connection", targetId: row.id, metadata: { provider }, req });
  return row;
}

// ---------------------------------------------------------------------------
// Choosing where to post
// ---------------------------------------------------------------------------

async function loadConnection(a: OrgAccess, id: string) {
  const c = await db.onePostConnection.findFirst({ where: { id, organizationId: a.organizationId } });
  if (!c) throw new ApiError("NOT_FOUND", "Connection not found.");
  return c;
}

/** A usable access token, renewed first when it is about to expire. */
export async function accessTokenFor(c: Row): Promise<string> {
  if (c.provider === "wordpress") throw new PublishError("WordPress uses a login, not a token.", false);
  const stillGood = c.expiresAt && c.expiresAt.getTime() - Date.now() > 5 * 60_000;
  if (stillGood || (!c.expiresAt && c.encryptedAccess)) return decryptSecret(c.encryptedAccess);
  if (c.encryptedRefresh) {
    const t = c.provider === "linkedin" ? await linkedinRefresh(decryptSecret(c.encryptedRefresh)) : await googleRefresh(decryptSecret(c.encryptedRefresh));
    await db.onePostConnection.update({ where: { id: c.id }, data: { encryptedAccess: encryptSecret(t.accessToken), expiresAt: new Date(Date.now() + t.expiresIn * 1000), ...(t.refreshToken && t.refreshToken !== decryptSecret(c.encryptedRefresh) ? { encryptedRefresh: encryptSecret(t.refreshToken) } : {}) } });
    return t.accessToken;
  }
  await db.onePostConnection.update({ where: { id: c.id }, data: { status: "expired" } });
  throw new PublishError(`The ${c.provider === "linkedin" ? "LinkedIn" : "Google"} connection has expired. Reconnect it in OnePost → Connections.`, false, true);
}

export async function listTargets(a: OrgAccess, id: string) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const c = await loadConnection(a, id);
  if (c.provider === "wordpress") return { targets: [{ id: c.externalId, name: c.externalName || c.externalId }] };
  try {
    const token = await accessTokenFor(c);
    if (c.provider === "gbp") return { targets: (await googleLocations(token)).map((t) => ({ id: t.id, name: t.name })) };
    const personUrn = c.externalId.startsWith("urn:li:person:") ? c.externalId : (await linkedinProfile(token)).urn;
    const orgs = c.scopes.split(/[\s,]+/).includes("w_organization_social") ? await linkedinOrganizations(token) : [];
    return { targets: [{ id: personUrn, name: "Your personal profile" }, ...orgs.map((o) => ({ id: o.urn, name: o.name }))] };
  } catch (e) {
    if (e instanceof PublishError) throw new ApiError(e.reconnect ? "CONFLICT" : "SERVICE_UNAVAILABLE", e.message);
    throw e;
  }
}

export const selectTargetSchema = z.object({ targetId: z.string().trim().min(1).max(200), targetName: z.string().trim().max(200).default("") });

export async function selectTarget(a: OrgAccess, id: string, input: z.infer<typeof selectTargetSchema>, req?: Request) {
  const c = await loadConnection(a, id);
  const { targets } = await listTargets(a, id);
  const t = targets.find((x) => x.id === input.targetId);
  if (!t) throw new ApiError("VALIDATION_ERROR", "Choose one of the accounts in the list.");
  await db.onePostConnection.update({ where: { id: c.id }, data: { externalId: t.id, externalName: t.name, status: "active" } });
  await audit({ action: "onepost.connection_added", actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost_connection", targetId: c.id, metadata: { provider: c.provider, target: t.name }, req });
  return toDto(await loadConnection(a, id));
}

// ---------------------------------------------------------------------------
// WordPress (self-hosted: site address + Application Password, WordPress's own way for apps to publish)
// ---------------------------------------------------------------------------

export const wordpressSchema = z.object({
  site: z.string().trim().min(3).max(200),
  username: z.string().trim().min(1).max(120),
  appPassword: z.string().trim().min(8).max(200),
  status: z.enum(["publish", "draft"]).default("publish"),
});

export async function connectWordPress(a: OrgAccess, input: z.infer<typeof wordpressSchema>, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  if (!isEncryptionConfigured()) throw new ApiError("SERVICE_UNAVAILABLE", "Secure credential storage isn't configured on this server yet.");
  let site: string;
  try {
    site = normaliseSite(input.site);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Enter your website address, for example myblog.com.", { details: { site: ["Invalid address"] } });
  }
  try {
    const v = await wpVerify(site, input.username, input.appPassword);
    const row = await upsertConnection(a, "wordpress", { accessToken: `${input.username}:${input.appPassword}`, refreshToken: "", expiresIn: 0, scopes: "", externalId: site, externalName: v.siteName, status: "active", settings: { wpStatus: input.status, username: input.username } }, req);
    return toDto(row);
  } catch (e) {
    if (e instanceof PublishError) throw new ApiError("VALIDATION_ERROR", `${e.message} Check the site address, username and Application Password.`);
    throw e;
  }
}

export const connectionSettingsSchema = z.object({ wpStatus: z.enum(["publish", "draft"]) });
export async function updateWordPressStatus(a: OrgAccess, id: string, wpStatus: "publish" | "draft") {
  const c = await loadConnection(a, id);
  if (c.provider !== "wordpress") throw new ApiError("VALIDATION_ERROR", "Only WordPress connections have this setting.");
  const settings = { ...parse<Record<string, unknown>>(c.settings, {}), wpStatus };
  return toDto(await db.onePostConnection.update({ where: { id }, data: { settings: JSON.stringify(settings) } }));
}

export async function disconnect(a: OrgAccess, id: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const c = await loadConnection(a, id);
  // Anything still waiting to go to this account is cancelled rather than silently sent later.
  const waiting = await db.onePostDelivery.findMany({ where: { organizationId: a.organizationId, connectionId: id, status: "queued" }, select: { postId: true } });
  await db.onePostDelivery.updateMany({ where: { organizationId: a.organizationId, connectionId: id, status: "queued" }, data: { status: "cancelled", error: "The account was disconnected." } });
  for (const postId of new Set(waiting.map((w) => w.postId))) await syncPostState(a.organizationId, postId);
  await db.onePostConnection.delete({ where: { id } });
  await audit({ action: "onepost.connection_removed", actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost_connection", targetId: id, metadata: { provider: c.provider }, req });
}

export const loadConnectionRow = loadConnection;
