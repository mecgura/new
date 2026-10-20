import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { OrgAccess } from "@/lib/session";
import { MetaApiError } from "@/providers/meta/graph";
import { createCtwaAd, getAdAccount, getAdInsights, getPage, searchLocations, setStatus, uploadAdImage, type AdLocation, type CtwaInput } from "@/providers/meta/ads";
import { assertServiceEnabled } from "@/services/whatsapp/guards";

export const MIN_DAILY_BUDGET = 10_000; // ₹100
export const MAX_DAILY_BUDGET = 1_000_000; // ₹10,000

const metaError = (e: unknown, fallback: string) => (e instanceof MetaApiError ? `Meta: ${e.message}` : fallback);

async function token(organizationId: string) {
  const c = await db.adConnection.findUnique({ where: { organizationId } });
  if (!c) throw new ApiError("CONFLICT", "Connect the ad account first.");
  return { c, token: decryptSecret(c.encryptedToken) };
}

type CampaignRow = Awaited<ReturnType<typeof db.adCampaign.findFirstOrThrow>>;

function parseLocations(raw: string): AdLocation[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as AdLocation[]) : [];
  } catch {
    return [];
  }
}

function toDto(c: CampaignRow, chats: number) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    dailyBudget: c.dailyBudget,
    whatsappAccountId: c.whatsappAccountId,
    message: c.message,
    headline: c.headline,
    ageMin: c.ageMin,
    ageMax: c.ageMax,
    gender: c.gender,
    locations: parseLocations(c.locations),
    startAt: c.startAt,
    endAt: c.endAt,
    metaAdId: c.metaAdId,
    lastError: c.lastError,
    spend: c.spend,
    impressions: c.impressions,
    clicks: c.clicks,
    chats,
    costPerChat: chats > 0 && c.spend > 0 ? Math.round(c.spend / chats) : null,
    syncedAt: c.syncedAt,
    createdAt: c.createdAt,
  };
}

