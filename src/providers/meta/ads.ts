import { graph, MetaApiError } from "@/providers/meta/graph";

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

/** A place to show the ad: a state/region, or a city with a radius around it (Meta allows 17–80 km). */
export type AdLocation = { key: string; name: string; type: "region" | "city"; radiusKm?: number };

/** Meta's location keys for Indian states and cities matching `q`. */
export async function searchLocations(token: string, q: string): Promise<(AdLocation & { region: string })[]> {
  const r = await graph<{ data?: { key: string; name: string; type: string; region?: string }[] }>("search", {
    token,
    query: { type: "adgeolocation", q, location_types: JSON.stringify(["region", "city"]), country_code: "IN", limit: "12" },
  });
  return (r.data ?? [])
    .filter((x) => x.type === "region" || x.type === "city")
    .map((x) => ({ key: String(x.key), name: x.name, type: x.type as "region" | "city", region: x.region ?? "" }));
}

/** Meta targeting for the chosen places; no places means all of India. */
export function geoTargeting(locations: AdLocation[]) {
  if (!locations.length) return { countries: ["IN"] };
  const regions = locations.filter((l) => l.type === "region").map((l) => ({ key: l.key }));
  const cities = locations.filter((l) => l.type === "city").map((l) => ({ key: l.key, radius: Math.min(80, Math.max(17, l.radiusKm ?? 25)), distance_unit: "kilometer" }));
  return { ...(regions.length ? { regions } : {}), ...(cities.length ? { cities } : {}) };
}

export type CtwaInput = {
  /** Opening greeting and up to 3 tappable questions shown when the chat opens from the ad. */
  greeting?: string;
  starters?: string[];
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
  locations: AdLocation[];
  /** Also show on WhatsApp Status (Updates tab). Falls back to Facebook + Instagram if Meta doesn't allow it for the account. */
  whatsappStatus?: boolean;
};

/**
 * Manual placements that add WhatsApp Status. Meta requires Instagram Stories alongside it (no Status-only ads)
 * and supports single image / video creatives there.
 */
export const WHATSAPP_STATUS_PLACEMENTS = {
  publisher_platforms: ["facebook", "instagram", "whatsapp"],
  facebook_positions: ["feed", "story", "facebook_reels"],
  instagram_positions: ["stream", "story", "reels", "explore"],
  whatsapp_positions: ["status"],
};

/**
 * The "greeting + tappable questions" Meta shows when the chat opens from an ad (before the customer sends anything).
 * Each question the customer taps is sent as their first message, which then starts your automation.
 * Returns the JSON string Meta expects in link_data.page_welcome_message, or "" when there is nothing to show.
 */
export function welcomeMessageJson(greeting?: string, starters?: string[]): string {
  const text = (greeting ?? "").trim().slice(0, 160);
  const questions = (starters ?? []).map((q) => q.trim().slice(0, 80)).filter(Boolean).slice(0, 3);
  if (!text && !questions.length) return "";
  return JSON.stringify({
    type: "VISUAL_EDITOR",
    version: 2,
    landing_screen_type: "welcome_message",
    media_type: "text",
    text_format: {
      customer_action_type: questions.length ? "ice_breakers" : "autofill_message",
      message: {
        text: text || "Hi! Please let us know how we can help you.",
        ...(questions.length ? { ice_breakers: questions.map((title) => ({ title })) } : {}),
      },
    },
  });
}

/** Runs one creation step; a Meta error says which step failed (campaign, ad set, creative, ad). */
async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof MetaApiError) throw new MetaApiError(`${name}: ${e.message}`, e.status, e.code, e.subcode, e.fbtraceId, e.userMessage);
    throw e;
  }
}

