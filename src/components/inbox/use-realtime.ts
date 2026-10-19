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

const VISIBLE_MS = 3_000;
const HIDDEN_MS = 20_000;

/**
 * Live updates by polling the org's event log (serverless instances don't share memory, so a held-open stream can't
 * see events handled elsewhere). Polls every few seconds while the tab is visible and slowly while hidden;
 * `onResync` fires after a failed poll recovers (or when the server says the screen fell too far behind) so views can
 * reload what they missed. Returns whether the last poll worked.
 */
export function useRealtime(orgId: string, onEvent: (e: LiveEvent) => void, onResync: () => void) {
  const [connected, setConnected] = React.useState(false);
  const handlers = React.useRef({ onEvent, onResync });
  React.useEffect(() => {
    handlers.current = { onEvent, onResync };
  });

  React.useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let cursor: number | null = null;
    let failed = false;
    const url = `/api/organizations/${orgId}/realtime`;

    async function tick() {
      try {
        const res = await fetch(cursor === null ? url : `${url}?after=${cursor}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { cursor: number; events: LiveEvent[]; resync: boolean };
        if (stopped) return;
        cursor = data.cursor;
        setConnected(true);
        if (failed || data.resync) handlers.current.onResync();
        failed = false;
        for (const e of data.events) handlers.current.onEvent(e);
      } catch {
        if (stopped) return;
        failed = true;
        setConnected(false);
      }
      if (!stopped) timer = window.setTimeout(tick, document.visibilityState === "visible" ? VISIBLE_MS : HIDDEN_MS);
    }
    function onVisible() {
      if (document.visibilityState !== "visible" || stopped) return;
      window.clearTimeout(timer);
      void tick();
    }
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [orgId]);

  return connected;
}
