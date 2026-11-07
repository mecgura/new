import { describe, expect, it } from "vitest";
import { checkTemplate, optInTexts } from "@/lib/template-check";
import { BLOG_STARTERS_HINGLISH } from "../../prisma/blog-starters-hinglish";
import { renderMarkdown } from "@/lib/markdown";

describe("template checker", () => {
  it("reads order updates as utility, offers as marketing, codes as authentication", () => {
    expect(checkTemplate("Hello {{1}}, your order #{{2}} is confirmed. We will update you soon.").category).toBe("UTILITY");
    expect(checkTemplate("Hello {{1}}, your appointment is scheduled for tomorrow. Reminder from our clinic.").category).toBe("UTILITY");
    expect(checkTemplate("Diwali offer! Get 20% off today only. Shop now at {{1}}.").category).toBe("MARKETING");
    expect(checkTemplate("{{1}} is your verification code. Do not share it.").category).toBe("AUTHENTICATION");
  });
  it("a promotion that mentions an order is still marketing (no way to hide it)", () => {
    const v = checkTemplate("Your order is confirmed! Plus get 30% off your next purchase, limited time offer.");
    expect(v.category).toBe("MARKETING");
    expect(v.reasons.join(" ")).toContain("Mixing a promotion");
  });
  it("flags the format mistakes Meta rejects", () => {
    expect(checkTemplate("{{1}}, your order is confirmed.").warnings.join(" ")).toContain("starts with a variable");
    expect(checkTemplate("Your order is confirmed, ref {{1}}").warnings.join(" ")).toContain("ends with a variable");
    expect(checkTemplate("Hello {{1}}{{2}} your order is confirmed.").warnings.join(" ")).toContain("side by side");
    expect(checkTemplate("Hello {{1}} and {{3}}, your order is confirmed today.").warnings.join(" ")).toContain("numbered");
    expect(checkTemplate("Your order is confirmed, track at bit.ly/abc today.").warnings.join(" ")).toContain("shorteners");
    expect(checkTemplate("x".repeat(1100)).warnings.join(" ")).toContain("1024");
    expect(checkTemplate("Hello {{1}}, your order #{{2}} is confirmed. We will update you when it ships.").warnings).toEqual([]);
    expect(checkTemplate("").category).toBe("UNSURE");
  });
});

describe("opt-in wording", () => {
  it("always says who, what, how often and how to stop", () => {
    const t = optInTexts({ business: "Glow Studio", where: "qr", sends: ["offers", "reminders"], language: "english", frequency: "2 times a month" });
    for (const s of [t.ask, t.checkbox, t.confirm]) expect(s).toContain("Glow Studio");
    expect(t.ask).toContain("offers and reminders");
    expect(t.ask).toContain("2 times a month");
    for (const s of [t.ask, t.checkbox, t.confirm, t.stop]) expect(s).toContain("STOP");
    expect(optInTexts({ business: "", where: "counter", sends: [], language: "hinglish", frequency: "" }).ask).toContain("STOP");
  });
});

describe("Hinglish blog starters", () => {
  it("have unique slugs, good excerpts, no empty bodies, and only https links that renderMarkdown accepts", () => {
    expect(new Set(BLOG_STARTERS_HINGLISH.map((a) => a.slug)).size).toBe(BLOG_STARTERS_HINGLISH.length);
    expect(BLOG_STARTERS_HINGLISH).toHaveLength(12);
    for (const a of BLOG_STARTERS_HINGLISH) {
      expect(a.slug).toMatch(/^[a-z0-9-]{1,80}$/);
      expect(a.title.length, a.slug).toBeLessThanOrEqual(120);
      expect(a.excerpt.length, a.slug).toBeLessThanOrEqual(160);
      expect(a.body.length, a.slug).toBeGreaterThan(900);
      const { html } = renderMarkdown(a.body);
      expect(html, a.slug).toContain("<h2");
      for (const m of a.body.matchAll(/\]\((https?:[^)]+)\)/g)) expect(m[1], a.slug).toMatch(/^https:\/\/mecgura\.tech\//);
    }
  });
});
