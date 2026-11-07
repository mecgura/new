"use client";

import * as React from "react";
import { sourceOf } from "@/lib/traffic-source";
import { trackContact } from "@/lib/site-events";

/**
 * Anonymous analytics for MECGURA's own site: one "visit" per page load and a "click" for any element marked
 * data-track="name". Remembers where the visitor first came from (utm, referrer, ?ref= client code) so a lead
 * they leave later is credited to it. Nothing personal is sent; storage failures are ignored.
 */
const VID = "mgc_vid";
const ATTR = "mgc_attr";
export type Attribution = { medium: string; campaign: string; ref: string };

const store = {
  get(k: string) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

function visitorId() {
  let v = store.get(VID);
  if (!v || !/^[a-zA-Z0-9_-]{8,64}$/.test(v)) {
    v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    store.set(VID, v);
  }
  return v;
}

/** First-touch source of this browser (for crediting a lead). */
export function getAttribution(): Attribution | undefined {
  try {
    const a = JSON.parse(store.get(ATTR) ?? "null") as Attribution | null;
    return a ?? undefined;
  } catch {
    return undefined;
  }
}

function send(body: Record<string, string>) {
  const data = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.("/api/m/track", new Blob([data], { type: "text/plain" }))) return;
  } catch {
    /* fall through */
  }
  void fetch("/api/m/track", { method: "POST", body: data, keepalive: true }).catch(() => undefined);
}

export function SiteTracker() {
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const utmSource = (q.get("utm_source") ?? "").slice(0, 60);
    const utmCampaign = (q.get("utm_campaign") ?? "").slice(0, 80);
    const ref = /^[a-z0-9-]{1,60}$/i.test(q.get("ref") ?? "") ? q.get("ref")!.toLowerCase() : "";
    const referrer = document.referrer.slice(0, 500);
    const medium = sourceOf(utmSource, referrer, window.location.hostname);
    // A real source (an ad, a post, a referral) replaces an earlier "direct" visit; otherwise the first touch stays.
    const prev = getAttribution();
    if (!prev || ref || (medium !== "direct" && prev.medium === "direct")) store.set(ATTR, JSON.stringify({ medium, campaign: utmCampaign, ref: ref || prev?.ref || "" }));
    const vid = visitorId();
    send({ kind: "visit", path: window.location.pathname, referrer, utmSource, utmCampaign, ref, visitor: vid });

    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-track]");
      const name = el?.getAttribute("data-track") ?? "";
      if (!/^[a-z0-9_]{1,40}$/.test(name)) return;
      if (/whatsapp|call|cta/.test(name)) trackContact(name);
      const a = getAttribution();
      send({ kind: "click", name, path: window.location.pathname, utmSource: a?.medium === "direct" ? "" : (a?.medium ?? ""), utmCampaign: a?.campaign ?? "", ref: a?.ref ?? "", visitor: vid });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
