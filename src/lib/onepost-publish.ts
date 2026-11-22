// OnePost phase 2: publishing rules shared by the server, the UI and the tests. Pure module (no DB, no Node APIs).
import type { Channel } from "@/lib/onepost";

/** Where a post can go. Facebook and Instagram use the accounts already connected in Channels; the rest are connected in OnePost. */
export const PUBLISH_CHANNELS = [
  { key: "facebook", label: "Facebook Page", version: "facebook", via: "channels" },
  { key: "instagram", label: "Instagram", version: "instagram", via: "channels" },
  { key: "linkedin", label: "LinkedIn", version: "linkedin", via: "connection" },
  { key: "gbp", label: "Google Business Profile", version: "gbp", via: "connection" },
  { key: "wordpress", label: "WordPress blog", version: "blog", via: "connection" },
  { key: "youtube", label: "YouTube", version: "youtube", via: "connection" },
] as const satisfies readonly { key: string; label: string; version: Channel; via: "channels" | "connection" }[];
export type PublishChannel = (typeof PUBLISH_CHANNELS)[number]["key"];
export const PUBLISH_CHANNEL_KEYS = PUBLISH_CHANNELS.map((c) => c.key) as [PublishChannel, ...PublishChannel[]];
export const PUBLISH_LABELS = Object.fromEntries(PUBLISH_CHANNELS.map((c) => [c.key, c.label])) as Record<PublishChannel, string>;
export const versionFor = (c: PublishChannel): Channel => PUBLISH_CHANNELS.find((x) => x.key === c)!.version;
export const isPublishChannel = (v: unknown): v is PublishChannel => typeof v === "string" && (PUBLISH_CHANNEL_KEYS as string[]).includes(v);