export async function getOverview(organizationId: string) {
  await assertServiceEnabled(organizationId, "ADS_MANAGER");
  const [conn, campaigns, numbers] = await Promise.all([
    db.adConnection.findUnique({ where: { organizationId } }),
    db.adCampaign.findMany({ where: { organizationId, status: { not: "archived" } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.whatsAppAccount.findMany({ where: { organizationId, status: "connected", isDemo: false }, select: { id: true, displayName: true, phoneNumber: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const ids = campaigns.map((c) => c.metaAdId).filter(Boolean);
  const refs = ids.length ? await db.adReferral.groupBy({ by: ["sourceId"], where: { organizationId, sourceId: { in: ids } }, _count: { _all: true } }) : [];
  const chatsBy = new Map(refs.map((r) => [r.sourceId, r._count._all]));
  return {
    connection: conn ? { adAccountId: conn.adAccountId, adAccountName: conn.adAccountName, pageId: conn.pageId, pageName: conn.pageName, currency: conn.currency, tokenLast4: conn.tokenLast4 } : null,
    numbers,
    campaigns: campaigns.map((c) => toDto(c, chatsBy.get(c.metaAdId) ?? 0)),
    limits: { minDailyBudget: MIN_DAILY_BUDGET, maxDailyBudget: MAX_DAILY_BUDGET },
  };
}

export async function connectAdAccount(access: OrgAccess, input: { adAccountId: string; pageId: string; accessToken: string }, req?: Request) {
  const orgId = access.organizationId;
  await assertServiceEnabled(orgId, "ADS_MANAGER");
  let acct;
  let page;
  try {
    [acct, page] = await Promise.all([getAdAccount(input.adAccountId, input.accessToken), getPage(input.pageId, input.accessToken)]);
  } catch (e) {
    throw new ApiError("VALIDATION_ERROR", metaError(e, "Could not verify the ad account and Page with Meta."), { details: { accessToken: ["Could not be verified with Meta"] } });
  }
  if (acct.account_status !== undefined && acct.account_status !== 1) throw new ApiError("CONFLICT", "That ad account is not active on Meta (disabled, in review or unsettled).");
  const data = { adAccountId: input.adAccountId, adAccountName: acct.name ?? "", pageId: input.pageId, pageName: page.name ?? "", currency: acct.currency ?? "INR", encryptedToken: encryptSecret(input.accessToken), tokenLast4: input.accessToken.slice(-4) };
  await db.adConnection.upsert({ where: { organizationId: orgId }, update: data, create: { organizationId: orgId, ...data } });
  await audit({ action: "ads.connected", actorUserId: access.user.id, organizationId: orgId, targetType: "ad_account", targetId: input.adAccountId, req });
  return getOverview(orgId);
}

export async function disconnectAdAccount(access: OrgAccess) {
  await assertServiceEnabled(access.organizationId, "ADS_MANAGER");
  await db.adConnection.deleteMany({ where: { organizationId: access.organizationId } });
}

export async function uploadImage(access: OrgAccess, base64: string) {
  await assertServiceEnabled(access.organizationId, "ADS_MANAGER");
  const { c, token: t } = await token(access.organizationId);
  try {
    return { hash: await uploadAdImage(c.adAccountId, t, base64) };
  } catch (e) {
    throw new ApiError("VALIDATION_ERROR", metaError(e, "Meta did not accept the image."));
  }
}

export type CreateAdInput = { name: string; whatsappAccountId: string; dailyBudgetRupees: number; message: string; headline: string; imageHash: string; ageMin: number; ageMax: number; gender: "all" | "male" | "female"; startAt: Date | null; endAt: Date | null; locations: AdLocation[] };

/** Creates the ad on Meta, always PAUSED. If any step fails, what was already created is archived and the error is kept on the record. */
export async function createAd(access: OrgAccess, input: CreateAdInput, req?: Request) {
  const orgId = access.organizationId;
  await assertServiceEnabled(orgId, "ADS_MANAGER");
  const { c, token: t } = await token(orgId);
  const budget = Math.round(input.dailyBudgetRupees * 100);
  if (budget < MIN_DAILY_BUDGET || budget > MAX_DAILY_BUDGET) throw new ApiError("VALIDATION_ERROR", "Daily budget must be between ₹100 and ₹10,000.", { details: { dailyBudgetRupees: ["Between ₹100 and ₹10,000"] } });
  if (input.ageMin > input.ageMax) throw new ApiError("VALIDATION_ERROR", "Minimum age can't be above maximum age.", { details: { ageMin: ["Above maximum age"] } });
  const wa = await db.whatsAppAccount.findFirst({ where: { id: input.whatsappAccountId, organizationId: orgId, status: "connected", isDemo: false } });
  if (!wa) throw new ApiError("VALIDATION_ERROR", "Choose a connected (live) WhatsApp number. Demo numbers can't receive ad clicks.", { details: { whatsappAccountId: ["Not a live connected number"] } });
  const startAt = input.startAt && input.startAt.getTime() > Date.now() ? input.startAt : new Date(Date.now() + 10 * 60_000);

  const row = await db.adCampaign.create({
    data: { organizationId: orgId, name: input.name, dailyBudget: budget, whatsappAccountId: wa.id, message: input.message, headline: input.headline, imageHash: input.imageHash, ageMin: input.ageMin, ageMax: input.ageMax, gender: input.gender, locations: JSON.stringify(input.locations), startAt, endAt: input.endAt, createdByUserId: access.user.id },
  });
  const made: Partial<{ campaign: string; adset: string; creative: string; ad: string }> = {};
  const meta: CtwaInput = { name: input.name, pageId: c.pageId, whatsappNumberE164: wa.phoneNumber, dailyBudgetPaise: budget, message: input.message, headline: input.headline, imageHash: input.imageHash, ageMin: input.ageMin, ageMax: input.ageMax, gender: input.gender, startAt, endAt: input.endAt, locations: input.locations };
  try {
    const ids = await createCtwaAd(c.adAccountId, t, meta, (partial) => Object.assign(made, partial));
    await db.adCampaign.update({ where: { id: row.id }, data: { status: "paused", metaCampaignId: ids.campaign ?? "", metaAdSetId: ids.adset ?? "", metaCreativeId: ids.creative ?? "", metaAdId: ids.ad ?? "", lastError: "" } });
  } catch (e) {
    if (made.campaign) await setStatus(made.campaign, t, "ARCHIVED").catch(() => undefined); // nothing half-built is left running
    await db.adCampaign.update({ where: { id: row.id }, data: { status: "failed", lastError: metaError(e, "Meta could not create the ad.").slice(0, 500) } });
    throw new ApiError("VALIDATION_ERROR", metaError(e, "Meta could not create the ad."));
  }
  await audit({ action: "ads.created", actorUserId: access.user.id, organizationId: orgId, targetType: "ad_campaign", targetId: row.id, metadata: { dailyBudget: budget }, req });
  return (await getOverview(orgId)).campaigns.find((x) => x.id === row.id)!;
}

export async function changeStatus(access: OrgAccess, id: string, action: "activate" | "pause" | "archive", req?: Request) {
  const orgId = access.organizationId;
  await assertServiceEnabled(orgId, "ADS_MANAGER");
  const row = await db.adCampaign.findFirst({ where: { id, organizationId: orgId } });
  if (!row) throw new ApiError("NOT_FOUND", "Ad not found.");
  if (!row.metaAdId || row.status === "failed") throw new ApiError("CONFLICT", "This ad was not created on Meta.");
  if (action === "activate" && row.status === "active") return (await getOverview(orgId)).campaigns.find((x) => x.id === id)!;
  const { token: t } = await token(orgId);
  const target = action === "activate" ? "ACTIVE" : action === "pause" ? "PAUSED" : "ARCHIVED";
  try {
    // Campaign first when starting (so the ad can deliver), ad first when stopping.
    const order = action === "activate" ? [row.metaCampaignId, row.metaAdSetId, row.metaAdId] : [row.metaAdId, row.metaAdSetId, row.metaCampaignId];
    for (const objectId of order) if (objectId) await setStatus(objectId, t, target);
  } catch (e) {
    throw new ApiError("CONFLICT", metaError(e, "Meta did not accept the change."));
  }
  await db.adCampaign.update({ where: { id }, data: { status: action === "activate" ? "active" : action === "pause" ? "paused" : "archived" } });
  await audit({ action: "ads.status_changed", actorUserId: access.user.id, organizationId: orgId, targetType: "ad_campaign", targetId: id, metadata: { action }, req });
  return (await getOverview(orgId)).campaigns.find((x) => x.id === id) ?? null;
}

/** Pulls spend, impressions and clicks from Meta for one ad. */
export async function syncInsights(access: OrgAccess, id: string) {
  const orgId = access.organizationId;
  await assertServiceEnabled(orgId, "ADS_MANAGER");
  const row = await db.adCampaign.findFirst({ where: { id, organizationId: orgId } });
  if (!row?.metaAdId) throw new ApiError("NOT_FOUND", "Ad not found.");
  const { token: t } = await token(orgId);
  try {
    const i = await getAdInsights(row.metaAdId, t);
    await db.adCampaign.update({ where: { id }, data: { spend: i.spendPaise, impressions: i.impressions, clicks: i.clicks, syncedAt: new Date() } });
  } catch (e) {
    throw new ApiError("CONFLICT", metaError(e, "Could not read results from Meta."));
  }
  return (await getOverview(orgId)).campaigns.find((x) => x.id === id)!;
}

/** Indian states and cities matching what the user typed, for ad targeting. */
export async function findLocations(access: OrgAccess, q: string) {
  await assertServiceEnabled(access.organizationId, "ADS_MANAGER");
  const { token: t } = await token(access.organizationId);
  try {
    return await searchLocations(t, q);
  } catch (e) {
    throw new ApiError("CONFLICT", metaError(e, "Could not search places on Meta."));
  }
}
