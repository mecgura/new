import { EventEmitter } from "node:events";

/**
 * Realtime fan-out for the inbox. Events carry ids + minimal routing data only;
 * clients re-fetch through the normal (authorized) APIs.
 *
 * The default broker is in-process. With more than one server instance (e.g.
 * serverless), plug in a shared broker (Redis pub/sub, Postgres LISTEN/NOTIFY,
 * Pusher/Ably) by implementing `RealtimeBroker` and calling `setRealtimeBroker`.
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

export function publish(organizationId: string, event: RealtimeEvent) {
  try {
    realtime().publish(organizationId, event);
  } catch (e) {
    console.error("[realtime] publish failed", e);
  }
}
