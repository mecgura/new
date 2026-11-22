import { describe, expect, it } from "vitest";
import { CONTENT_SCHEMAS, checkContent, cleanTags, contentToText, downloadName, duplicateWarnings, flowActionsFor, parseContent, similarity, slugify, wordCount } from "@/lib/onepost";
import { extractJson, tidy, enforceFacts } from "@/services/onepost/ai";

describe("onepost content rules", () => {
  it("cleans hashtags", () => {
    expect(cleanTags(["#Diwali", "##Diwali", "health care", "offer!", ""], 10)).toEqual(["Diwali", "healthcare", "offer"]);
    expect(cleanTags(["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });

  it("rejects content over a channel's hard limit", () => {
    expect(() => parseContent("gbp", { text: "x".repeat(1501), cta: "BOOK", ctaUrl: "" })).toThrow();
    expect(() => parseContent("instagram", { caption: "x".repeat(2201), hashtags: [] })).toThrow();
    expect(() => parseContent("instagram", { caption: "Hi", hashtags: Array.from({ length: 31 }, (_, i) => `t${i}`) })).toThrow();
    expect(parseContent("instagram", { caption: "Hi", hashtags: Array.from({ length: 30 }, (_, i) => `t${i}`) }).hashtags).toHaveLength(30);
    expect(() => parseContent("ads", { variations: [] })).toThrow();
  });

  it("warns about unprovable claims, phone numbers in GBP text and a missing press-release quote", () => {
    expect(checkContent("facebook", { text: "We are guaranteed to be the best in town", hashtags: [] }).join(" ")).toMatch(/strong claim/i);
    expect(checkContent("gbp", { text: "Call us on 98765 43210 today", cta: "BOOK", ctaUrl: "https://x.example" }).join(" ")).toMatch(/phone numbers/i);
    const pr = { headline: "H", subheadline: "", dateline: "Shimla, India — 1 Nov 2026", body: "word ".repeat(200), quoteText: "", quoteBy: "", boilerplate: "", contactName: "", contactEmail: "a@b.co", contactPhone: "" };
    expect(checkContent("press_release", pr).join(" ")).toMatch(/never makes up quotes/i);
    expect(checkContent("press_release", { ...pr, quoteText: "Made up" }, { quote: "Real words" }).join(" ")).toMatch(/differs from the one you gave/i);
  });

  it("flags an article outside 800–1,200 words and missing headings", () => {
    const blog = { headline: "H", seoTitle: "T", metaDescription: "M", slug: "h", body: "short body", faq: [] };
    const w = checkContent("blog", blog).join(" ");
    expect(w).toMatch(/words/);
    expect(w).toMatch(/H2 headings/);
    expect(wordCount("one two  three")).toBe(3);
  });

  it("detects copy-pasted wording across channels, and not different wording", () => {
    const same = "Book your full body checkup at Mehta Clinic in Shimla before ten November and save on the Diwali health package";
    const dup = duplicateWarnings([
      { channel: "facebook", content: { text: same, hashtags: [] } },
      { channel: "linkedin", content: { text: same, hashtags: [] } },
    ]);
    expect(dup.get("facebook")?.[0]).toMatch(/LinkedIn/);
    expect(similarity(same, "Our doctors are ready for you this festive season with a thorough annual screening")).toBeLessThan(0.1);
    expect(duplicateWarnings([{ channel: "facebook", content: { text: same, hashtags: [] } }, { channel: "linkedin", content: { text: "Entirely different words about something else altogether today", hashtags: [] } }]).size).toBe(0);
  });

  it("makes copyable text for every channel", () => {
    expect(contentToText("instagram", { caption: "Hello", hashtags: ["a", "b"] })).toBe("Hello\n\n#a #b");
    expect(contentToText("gbp", { text: "Visit", cta: "BOOK", ctaUrl: "https://x.example" })).toContain("Button: Book — https://x.example");
    expect(contentToText("press_release", { headline: "H", subheadline: "", dateline: "Shimla, India", body: "Body", quoteText: "Q", quoteBy: "Dr M", boilerplate: "", contactName: "", contactEmail: "", contactPhone: "" })).toMatch(/^PRESS RELEASE/);
    expect(downloadName("blog", "Diwali Offer!")).toBe("diwali-offer-blog.md");
    expect(downloadName("press_release", "Diwali Offer!")).toBe("diwali-offer-press-release.txt");
    expect(slugify("  Hello,  World! ")).toBe("hello-world");
  });

  it("only owners approve, managers submit, agents do neither", () => {
    expect(flowActionsFor("in_review", "CLIENT_OWNER").sort()).toEqual(["approve", "reopen", "request_changes"]);
    expect(flowActionsFor("draft", "MANAGER")).toEqual(["submit"]);
    expect(flowActionsFor("draft", "AGENT")).toEqual([]);
    expect(flowActionsFor("approved", "MANAGER")).toEqual(["reopen"]);
    expect(flowActionsFor("published", "CLIENT_OWNER")).toEqual([]);
    expect(flowActionsFor("draft", null)).toContain("approve");
  });

  it("every channel has a schema", () => {
    expect(Object.keys(CONTENT_SCHEMAS)).toHaveLength(10);
  });
});

describe("AI answer handling", () => {
  it("extracts JSON from fenced or chatty answers", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here it is: {"a":1} Hope that helps.')).toEqual({ a: 1 });
    expect(() => extractJson("no json here")).toThrow();
  });

  it("trims over-long fields and normalises tags before validation", () => {
    const t = tidy("instagram", { caption: "x".repeat(3000), hashtags: "#a, #b  c" }) as { caption: string; hashtags: string[] };
    expect(t.caption.length).toBeLessThanOrEqual(2200);
    expect(t.hashtags).toEqual(["a", "b", "c"]);
    const y = tidy("youtube", { title: "T", description: "D", tags: Array.from({ length: 30 }, () => "abcdefghijklmnopqrstuvwxyz"), shortsCaption: "" }) as { tags: string[] };
    expect(y.tags.join(",").length).toBeLessThanOrEqual(500);
  });

  it("never lets the AI change the quote, the speaker or the contact details", () => {
    const brand = { businessName: "B", services: "", city: "", website: "", about: "Brand about", tone: "friendly", language: "en", defaultHashtags: "", contactName: "Asha", contactEmail: "asha@b.example", contactPhone: "" };
    const post = { title: "T", brief: "", postType: "news", language: "en", tone: "friendly", city: "", keywords: "", spokespersonName: "Dr Mehta", spokespersonQuote: "The real quote.", videoUrl: "", hasMedia: false };
    const out = enforceFacts({ brand, post, channel: "press_release" }, { quoteText: "Invented words", quoteBy: "Someone Famous", boilerplate: "", contactName: "", contactEmail: "" });
    expect(out.quoteText).toBe("The real quote.");
    expect(out.quoteBy).toBe("Dr Mehta");
    expect(out.boilerplate).toBe("Brand about");
    expect(out.contactEmail).toBe("asha@b.example");
    const none = enforceFacts({ brand, post: { ...post, spokespersonQuote: "" }, channel: "press_release" }, { quoteText: "Invented", quoteBy: "X" });
    expect(none.quoteText).toBe("");
    expect(none.quoteBy).toBe("");
  });
});
