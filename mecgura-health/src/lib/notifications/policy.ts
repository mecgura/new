import "server-only";
import { db } from "@/lib/db";
import { TYPES, TYPE_KEYS } from "./catalog";
import type { Channel } from "@/lib/communications/catalog";

/**
 * Phase 12 decides WHICH external channels a patient notification may use; Phase 11 does the delivery.
 * `null` = no restriction from the notification rules (the clinic's Phase 11 channel settings apply as before).
 */
export async function externalChannelsFor(tenantId: string, commEvent: string): Promise<Channel[] | null> {
  const types = TYPE_KEYS.filter((k) => (TYPES[k] as { comm?: string }).comm === commEvent); if (!types.length) return null;
  const rules = await db.notificationRule.findMany({ where: { tenantId, type: { in: types } }, select: { externalChannels: true, enabled: true } });
  let allowed: Channel[] | null = null;
  for (const r of rules) {
    if (!r.enabled) return [];
    if (r.externalChannels) { try { const a = (JSON.parse(r.externalChannels) as Channel[]); allowed = allowed ? allowed.filter((c) => a.includes(c)) : a; } catch { /* ignore a corrupt value: no restriction */ } }
  }
  return allowed;
}
