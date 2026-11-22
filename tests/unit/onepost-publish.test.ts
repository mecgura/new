import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, channelProblem, dateToIstInput, istParts, istToDate, moveToIstDay, nextAttemptAfter, postStateFrom, textFor, videoNote } from "@/lib/onepost-publish";
import { escapeCommentary } from "@/providers/onepost/linkedin";
import { normaliseSite } from "@/providers/onepost/wordpress";

describe("India time", () => {
  it("reads an IST date-time box as the right moment", () => {
    expect(istToDate("2026-11-25T10:30")?.toISOString()).toBe("2026-11-25T05:00:00.000Z");
    expect(istToDate("2026-11-25T00:15")?.toISOString()).toBe("2026-11-24T18:45:00.000Z");
  });
  it("rejects anything that isn't a real date", () => {
    expect(istToDate("2026-02-31T10:00")).toBeNull();
    expect(istToDate("25/11/2026 10:30")).toBeNull();
    expect(istToDate("")).toBeNull();
  });
  it("round-trips and moves a post to another day at the same time", () => {
    const d = istToDate("2026-11-25T23:45")!;
    expect(dateToIstInput(d)).toBe("2026-11-25T23:45");
    expect(istParts(d)).toMatchObject({ year: 2026, month: 11, day: 25, hour: 23, minute: 45 });
    expect(dateToIstInput(moveToIstDay(d, 2026, 12, 2)!)).toBe("2026-12-02T23:45");
  });
});

describe("retries and post state", () => {
  it("waits longer after each failed attempt", () => {
    const now = new Date("2026-11-25T00:00:00Z");
    expect(nextAttemptAfter(1, now).getTime() - now.getTime()).toBe(5 * 60_000);
    expect(nextAttemptAfter(2, now).getTime() - now.getTime()).toBe(20 * 60_000);
    expect(nextAttemptAfter(3, now).getTime() - now.getTime()).toBe(60 * 60_000);
    expect(MAX_ATTEMPTS).toBe(3);
  });
  it("derives the post's state from its channels", () => {
    expect(postStateFrom([])).toBe("approved");
    expect(postStateFrom(["cancelled"])).toBe("approved");
    expect(postStateFrom(["published", "queued"])).toBe("scheduled");
    expect(postStateFrom(["published", "failed"])).toBe("failed");
    expect(postStateFrom(["published", "published", "cancelled"])).toBe("published");
  });
});

describe("what a channel needs", () => {
  const photo = [{ id: "m1", kind: "image" as const, url: "https://x.public.blob.vercel-storage.com/a.jpg", mimeType: "image/jpeg", name: "a.jpg" }];
  const video = [{ id: "m2", kind: "video" as const, url: "https://x.public.blob.vercel-storage.com/a.mp4", mimeType: "video/mp4", name: "a.mp4" }];
  it("Instagram needs a photo; a video alone isn't enough", () => {
    expect(channelProblem("instagram", { caption: "Hi", hashtags: [] }, [])).toMatch(/needs a photo/);
    expect(channelProblem("instagram", { caption: "Hi", hashtags: [] }, video)).toMatch(/needs a photo/);
    expect(channelProblem("instagram", { caption: "Hi", hashtags: [] }, photo)).toBe("");
  });
  it("Google needs a link for its button unless it is Call now", () => {
    expect(channelProblem("gbp", { text: "Visit", cta: "BOOK", ctaUrl: "" }, [])).toMatch(/link/);
    expect(channelProblem("gbp", { text: "Call", cta: "CALL", ctaUrl: "" }, [])).toBe("");
  });
  it("builds the text from the approved version and says when a video won't be posted", () => {
    expect(textFor("instagram", { caption: "Hello", hashtags: ["a", "b"] })).toBe("Hello\n\n#a #b");
    expect(textFor("facebook", { text: "Hi", hashtags: [] })).toBe("Hi");
    expect(videoNote("facebook", [...photo, ...video[0] ? video : []])).toMatch(/Videos are not posted to Facebook Page yet/);
    expect(videoNote("facebook", photo)).toBe("");
  });
});

describe("provider helpers", () => {
  it("escapes LinkedIn's markup characters but keeps hashtags", () => {
    expect(escapeCommentary("Save (20%) on a_b* #Diwali [now]")).toBe("Save \\(20%\\) on a\\_b\\* #Diwali \\[now\\]");
  });
  it("normalises a WordPress address", () => {
    expect(normaliseSite("myblog.com/")).toBe("https://myblog.com");
    expect(normaliseSite("https://myblog.com/blog///")).toBe("https://myblog.com/blog");
  });
});
