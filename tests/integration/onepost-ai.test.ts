import { afterEach, describe, expect, it, vi } from "vitest";

const complete = vi.fn();
vi.mock("@/providers/openai/chat", () => ({ complete: (...a: unknown[]) => complete(...a), OPENAI_MODEL: "gpt-test", openaiConfigured: () => true }));
vi.mock("@/providers/ai/router", () => ({ resolveProviders: async () => ({ primary: "openai", fallback: null, settings: { provider: "openai", fallback: false, models: { anthropic: "claude-test", openai: "gpt-test" } } }) }));

import { OnePostAi } from "@/services/onepost/ai";

afterEach(() => complete.mockReset());
const brand = { businessName: "Mehta Clinic", services: "Health checkups", city: "Shimla", website: "https://mehtaclinic.example", about: "A family clinic.", tone: "friendly", language: "en", defaultHashtags: "", contactName: "Asha", contactEmail: "press@mehtaclinic.example", contactPhone: "" };
const post = { title: "Diwali checkup", brief: "Checkup from 1 to 10 November.", postType: "offer", language: "en", tone: "friendly", city: "Shimla", keywords: "", spokespersonName: "Dr Mehta", spokespersonQuote: "Health first.", videoUrl: "", hasMedia: false };
const answer = (o: unknown) => ({ choices: [{ message: { content: typeof o === "string" ? o : JSON.stringify(o) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });

describe("OnePostAi with a live provider", () => {
  it("sends the facts and rules, returns validated content and counts tokens", async () => {
    complete.mockResolvedValueOnce(answer({ caption: "Book your Diwali checkup today.", hashtags: ["#DiwaliHealth", "Shimla"] }));
    const r = await OnePostAi.generate({ brand, post, channel: "instagram" });
    expect(r.model).toBe("gpt-test");
    expect(r.content).toEqual({ caption: "Book your Diwali checkup today.", hashtags: ["DiwaliHealth", "Shimla"] });
    expect(r.inputTokens).toBe(100);
    const body = complete.mock.calls[0][0] as { messages: { role: string; content: string }[] };
    expect(body.messages[0].content).toMatch(/Never invent prices/);
    expect(body.messages[1].content).toContain("Mehta Clinic");
    expect(body.messages[1].content).toContain("Checkup from 1 to 10 November.");
  });

  it("repairs a bad first answer once, then uses the corrected one", async () => {
    complete.mockResolvedValueOnce(answer("Sorry, here you go: not json"));
    complete.mockResolvedValueOnce(answer({ body: "Hello {{1}}, checkups are open. Reply STOP to opt out.", suggestedCategory: "MARKETING" }));
    const r = await OnePostAi.generate({ brand, post, channel: "whatsapp" });
    expect((r.content as { body: string }).body).toMatch(/checkups are open/);
    expect(complete).toHaveBeenCalledTimes(2);
    expect((complete.mock.calls[1][0] as { messages: { content: string }[] }).messages[1].content).toMatch(/previous answer was rejected/);
    expect(r.inputTokens).toBe(200);
  });

  it("overwrites an invented quote with the client's own words", async () => {
    complete.mockResolvedValueOnce(answer({ headline: "Mehta Clinic launches offer", subheadline: "", dateline: "Shimla, India — 1 November 2026", body: "Body text.", quoteText: "We are the best in India", quoteBy: "A Minister", boilerplate: "", contactName: "", contactEmail: "", contactPhone: "" }));
    const r = await OnePostAi.generate({ brand, post, channel: "press_release" });
    const c = r.content as { quoteText: string; quoteBy: string; boilerplate: string; contactEmail: string };
    expect(c.quoteText).toBe("Health first.");
    expect(c.quoteBy).toBe("Dr Mehta");
    expect(c.boilerplate).toBe("A family clinic.");
    expect(c.contactEmail).toBe("press@mehtaclinic.example");
  });

  it("gives up with a clear error when the answer stays unusable", async () => {
    complete.mockResolvedValue(answer("still not json"));
    await expect(OnePostAi.generate({ brand, post, channel: "instagram" })).rejects.toThrow(/could not be used/);
  });
});
