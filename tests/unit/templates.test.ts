import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTH_OPTIONS,
  fromMetaComponents,
  mapMetaStatus,
  paramProblem,
  renderTemplate,
  templateSlots,
  toMetaComponents,
  toSendComponents,
  validateTemplate,
  variableCount,
  type TemplateDef,
} from "@/lib/templates";
import { normalizeEvents } from "@/providers/meta/webhook";
import { resolveValue } from "@/services/campaigns/compliance";

const base: TemplateDef = {
  name: "diwali_offer",
  language: "en",
  category: "MARKETING",
  headerType: "none",
  headerText: "",
  body: "Hi {{1}}, enjoy {{2}} off this Diwali at our store. Reply STOP to opt out.",
  footer: "",
  buttons: [],
  examples: { body: ["Priya", "20%"] },
  authOptions: DEFAULT_AUTH_OPTIONS,
};
const errorsOf = (t: Partial<TemplateDef>, forSubmit = true) => validateTemplate({ ...base, ...t }, { forSubmit }).errors;

describe("template validation (Meta rules)", () => {
  it("accepts a well-formed marketing template", () => {
    expect(errorsOf({})).toEqual({});
  });

  it("enforces naming, sequence, placement and length rules", () => {
    expect(errorsOf({ name: "Diwali Offer" }).name).toBeDefined();
    expect(errorsOf({ body: "{{1}} is here for you today" }).body?.join()).toMatch(/start or end/);
    expect(errorsOf({ body: "Hello there my friend {{1}}" }).body?.join()).toMatch(/start or end/);
    expect(errorsOf({ body: "Hi {{1}} and {{3}} welcome to the shop" }).body?.join()).toMatch(/sequence/);
    expect(errorsOf({ body: "Hi {{name}} welcome to the shop" }).body?.join()).toMatch(/numbered/);
    expect(errorsOf({ body: "Hi {{1}}{{2}} welcome to the shop", examples: { body: ["a", "b"] } }).body?.join()).toMatch(/next to each other/);
    expect(errorsOf({ body: "x".repeat(1025) }).body).toBeDefined();
    expect(errorsOf({ footer: "Thanks {{1}}" }).footer).toBeDefined();
  });

  it("requires samples only when submitting", () => {
    expect(errorsOf({ examples: {} }, false)).toEqual({});
    expect(Object.keys(errorsOf({ examples: {} }))).toEqual(["examples.body.1", "examples.body.2"]);
  });

  it("validates header and buttons", () => {
    expect(errorsOf({ headerType: "text", headerText: "Hi {{1}} and {{2}}" }).headerText?.join()).toMatch(/at most one/);
    expect(errorsOf({ headerType: "text", headerText: "Big sale 🎉" }).headerText).toBeDefined();
    expect(errorsOf({ buttons: [{ type: "URL", text: "Shop", url: "https://x.com/{{1}}/page" }] })["buttons.0"]).toBeDefined();
    expect(errorsOf({ buttons: [{ type: "URL", text: "Shop", url: "https://x.com/p/{{1}}", example: "https://x.com/p/9" }] })).toEqual({});
    expect(errorsOf({ buttons: [{ type: "PHONE_NUMBER", text: "Call", phone: "98765" }] })["buttons.0"]).toBeDefined();
    const three = Array.from({ length: 3 }, (_, i) => ({ type: "URL" as const, text: `L${i}`, url: "https://x.com" }));
    expect(errorsOf({ buttons: three }).buttons?.join()).toMatch(/2 website/);
    expect(
      errorsOf({ buttons: [{ type: "QUICK_REPLY", text: "A" }, { type: "URL", text: "B", url: "https://x.com" }, { type: "QUICK_REPLY", text: "C" }] }).buttons?.join()
    ).toMatch(/together/);
    expect(errorsOf({ buttons: [{ type: "QUICK_REPLY", text: "Same" }, { type: "QUICK_REPLY", text: "same" }] })["buttons.1"]).toBeDefined();
  });

  it("warns (not blocks) on marketing without an opt-out line", () => {
    const r = validateTemplate({ ...base, body: "Hi {{1}}, enjoy {{2}} off this Diwali at our lovely store today." }, { forSubmit: true });
    expect(r.errors).toEqual({});
    expect(r.warnings.join()).toMatch(/opt-out/);
  });

  it("authentication templates use Meta's fixed format", () => {
    const auth: TemplateDef = { ...base, category: "AUTHENTICATION", body: "", examples: {}, authOptions: { addSecurityRecommendation: true, codeExpirationMinutes: 10, buttonText: "Copy code" } };
    expect(validateTemplate(auth, { forSubmit: true }).errors).toEqual({});
    expect(validateTemplate({ ...auth, authOptions: { ...auth.authOptions, codeExpirationMinutes: 120 } }).errors["authOptions.codeExpirationMinutes"]).toBeDefined();
    expect(toMetaComponents(auth)).toEqual([
      { type: "BODY", add_security_recommendation: true },
      { type: "FOOTER", code_expiration_minutes: 10 },
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }] },
    ]);
    expect(toSendComponents(auth, { "body.1": "482910" })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "482910" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "482910" }] },
    ]);
    expect(renderTemplate(auth, { "body.1": "482910" }).body).toContain("*482910* is your verification code");
  });
});

