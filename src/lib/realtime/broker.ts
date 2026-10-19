import { EventEmitter } from "node:events";
import { db } from "@/lib/db";
import { runAfterResponse } from "@/lib/background";

/**
 * Realtime fan-out for the inbox. Events carry ids + minimal routing data only;
 * clients re-fetch through the normal (authorized) APIs.
 *
 * The in-process broker serves the same instance (and tests). Across serverless instances events are shared through the
 * database: `publish` stores them and the browser polls `GET /realtime?after=<cursor>`.
 */
export type RealtimeEvent =
  | { type: "message.created"; conversationId: string; messageId: string; assignedToUserId: string | null }
  | { type: "message.status"; conversationId: string; messageId: string; status: string; assignedToUserId: string | null }
  | { type: "conversation.updated"; conversationId: string; assignedToUserId: string | null }
  | { type: "contact.updated"; contactId: string }
  | { type: "team.presence"; userId: string; status: string }
  | { type: "campaign.updated"; campaignId: string }
  | { type: "template.updated"; templateId: string }
  | { type: "automation.updated"; automationId: string };

export interface RealtimeBroker {
  publish(organizationId: string, event: RealtimeEvent): void;
  subscribe(organizationId: string, handler: (event: RealtimeEvent) => void): () => void;
}

class InProcessBroker implements RealtimeBroker {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish(organizationId: string, event: RealtimeEvent) {
    this.emitter.emit(`org:${organizationId}`, event);
  }
  subscribe(organizationId: string, handler: (event: RealtimeEvent) => void) {
    const key = `org:${organizationId}`;
    this.emitter.on(key, handler);
    return () => this.emitter.off(key, handler);
  }
}

const g = globalThis as unknown as { __mecguraRealtime?: RealtimeBroker };
g.__mecguraRealtime ??= new InProcessBroker();

export function realtime(): RealtimeBroker {
  return g.__mecguraRealtime!;
}

export function setRealtimeBroker(broker: RealtimeBroker) {
  g.__mecguraRealtime = broker;
}

/**
 * Notifies this instance's subscribers and stores the event so browsers (which poll /realtime) see it no matter which
 * serverless instance handled the request. Storing never blocks or breaks the request that published it.
 */
export function publish(organizationId: string, event: RealtimeEvent) {
  try {
    realtime().publish(organizationId, event);
  } catch (e) {
    console.error("[realtime] publish failed", e);
  }
  runAfterResponse(() =>
    db.realtimeEvent.create({
      data: { organizationId, type: event.type, data: JSON.stringify(event), assignedToUserId: "assignedToUserId" in event ? (event.assignedToUserId ?? null) : null },
    })
  );
}
