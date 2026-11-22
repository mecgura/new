// OnePost Event Mode: one event becomes a small campaign of five posts. Pure module.
import type { Channel } from "@/lib/onepost";

export const EVENT_PHASES = [
  { key: "teaser", label: "Pre-event teaser", channels: ["instagram", "facebook", "linkedin", "gbp", "whatsapp"], note: "Gets people interested before the day. Post about a week ahead.", guide: "Invite people to the upcoming event: what it is, when, where and why to come. Build interest. Do not write as if it has already happened." },
  { key: "live", label: "Live update", channels: ["instagram", "facebook", "linkedin"], note: "Short updates on the day. Edit the details before posting.", guide: "Write a short live update from the event on the day it happens. Keep it present tense and brief. Only mention things listed in the highlights." },
  { key: "recap", label: "Post-event recap blog", channels: ["blog", "linkedin", "facebook"], note: "A write-up for your website once it is over.", guide: "Write a recap of the event that has now taken place: what happened, who took part, and what comes next. Use only the highlights supplied; do not invent attendance numbers, guests or quotes." },
  { key: "gallery", label: "Gallery post", channels: ["instagram", "facebook", "gbp"], note: "Thank-you post to go with your event photos.", guide: "Write a thank-you caption to go with a gallery of event photos. Invite people to look through the photos and tag themselves. Do not describe photos you cannot see." },
  { key: "press", label: "Press release", channels: ["press_release", "pitch_email"], note: "For newspapers and portals. Add a real quote if you have one.", guide: "Write a neutral press release about the event, and the short pitch email that goes with it." },
] as const satisfies readonly { key: string; label: string; channels: readonly Channel[]; note: string; guide: string }[];

export type EventPhase = (typeof EVENT_PHASES)[number]["key"];
export const EVENT_PHASE_KEYS = EVENT_PHASES.map((p) => p.key) as [EventPhase, ...EventPhase[]];
export const isEventPhase = (v: unknown): v is EventPhase => typeof v === "string" && (EVENT_PHASE_KEYS as string[]).includes(v);
export const phaseOf = (k: string) => EVENT_PHASES.find((p) => p.key === k);
export const phaseChannels = (k: string): Channel[] => [...(phaseOf(k)?.channels ?? [])] as Channel[];
