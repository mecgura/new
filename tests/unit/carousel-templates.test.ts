import { describe, expect, it } from "vitest";
import { DEFAULT_AUTH_OPTIONS, toMetaComponents, toSendComponents, validateTemplate, type TemplateDef } from "@/lib/templates";

const card = (n: number, buttons: TemplateDef["buttons"] = [{ type: "QUICK_REPLY", text: "Order this" }]) => ({ imageUrl: `https://shop.test/c${n}.jpg`, body: `Cake ${n}, ₹${n}99`, buttons });
const tpl = (over: Partial<TemplateDef> = {}): TemplateDef => ({
  name: "cake_menu",
  language: "en",
  category: "MARKETING",
  headerType: "none",
  headerText: "",
  body: "Hello {{1}}, here are this week's cakes. Reply STOP to unsubscribe.",
  footer: "",
  buttons: [],
  examples: { body: ["Simran"] },
  authOptions: DEFAULT_AUTH_OPTIONS,
  cards: [card(1), card(2)],
  ...over,
});

describe("carousel templates", () => {
  it("accepts a valid carousel and builds Meta's create and send formats", () => {
    expect(validateTemplate(tpl(), { forSubmit: true }).errors).toEqual({});
    const create = toMetaComponents(tpl(), undefined, ["h1", "h2"]);
    const carousel = create.find((c) => c.type === "CAROUSEL") as { cards: { components: Record<string, unknown>[] }[] };
    expect(carousel.cards).toHaveLength(2);
    expect(carousel.cards[1].components[0]).toEqual({ type: "HEADER", format: "IMAGE", example: { header_handle: ["h2"] } });
    expect(carousel.cards[0].components[2]).toEqual({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Order this" }] });

    const send = toSendComponents(tpl(), { "body.1": "Simran" });
    expect(send[0]).toEqual({ type: "body", parameters: [{ type: "text", text: "Simran" }] });
    const sc = send.find((c) => c.type === "carousel") as { cards: { card_index: number; components: Record<string, unknown>[] }[] };
    expect(sc.cards[1].card_index).toBe(1);
    expect(sc.cards[1].components[0]).toEqual({ type: "header", parameters: [{ type: "image", image: { link: "https://shop.test/c2.jpg" } }] });
    expect(sc.cards[0].components[1]).toMatchObject({ type: "button", sub_type: "quick_reply", index: "0" });
  });

  it("refuses the layouts Meta rejects", () => {
    const e = (over: Partial<TemplateDef>) => Object.keys(validateTemplate(tpl(over)).errors);
    expect(e({ cards: [card(1)] })).toContain("cards");
    expect(e({ category: "UTILITY" })).toContain("cards");
    expect(e({ footer: "Thanks" })).toContain("cards");
    expect(e({ buttons: [{ type: "QUICK_REPLY", text: "Hi" }] })).toContain("cards");
    expect(e({ cards: [card(1), card(2, [{ type: "URL", text: "View", url: "https://shop.test/2" }])] })).toContain("cards.1");
    expect(e({ cards: [card(1), { ...card(2), imageUrl: "http://shop.test/2.jpg" }] })).toContain("cards.1");
    expect(e({ cards: [card(1), { ...card(2), body: "Hi {{1}}" }] })).toContain("cards.1");
    // A normal template is untouched.
    expect(validateTemplate(tpl({ cards: [], footer: "Thanks" })).errors).toEqual({});
    expect(toSendComponents(tpl({ cards: [] }), { "body.1": "A" })).toHaveLength(1);
  });
});