/** Campaign → ad set → creative → ad, all PAUSED. Returns every id created so a partial failure can be cleaned up. */
export async function createCtwaAd(adAccountId: string, token: string, input: CtwaInput, onStep?: (ids: Partial<{ campaign: string; adset: string; creative: string; ad: string }>) => void) {
  const act = `act_${adAccountId}`;
  const ids: Partial<{ campaign: string; adset: string; creative: string; ad: string }> = {};
  // Budget lives on the ad set, so Meta (v23+) requires saying budgets are NOT shared across ad sets.
  const campaign = await step("Campaign", () =>
    graph<Id>(`${act}/campaigns`, {
      token,
      method: "POST",
      body: { name: input.name, objective: "OUTCOME_ENGAGEMENT", status: "PAUSED", special_ad_categories: [], is_adset_budget_sharing_enabled: false },
    })
  );
  ids.campaign = campaign.id;
  onStep?.({ ...ids });
  const adsetBody = (withStatus: boolean) => ({
    name: `${input.name} — ad set`,
    campaign_id: campaign.id,
    daily_budget: input.dailyBudgetPaise,
    billing_event: "IMPRESSIONS",
    optimization_goal: "CONVERSATIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    destination_type: "WHATSAPP",
    promoted_object: { page_id: input.pageId, whatsapp_phone_number: input.whatsappNumberE164 },
    targeting: {
      geo_locations: geoTargeting(input.locations),
      age_min: input.ageMin,
      age_max: input.ageMax,
      ...(input.gender === "male" ? { genders: [1] } : input.gender === "female" ? { genders: [2] } : {}),
      // Meta requires an explicit Advantage+ audience choice; 0 = use exactly the age, gender and places chosen here.
      targeting_automation: { advantage_audience: 0 },
      ...(withStatus ? WHATSAPP_STATUS_PLACEMENTS : {}),
    },
    start_time: input.startAt.toISOString(),
    ...(input.endAt ? { end_time: input.endAt.toISOString() } : {}),
    status: "PAUSED",
  });
  let whatsappStatus = Boolean(input.whatsappStatus);
  let placementNote = "";
  let adset: Id;
  try {
    adset = await step("Ad set", () => graph<Id>(`${act}/adsets`, { token, method: "POST", body: adsetBody(whatsappStatus) }));
  } catch (e) {
    if (!whatsappStatus || !(e instanceof MetaApiError)) throw e;
    // WhatsApp Status isn't open for every account or country yet: run on Facebook + Instagram instead, and say why.
    whatsappStatus = false;
    placementNote = `WhatsApp Status not available for this ad account yet (${e.userMessage || e.message}). Running on Facebook and Instagram.`.slice(0, 500);
    adset = await step("Ad set", () => graph<Id>(`${act}/adsets`, { token, method: "POST", body: adsetBody(false) }));
  }
  ids.adset = adset.id;
  onStep?.({ ...ids });
  const welcome = welcomeMessageJson(input.greeting, input.starters);
  const creativeBody = (withWelcome: boolean) => ({
    name: `${input.name} — creative`,
    object_story_spec: {
      page_id: input.pageId,
      link_data: {
        message: input.message,
        name: input.headline || undefined,
        link: `https://api.whatsapp.com/send?phone=${input.whatsappNumberE164.replace(/\D/g, "")}`,
        image_hash: input.imageHash,
        call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
        ...(withWelcome && welcome ? { page_welcome_message: welcome } : {}),
      },
    },
  });
  let greetingNote = "";
  let creative: Id;
  try {
    creative = await step("Creative", () => graph<Id>(`${act}/adcreatives`, { token, method: "POST", body: creativeBody(Boolean(welcome)) }));
  } catch (e) {
    if (!welcome || !(e instanceof MetaApiError)) throw e;
    // The opening greeting is an extra: if Meta refuses it for this account or version, the ad is still created without it.
    greetingNote = `The opening greeting and questions were not applied (${e.userMessage || e.message}). Your ad still works; customers get your automation's reply after they message.`.slice(0, 500);
    creative = await step("Creative", () => graph<Id>(`${act}/adcreatives`, { token, method: "POST", body: creativeBody(false) }));
  }
  ids.creative = creative.id;
  onStep?.({ ...ids });
  const ad = await step("Ad", () =>
    graph<Id>(`${act}/ads`, {
      token,
      method: "POST",
      body: { name: input.name, adset_id: adset.id, creative: { creative_id: creative.id }, status: "PAUSED" },
    })
  );
  ids.ad = ad.id;
  onStep?.({ ...ids });
  return { ...ids, whatsappStatus, placementNote, greetingNote };
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

export type AdStatusInfo = { effectiveStatus: string; note: string };

/** The ad's live delivery status on Meta (e.g. PENDING_REVIEW, ACTIVE, DISAPPROVED) and Meta's reason when it was rejected or has an issue. */
export async function getAdStatus(adId: string, token: string): Promise<AdStatusInfo> {
  const r = await graph<{ effective_status?: string; ad_review_feedback?: Record<string, Record<string, string>>; issues_info?: { error_summary?: string; error_message?: string }[] }>(adId, {
    token,
    query: { fields: "effective_status,ad_review_feedback,issues_info" },
  });
  const review = Object.values(r.ad_review_feedback ?? {}).flatMap((group) => Object.entries(group ?? {}).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`));
  const issues = (r.issues_info ?? []).map((i) => i.error_message || i.error_summary || "").filter(Boolean);
  return { effectiveStatus: r.effective_status ?? "", note: [...review, ...issues].join(" · ").slice(0, 1000) };
}

export const PREVIEW_FORMATS = ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_STORY", "WHATSAPP_STATUS_MEDIA", "DESKTOP_FEED_STANDARD"] as const;
export type PreviewFormat = (typeof PREVIEW_FORMATS)[number];

/**
 * Meta's own rendering of the ad. The Graph API returns an <iframe> snippet; only its src (a facebook.com preview
 * URL) is passed on, so no HTML from the API is ever injected into MECGURA pages.
 */
export async function getAdPreviewUrl(adId: string, token: string, format: PreviewFormat): Promise<string> {
  const r = await graph<{ data?: { body?: string }[] }>(`${adId}/previews`, { token, query: { ad_format: format } });
  const body = r.data?.[0]?.body ?? "";
  const src = /src=["']([^"']+)["']/i.exec(body)?.[1]?.replace(/&amp;/g, "&") ?? "";
  if (!/^https:\/\/(www|business)\.facebook\.com\//i.test(src)) throw new Error("Meta did not return a preview for this ad.");
  return src;
}