describe("template ↔ Meta formats", () => {
  const full: TemplateDef = {
    ...base,
    headerType: "text",
    headerText: "Order {{1}}",
    examples: { header: ["#1234"], body: ["Priya", "20%"] },
    footer: "Reply STOP to opt out",
    buttons: [
      { type: "QUICK_REPLY", text: "Interested" },
      { type: "URL", text: "Track", url: "https://shop.example.com/t/{{1}}", example: "https://shop.example.com/t/99" },
      { type: "PHONE_NUMBER", text: "Call us", phone: "+919876543210" },
    ],
  };

  it("builds create-template components with examples", () => {
    const c = toMetaComponents(full);
    expect(c[0]).toEqual({ type: "HEADER", format: "TEXT", text: "Order {{1}}", example: { header_text: ["#1234"] } });
    expect(c[1]).toEqual({ type: "BODY", text: full.body, example: { body_text: [["Priya", "20%"]] } });
    expect(c[3]).toMatchObject({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY" }, { type: "URL", example: ["https://shop.example.com/t/99"] }, { type: "PHONE_NUMBER", phone_number: "+919876543210" }] });
    expect(toMetaComponents({ ...full, headerType: "image" }, "4::aGFuZGxl")[0]).toEqual({ type: "HEADER", format: "IMAGE", example: { header_handle: ["4::aGFuZGxl"] } });
  });

  it("round-trips through Meta's sync format", () => {
    const back = fromMetaComponents("MARKETING", toMetaComponents(full) as Parameters<typeof fromMetaComponents>[1]);
    expect(back).toMatchObject({ headerType: "text", headerText: full.headerText, body: full.body, footer: full.footer, buttons: full.buttons });
  });

  it("lists every send slot and builds send components", () => {
    expect(templateSlots(full).map((s) => s.key)).toEqual(["header", "body.1", "body.2", "button.1"]);
    const v = { header: "#77", "body.1": "Aman", "body.2": "15%", "button.1": "77" };
    expect(toSendComponents(full, v)).toEqual([
      { type: "header", parameters: [{ type: "text", text: "#77" }] },
      { type: "body", parameters: [{ type: "text", text: "Aman" }, { type: "text", text: "15%" }] },
      { type: "button", sub_type: "url", index: "1", parameters: [{ type: "text", text: "77" }] },
    ]);
    expect(toSendComponents({ ...full, headerType: "image" }, { ...v, header: "https://cdn.x/a.jpg" })[0]).toEqual({ type: "header", parameters: [{ type: "image", image: { link: "https://cdn.x/a.jpg" } }] });
    expect(renderTemplate(full, v)).toMatchObject({ header: "Order #77", body: "Hi Aman, enjoy 15% off this Diwali at our store. Reply STOP to opt out." });
  });

  it("maps Meta statuses and checks parameter values", () => {
    expect(["APPROVED", "PENDING", "IN_APPEAL", "REJECTED", "PAUSED", "DISABLED"].map(mapMetaStatus)).toEqual(["approved", "pending", "pending", "rejected", "paused", "disabled"]);
    expect(paramProblem("")).toMatch(/empty/);
    expect(paramProblem("a\nb")).toMatch(/line breaks/);
    expect(paramProblem("a     b")).toMatch(/4 spaces/);
    expect(paramProblem("http://x.com/a.jpg", "media")).toMatch(/https/);
    expect(paramProblem("Priya")).toBeNull();
    expect(variableCount("{{1}} {{2}} {{2}}")).toBe(2);
  });

  it("resolves campaign variables from contact fields with fallbacks", () => {
    const contact = { name: "Priya Sharma", phone: "+919876543210", email: "", customFields: JSON.stringify({ city: "Pune" }) };
    expect(resolveValue({ source: "field", field: "first_name", key: "", fallback: "there" }, contact)).toBe("Priya");
    expect(resolveValue({ source: "field", field: "email", key: "", fallback: "n/a" }, contact)).toBe("n/a");
    expect(resolveValue({ source: "field", field: "custom", key: "city", fallback: "" }, contact)).toBe("Pune");
    expect(resolveValue({ source: "static", value: " DIWALI20 " }, contact)).toBe("DIWALI20");
  });
});

describe("template & account webhooks", () => {
  it("normalizes template status/quality/category and account updates", () => {
    const events = normalizeEvents({
      entry: [
        {
          id: "111",
          changes: [
            { field: "message_template_status_update", value: { event: "REJECTED", message_template_id: 987, message_template_name: "diwali_offer", message_template_language: "en", reason: "INVALID_FORMAT" } },
            { field: "message_template_quality_update", value: { message_template_id: 987, new_quality_score: "RED" } },
            { field: "template_category_update", value: { message_template_id: 987, new_category: "MARKETING" } },
            { field: "account_update", value: { event: "ACCOUNT_VIOLATION", violation_info: { violation_type: "SPAM" } } },
          ],
        },
      ],
    });
    expect(events).toEqual([
      { kind: "template_status", wabaId: "111", metaTemplateId: "987", name: "diwali_offer", language: "en", event: "REJECTED", reason: "INVALID_FORMAT" },
      { kind: "template_quality", wabaId: "111", metaTemplateId: "987", score: "RED" },
      { kind: "template_category", wabaId: "111", metaTemplateId: "987", category: "MARKETING" },
      { kind: "account", wabaId: "111", event: "ACCOUNT_VIOLATION", detail: "SPAM" },
    ]);
  });
});
