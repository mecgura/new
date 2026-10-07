import { db } from "@/lib/db";
import { CHANNELS, EVENTS, isChannel, isEventType, LANGUAGES, type Channel, type EventType, type Language } from "./catalog";

export interface CommSettings {
  whatsappEnabled: boolean; smsEnabled: boolean; emailEnabled: boolean; channelOrder: Channel[]; senderName: string | null; replyTo: string | null; defaultLanguage: Language;
  eventToggles: Partial<Record<EventType, boolean>>; reminderOffsets: number[]; quiet: { enabled: boolean; startMin: number; endMin: number };
  fallbackRules: Partial<Record<Channel, Channel>>; maxRetries: number; dailyCapPerPatient: number;
}
const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export function toSettings(r: Record<string, any> | null): CommSettings {
  const order = parse<unknown[]>(r?.channelOrder, []).filter(isChannel) as Channel[];
  const toggles: Partial<Record<EventType, boolean>> = {}; for (const [k, v] of Object.entries(parse<Record<string, unknown>>(r?.eventToggles, {}))) if (isEventType(k) && typeof v === "boolean") toggles[k] = v;
  const fb: Partial<Record<Channel, Channel>> = {}; for (const [k, v] of Object.entries(parse<Record<string, unknown>>(r?.fallbackRules, {}))) if (isChannel(k) && isChannel(v) && k !== v) fb[k] = v;
  const lang = (LANGUAGES as readonly string[]).includes(r?.defaultLanguage) ? (r!.defaultLanguage as Language) : "en";
  return {
    whatsappEnabled: !!r?.whatsappEnabled, smsEnabled: !!r?.smsEnabled, emailEnabled: !!r?.emailEnabled,
    channelOrder: [...new Set([...order, ...CHANNELS])] as Channel[], senderName: r?.senderName ?? null, replyTo: r?.replyTo ?? null, defaultLanguage: lang, eventToggles: toggles,
    reminderOffsets: parse<unknown[]>(r?.reminderOffsets, [1440]).filter((n): n is number => typeof n === "number" && n >= 15 && n <= 10080).slice(0, 4),
    quiet: { enabled: !!r?.quietEnabled, startMin: r?.quietStartMin ?? 1320, endMin: r?.quietEndMin ?? 480 }, fallbackRules: fb,
    maxRetries: Math.min(6, Math.max(0, r?.maxRetries ?? 3)), dailyCapPerPatient: Math.min(50, Math.max(1, r?.dailyCapPerPatient ?? 8)),
  };
}
export async function loadSettings(tenantId: string): Promise<CommSettings> { return toSettings(await db.communicationSettings.findUnique({ where: { tenantId } })); }
export const channelEnabled = (s: CommSettings, c: Channel) => (c === "WHATSAPP" ? s.whatsappEnabled : c === "SMS" ? s.smsEnabled : s.emailEnabled);
export const anyChannelEnabled = (s: CommSettings) => s.whatsappEnabled || s.smsEnabled || s.emailEnabled;
export const eventEnabled = (s: CommSettings, e: EventType) => s.eventToggles[e] ?? EVENTS[e].defaultOn;
