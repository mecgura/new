import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { actAs, json, makeUser, params, req } from "../helpers";
import * as imagesRoute from "@/app/api/admin/marketing/images/route";
import * as imageRoute from "@/app/api/admin/marketing/images/[id]/route";
import * as copyRoute from "@/app/api/admin/marketing/ad-copy/route";
import { buildImagePrompt } from "@/services/marketing/ai-studio";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const post = (body: unknown) => req("/x", { method: "POST", body });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("AI studio", () => {
  it("is Super Admin only and says which providers are connected", async () => {
    actAs(await makeUser({ name: "Client" }));
    expect((await imagesRoute.GET(req("/x"))).status).toBe(403);
    expect((await copyRoute.POST(post({ provider: "gemini", product: "x y z" }))).status).toBe(403);
    vi.stubEnv("GEMINI_API_KEY", "g-test");
    vi.stubEnv("OPENAI_API_KEY", "");
    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const r = await json(await imagesRoute.GET(req("/x")));
    expect(r.body.providers).toEqual({ gemini: true, openai: false });
    // A provider without a key gives a clear setup message instead of calling anyone.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const no = await json(await imagesRoute.POST(post({ provider: "openai", prompt: "A shop owner with a phone" })));
    expect(no.status).toBe(409);
    expect(String(no.body.error)).toContain("OPENAI_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("makes an image with Gemini, keeps it in the gallery, serves and deletes it", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g-test");
    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ candidates: [{ content: { parts: [{ text: "here" }, { inlineData: { mimeType: "image/png", data: PNG } }] } }] }));
    const r = await json(await imagesRoute.POST(post({ provider: "gemini", prompt: "A sweet shop owner smiling at his phone", aspect: "story", style: "people" })));
    expect(r.status).toBe(201);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-test");
    const sent = JSON.parse(String(init.body));
    expect(sent.generationConfig.imageConfig.aspectRatio).toBe("9:16");
    expect(sent.contents[0].parts[0].text).toContain("sweet shop owner");

    const id = (r.body.image as { id: string }).id;
    const file = await imageRoute.GET(req(`/x?download=1`), params({ id }));
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await file.arrayBuffer()).subarray(1, 4).toString()).toBe("PNG");
    const list = await json(await imagesRoute.GET(req("/x")));
    expect((list.body.images as { id: string }[]).some((i) => i.id === id)).toBe(true);
    expect((await imageRoute.DELETE(req("/x", { method: "DELETE" }), params({ id }))).status).toBe(200);
    expect(await db.marketingImage.count({ where: { id } })).toBe(0);
  });

  it("makes an image with OpenAI and reports a safety refusal clearly", async () => {
    vi.stubEnv("OPENAI_API_KEY", "o-test");
    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(ok({ data: [{ b64_json: PNG }] }));
    const r = await json(await imagesRoute.POST(post({ provider: "openai", prompt: "Festival sale in a small shop", aspect: "landscape" })));
    expect(r.status).toBe(201);
    expect(JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))).toMatchObject({ model: "gpt-image-1", size: "1536x1024" });
    spy.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Your request was rejected by the safety system." } }), { status: 400 }));
    const bad = await json(await imagesRoute.POST(post({ provider: "openai", prompt: "Something not allowed here" })));
    expect(bad.status).toBe(503);
    expect(String(bad.body.error)).toContain("safety filter");
  });

  it("writes ad copy in the chosen language", async () => {
    vi.stubEnv("OPENAI_API_KEY", "o-test");
    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const answer = { headlines: ["WhatsApp pe 24x7 reply", "Lead kabhi miss nahi", "Setup hum karenge"], primaryTexts: ["Customer ka message aaya? 📲\nTurant auto-reply."], cta: "Free demo lo", hashtags: ["#WhatsAppBusiness"] };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
    const r = await json(await copyRoute.POST(post({ provider: "openai", product: "WhatsApp automation for salons", language: "punjabi_roman", offer: "Free setup" })));
    expect(r.status).toBe(200);
    expect(r.body.copy).toMatchObject({ cta: "Free demo lo", headlines: answer.headlines });
    const prompt = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body)).messages[0].content as string;
    expect(prompt).toContain("Roman Punjabi");
    expect(prompt).toContain("Free setup");
    spy.mockResolvedValue(ok({ choices: [{ message: { content: "sorry, no JSON" } }] }));
    expect((await copyRoute.POST(post({ provider: "openai", product: "WhatsApp automation" }))).status).toBe(503);
  });

  it("the prompt always asks for no logos or brand names and adds brand colours only when asked", () => {
    const base = { provider: "gemini" as const, prompt: "A gym owner", style: "ad_photo" as const, aspect: "post" as const };
    expect(buildImagePrompt({ ...base, brand: true })).toMatch(/emerald green/);
    expect(buildImagePrompt({ ...base, brand: false })).not.toMatch(/emerald green/);
    expect(buildImagePrompt({ ...base, brand: false })).toMatch(/No logos/);
  });
});
