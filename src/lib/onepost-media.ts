// OnePost Media Studio: the picture shapes each channel likes, and which stored copy to send. Pure module.
export const RATIOS = {
  "1:1": { w: 1080, h: 1080, label: "Square 1:1", note: "Instagram, Facebook, LinkedIn" },
  "4:5": { w: 1080, h: 1350, label: "Portrait 4:5", note: "Instagram feed" },
  "9:16": { w: 1080, h: 1920, label: "Story 9:16", note: "Stories, Reels, Shorts" },
  "16:9": { w: 1920, h: 1080, label: "Wide 16:9", note: "YouTube, blog, LinkedIn, Facebook" },
} as const;
export type Ratio = keyof typeof RATIOS;
export const RATIO_KEYS = Object.keys(RATIOS) as [Ratio, ...Ratio[]];
export const isRatio = (v: unknown): v is Ratio => typeof v === "string" && v in RATIOS;

/** Preferred shapes per channel, best first. The original photo is the fallback. */
export const CHANNEL_RATIOS: Record<string, Ratio[]> = {
  instagram: ["4:5", "1:1"],
  facebook: ["16:9", "1:1"],
  linkedin: ["16:9", "1:1"],
  gbp: ["16:9", "1:1"],
  wordpress: ["16:9"],
  youtube: ["16:9"],
};

export type MediaRow = { id: string; kind: string; variantOf: string; ratio: string; watermarked: boolean; position: number; url?: string };

/**
 * The photo to send to a channel: the first original photo, in the channel's preferred shape when a resized copy exists
 * (with the logo on it when one was made), otherwise the original itself.
 */
export function pickPhoto<T extends MediaRow>(channel: string, media: T[]): T | undefined {
  const originals = media.filter((m) => m.kind === "image" && !m.variantOf).sort((a, b) => a.position - b.position);
  const first = originals[0];
  if (!first) return undefined;
  for (const r of CHANNEL_RATIOS[channel] ?? []) {
    const copies = media.filter((m) => m.variantOf === first.id && m.ratio === r);
    const best = copies.find((m) => m.watermarked) ?? copies[0];
    if (best) return best;
  }
  return first;
}

export const MAX_VARIANTS_PER_PHOTO = 8;
