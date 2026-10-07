"use client";

import * as React from "react";

export type LiveEvent =
  | { type: "message.created"; conversationId: string; messageId: string }
  | { type: "message.status"; conversationId: string; messageId: string; status: string }
  | { type: "conversation.updated"; conversationId: string }
  | { type: "contact.updated"; contactId: string }
  | { type: "team.presence"; userId: string; status: string }
  | { type: "campaign.updated"; campaignId: string }
  | { type: "template.updated"; templateId: string }
  | { type: "automation.updated"; automationId: string };

const TYPES = ["message.created", "message.status", "conversation.updated", "contact.updated", "team.presence", "campaign.updated", "template.updated", "automation.updated"] as const;

/**
 * Subscribes to the org's Server-Sent Events stream. No polling: the browser's
 * EventSource reconnects automatically; `onResync` fires after a reconnect so
 * views can catch up on anything missed while offline.
 */
export function useRealtime(orgId: string, onEvent: (e: LiveEvent) => void, onResync: () => void) {
  const [connected, setConnected] = React.useState(false);
  const handlers = React.useRef({ onEvent, onResync });
  React.useEffect(() => {
    handlers.current = { onEvent, onResync };
  });

  React.useEffect(() => {
    const es = new EventSource(`/api/organizations/${orgId}/realtime`);
    let wasDisconnected = false;
    es.addEventListener("ready", () => {
      setConnected(true);
      if (wasDisconnected) handlers.current.onResync();
      wasDisconnected = false;
    });
    es.onerror = () => {
      setConnected(false);
      wasDisconnected = true;
    };
    for (const t of TYPES) {
      es.addEventListener(t, (ev) => {
        try {
          handlers.current.onEvent(JSON.parse((ev as MessageEvent).data) as LiveEvent);
        } catch {
          /* ignore malformed event */
        }
      });
    }
    return () => es.close();
  }, [orgId]);

  return connected;
}