export const CONNECTION_PROVIDERS = ["linkedin", "gbp", "wordpress", "youtube", "gsc"] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];
export const PROVIDER_LABELS: Record<ConnectionProvider, string> = { linkedin: "LinkedIn", gbp: "Google Business Profile", wordpress: "WordPress", youtube: "YouTube", gsc: "Google Search Console" };
/** Providers that sign in through OAuth (the others use a login the person types once). */
export const OAUTH_PROVIDERS = ["linkedin", "gbp", "youtube", "gsc"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export const isOAuthProvider = (v: unknown): v is OAuthProvider => typeof v === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(v);
export const PUBLISH_PROVIDER: Record<PublishChannel, ConnectionProvider | ""> = { facebook: "", instagram: "", linkedin: "linkedin", gbp: "gbp", wordpress: "wordpress", youtube: "youtube" };
export const isProvider = (v: unknown): v is ConnectionProvider => typeof v === "string" && (CONNECTION_PROVIDERS as readonly string[]).includes(v);

export const DELIVERY_STATUSES = ["queued", "publishing", "published", "failed", "cancelled"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_LABELS: Record<DeliveryStatus, string> = { queued: "Queued", publishing: "Publishing", published: "Published", failed: "Failed", cancelled: "Cancelled" };
export const DELIVERY_TONES: Record<DeliveryStatus, "neutral" | "info" | "warning" | "success" | "danger"> = { queued: "info", publishing: "info", published: "success", failed: "danger", cancelled: "neutral" };

// ---------------------------------------------------------------------------
// Retries
// ---------------------------------------------------------------------------

export const MAX_ATTEMPTS = 3;
/** Minutes to wait before attempt n+1 after attempt n failed with a temporary error. */
const BACKOFF_MINUTES = [5, 20, 60];
export const nextAttemptAfter = (attemptsMade: number, now = new Date()) => new Date(now.getTime() + (BACKOFF_MINUTES[Math.min(attemptsMade, BACKOFF_MINUTES.length) - 1] ?? 60) * 60_000);

/** An error a channel's API raised. `retryable` = a temporary problem worth trying again (timeouts, rate limits, 5xx). */
export class PublishError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** True when the connection itself is no longer valid and the person must reconnect. */
    readonly reconnect = false,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

export const retryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

// ---------------------------------------------------------------------------
// India time (all scheduling is in Asia/Kolkata, UTC+05:30 with no daylight saving)
// ---------------------------------------------------------------------------

const IST_OFFSET_MIN = 330;

/** "2026-11-25T10:30" typed in an IST date-time box → the real moment in time. Returns null for anything that isn't that shape. */
export function istToDate(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MIN * 60_000;
  const back = new Date(t + IST_OFFSET_MIN * 60_000);
  // Reject rollovers such as 31 February.
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? new Date(t) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** The IST wall-clock parts of a moment. */
export function istParts(date: Date) {
  const t = new Date(date.getTime() + IST_OFFSET_MIN * 60_000);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), hour: t.getUTCHours(), minute: t.getUTCMinutes(), weekday: t.getUTCDay() };
}
export const dateToIstInput = (date: Date) => {
  const p = istParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
};
/** Same time of day, on another IST calendar day (used when a post is dragged to a new day in the calendar). */
export function moveToIstDay(date: Date, year: number, month: number, day: number): Date | null {
  const p = istParts(date);
  return istToDate(`${year}-${pad(month)}-${pad(day)}T${pad(p.hour)}:${pad(p.minute)}`);
}

// ---------------------------------------------------------------------------
// What is sent, from an approved version
// ---------------------------------------------------------------------------

const tagLine = (tags: string[]) => tags.map((t) => `#${t}`).join(" ");

/** The exact text that goes out for a channel, built from the approved version. */
export function textFor(channel: PublishChannel, content: unknown): string {
  const c = content as Record<string, unknown>;
  switch (channel) {
    case "facebook":
    case "linkedin":
      return [String(c.text ?? ""), tagLine((c.hashtags as string[]) ?? [])].filter(Boolean).join("\n\n");
    case "instagram":
      return [String(c.caption ?? ""), tagLine((c.hashtags as string[]) ?? [])].filter(Boolean).join("\n\n");
    case "gbp":
      return String(c.text ?? "");
    case "wordpress":
      return String(c.headline ?? "");
    case "youtube":
      return String(c.title ?? "");
  }
}

export type MediaRef = { id: string; kind: "image" | "video"; url: string; mimeType: string; name: string };

/** Why a channel can't take this post, or "" when it can. Checked before anything is queued. */
export function channelProblem(channel: PublishChannel, content: unknown, media: MediaRef[]): string {
  const images = media.filter((m) => m.kind === "image");
  if (channel === "instagram" && !images.length) return "Instagram needs a photo. Add one to the post.";
  if (channel === "youtube" && !media.some((m) => m.kind === "video")) return "YouTube needs a video. Upload one to the post.";
  if (channel === "youtube") {
    const c = content as { title?: string; description?: string };
    if (!c.title?.trim() || !c.description?.trim()) return "The YouTube version is incomplete.";
  } else if (channel === "wordpress") {
    const c = content as { body?: string; slug?: string };
    if (!c.body?.trim() || !c.slug) return "The blog version is incomplete.";
  } else if (!textFor(channel, content).trim()) return "This version is empty.";
  if (channel === "gbp") {
    const c = content as { cta?: string; ctaUrl?: string };
    if (c.cta && c.cta !== "CALL" && !c.ctaUrl) return "Add a link for the Google button, or choose Call now, then approve again.";
  }
  return "";
}

/** A one-line, plain-language reason when only videos were added and the channel needs a photo or none. */
export function videoNote(channel: PublishChannel, media: MediaRef[]): string {
  if (channel === "youtube") return "";
  return media.some((m) => m.kind === "video") ? `Videos are not posted to ${PUBLISH_LABELS[channel]} yet. The text${media.some((m) => m.kind === "image") ? " and photo" : ""} will be posted.` : "";
}

// ---------------------------------------------------------------------------
// A post's overall state from its deliveries
// ---------------------------------------------------------------------------

export type PostFromDeliveries = "scheduled" | "published" | "failed" | "approved";
export function postStateFrom(statuses: DeliveryStatus[]): PostFromDeliveries {
  const live = statuses.filter((s) => s !== "cancelled");
  if (!live.length) return "approved";
  if (live.some((s) => s === "queued" || s === "publishing")) return "scheduled";
  if (live.some((s) => s === "failed")) return "failed";
  return "published";
}
