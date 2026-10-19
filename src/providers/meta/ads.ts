import { graph } from "@/providers/meta/graph";

/**
 * Meta Marketing API calls for click-to-WhatsApp ads. Everything here is created PAUSED; activating is a separate call.
 * Built from Meta's Marketing API documentation; field names are checked against Meta's own error messages, which are
 * passed back to the user unchanged.
 */
export type AdAccountInfo = { id: string; name?: string; currency?: string; account_status?: number };

export function getAdAccount(adAccountId: string, token: string) {
  return graph<AdAccountInfo>(`act_${adAccountId}`, { token, query: { fields: "id,name,currency,account_status" } });
}

export function getPage(pageId: string, token: string) {
  return graph<{ id: string; name?: string }>(pageId, { token, query: { fields: "id,name" } });
}

/** Uploads an image (base64) to the ad account and returns its hash. */
export async function uploadAdImage(adAccountId: string, token: string, base64: string): Promise<string> {
  const r = await graph<{ images?: Record<string, { hash?: string }> }>(`act_${adAccountId}/adimages`, { token, method: "POST", body: { bytes: base64 } });
  const hash = Object.values(r.images ?? {})[0]?.hash;
  if (!hash) throw new Error("Meta did not return an image hash.");
  return hash;
}

type Id = { id: string };

export type CtwaInput = {
  name: string;
  pageId: string;
  whatsappNumberE164: string; // +91…
  dailyBudgetPaise: number;
  message: string;
  headline: string;
  imageHash: string;
  ageMin: number;
  ageMax: number;
  gender: "all" | "male" | "female";
  startAt: Date;
  endAt: Date | null;
};

/** Campaign → ad set → creative → ad, all PAUSED. Returns every id created so a partial failure can be cleaned up. */
export async function createCtwaAd(adAccountId: string, token: string, input: CtwaInput, onStep?: (ids: Partial<{ campaign: string; adset: string; creative: string; ad: string }>) => void) {
  const act = `act_${adAccountId}`;
  const ids: Partial<{ campaign: string; adset: string; creative: string; ad: string }> = {};
  const campaign = await graph<Id>(`${act}/campaigns`, {
    token,
    method: "POST",
    body: { name: input.name, objective: "OUTCOME_ENGAGEMENT", status: "PAUSED", special_ad_categories: [] },
  });
  ids.campaign = campaign.id;
  onStep?.({ ...ids });
  const adset = await graph<Id>(`${act}/adsets`, {
    token,
    method: "POST",
    body: {
      name: `${input.name} — ad set`,
      campaign_id: campaign.id,
      daily_budget: input.dailyBudgetPaise,
      billing_event: "IMPRESSIONS",
      optimization_goal: "CONVERSATIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: "WHATSAPP",
      promoted_object: { page_id: input.pageId, whatsapp_phone_number: input.whatsappNumberE164 },
      targeting: {
        geo_locations: { countries: ["IN"] },
        age_min: input.ageMin,
        age_max: input.ageMax,
        ...(input.gender === "male" ? { genders: [1] } : input.gender === "female" ? { genders: [2] } : {}),
      },
      start_time: input.startAt.toISOString(),
      ...(input.endAt ? { end_time: input.endAt.toISOString() } : {}),
      status: "PAUSED",
    },
  });
  ids.adset = adset.id;
  onStep?.({ ...ids });
  const creative = await graph<Id>(`${act}/adcreatives`, {
    token,
    method: "POST",
    body: {
      name: `${input.name} — creative`,
      object_story_spec: {
        page_id: input.pageId,
        link_data: {
          message: input.message,
          name: input.headline || undefined,
          link: `https://api.whatsapp.com/send?phone=${input.whatsappNumberE164.replace(/\D/g, "")}`,
          image_hash: input.imageHash,
          call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
        },
      },
    },
  });
  ids.creative = creative.id;
  onStep?.({ ...ids });
  const ad = await graph<Id>(`${act}/ads`, {
    token,
    method: "POST",
    body: { name: input.name, adset_id: adset.id, creative: { creative_id: creative.id }, status: "PAUSED" },
  });
  ids.ad = ad.id;
  onStep?.({ ...ids });
  return ids;
}

/** Sets the delivery status of one Meta object (campaign, ad set or ad). */
export async function setStatus(objectId: string, token: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
  const r = await graph<{ success?: boolean }>(objectId, { token, method: "POST", body: { status } });
  return r.success !== false;
}

export type AdInsights = { spendPaise: number; impressions: number; clicks: number };

/** Lifetime totals for one ad. Meta reports spend in currency units (rupees) as a decimal string. */
export async function getAdInsights(adId: string, token: string): Promise<AdInsights> {
  const r = await graph<{ data?: { spend?: string; impressions?: string; clicks?: string }[] }>(`${adId}/insights`, { token, query: { fields: "spend,impressions,clicks", date_preset: "maximum" } });
  const d = r.data?.[0];
  return { spendPaise: Math.round(parseFloat(d?.spend ?? "0") * 100) || 0, impressions: Number(d?.impressions ?? 0) || 0, clicks: Number(d?.clicks ?? 0) || 0 };
}
