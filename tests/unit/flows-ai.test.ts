import { describe, expect, it } from "vitest";
import { FLOW_JSON_VERSION, FLOW_TEMPLATES, blankDefinition, normalizeAnswers, optionId, toFlowJson, validateFlow, type FlowDefinition } from "@/lib/flows";
import { DEFAULT_ACTIONS, DEFAULT_HANDOFF, demoRespond, demoSummary, matchesKeyword, missingFields, systemPrompt, type AgentConfig } from "@/lib/ai";

describe("WhatsApp Flows model", () => {
  it("ships five valid templates", () => {
    expect(Object.keys(FLOW_TEMPLATES).sort()).toEqual(["appointment", "feedback", "lead", "order", "product"]);
    for (const t of Object.values(FLOW_TEMPLATES)) expect(validateFlow(t.definition)).toEqual([]);
  });

  it("flags missing basics", () => {
    const d = blankDefinition();
    d.start.cta = "";
    d.screens[0].fields = [];
    const errs = validateFlow(d);
    expect(errs.some((e) => e.startsWith("Start"))).toBe(true);
    expect(errs.length).toBeGreaterThan(1);
  });

  it("generates Meta Flow JSON: navigate between screens, carry answers, confirmation completes", () => {
    const d = FLOW_TEMPLATES.appointment.definition;
    const json = toFlowJson(d) as { version: string; screens: { id: string; terminal?: boolean; layout: { children: Record<string, unknown>[] } }[] };
    expect(json.version).toBe(FLOW_JSON_VERSION);
    expect(json.screens.map((s) => s.id)).toEqual(["SCREEN_A", "SCREEN_B", "CONFIRM"]);
    expect(json.screens.filter((s) => s.terminal).map((s) => s.id)).toEqual(["CONFIRM"]);
    const footerA = json.screens[0].layout.children.at(-1) as { "on-click-action": { name: string; next: { name: string }; payload: Record<string, string> } };
    expect(footerA["on-click-action"].name).toBe("navigate");
    expect(footerA["on-click-action"].next.name).toBe("SCREEN_B");
    expect(footerA["on-click-action"].payload.service).toBe("${form.service}");
    const footerB = json.screens[1].layout.children.at(-1) as { "on-click-action": { payload: Record<string, string> } };
    expect(footerB["on-click-action"].payload.service).toBe("${data.service}");
    const done = json.screens[2].layout.children.at(-1) as { "on-click-action": { name: string } };
    expect(done["on-click-action"].name).toBe("complete");
    const dropdown = json.screens[0].layout.children.find((c) => c.type === "Dropdown") as { "data-source": { id: string; title: string }[] };
    expect(dropdown["data-source"][0]).toEqual({ id: optionId("Consultation", 0), title: "Consultation" });
  });

  it("without confirmation, the last form screen is terminal", () => {
    const d: FlowDefinition = structuredClone(FLOW_TEMPLATES.lead.definition);
    d.confirmation.enabled = false;
    const json = toFlowJson(d) as { screens: { id: string; terminal?: boolean }[] };
    expect(json.screens.at(-1)).toMatchObject({ terminal: true });
    expect(json.screens.some((s) => s.id === "CONFIRM")).toBe(false);
  });

  it("normalises answers: option ids → labels, required, email, epoch dates", () => {
    const d = FLOW_TEMPLATES.appointment.definition;
    const ok = normalizeAnswers(d, { service: optionId("Website design", 1), preferred_date: String(Date.UTC(2026, 9, 20)), time_slot: "Evening (4–7)", full_name: "Simran Kaur", email: "simran@example.com" });
    expect(ok.errors).toEqual([]);
    expect(ok.answers).toMatchObject({ service: "Website design", preferred_date: "2026-10-20", time_slot: "Evening (4–7)", full_name: "Simran Kaur" });
    const bad = normalizeAnswers(d, { service: "Hacking", email: "nope" });
    expect(bad.errors).toEqual(expect.arrayContaining(["Service is required.", "Email isn't a valid email.", "Full name is required."]));
  });
});

const cfg = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  name: "Sales assistant",
  businessName: "Sharma Dental",
  instructions: "Be brief.",
  knowledge: {
    faqs: [
      { q: "What are your clinic timings?", a: "We're open 10am–7pm, Monday to Saturday." },
      { q: "Where is the clinic located?", a: "Model Town, Ludhiana." },
    ],
    products: [{ name: "Electric toothbrush", description: "Rechargeable", price: "₹2,499" }],
    services: [{ name: "Teeth whitening", description: "One sitting", price: "₹6,000" }],
    pricing: "Consultation is free. Cleaning ₹800.",
  },
  actions: { ...DEFAULT_ACTIONS, book: true, bookingServices: ["Cleaning", "Whitening"] },
  handoff: DEFAULT_HANDOFF,
  documents: [],
  ...over,
});
const nobody = () => ({ name: "", email: "", customFields: {} });

describe("Demo AI (rule-based)", () => {
  it("hands over on a keyword and stops", () => {
    const t = demoRespond(cfg(), "Can I talk to a human please", nobody());
    expect(t.mode).toBe("demo");
    expect(t.handoff).not.toBeNull();
    expect(t.reply).toBe(DEFAULT_HANDOFF.message);
    expect(t.actions[0]).toMatchObject({ type: "transfer" });
  });

  it("keyword matching is whole-word", () => {
    expect(matchesKeyword("I need an agent", ["agent"])).toBe("agent");
    expect(matchesKeyword("my agency site", ["agent"])).toBeNull();
  });

  it("answers FAQs and then asks for a missing detail", () => {
    const t = demoRespond(cfg(), "what are your timings?", nobody());
    expect(t.reply).toContain("10am–7pm");
    expect(t.reply).toContain("may I have your name");
    expect(t.actions).toContainEqual({ type: "answer", source: "FAQ: What are your clinic timings?" });
  });

  it("collects name, email and city", () => {
    const t = demoRespond(cfg(), "Hi, my name is Simran Kaur, I'm from Ludhiana. Email simran@example.com", nobody());
    const c = t.actions.find((a) => a.type === "collect");
    expect(c).toMatchObject({ fields: { name: "Simran Kaur", email: "simran@example.com", city: "Ludhiana" } });
  });

  it("books when service and date are known, otherwise asks", () => {
    const ask = demoRespond(cfg(), "I want to book an appointment", nobody());
    expect(ask.actions.some((a) => a.type === "book")).toBe(false);
    expect(ask.reply).toMatch(/which service.*preferred date/);
    const book = demoRespond(cfg(), "Please book whitening tomorrow 5pm", nobody());
    expect(book.actions).toContainEqual(expect.objectContaining({ type: "book", service: "Whitening", requestedFor: "tomorrow 5pm" }));
  });

  it("answers product and pricing questions and qualifies the lead", () => {
    const p = demoRespond(cfg(), "Do you sell an electric toothbrush?", nobody());
    expect(p.reply).toContain("₹2,499");
    const price = demoRespond(cfg(), "how much does it cost?", nobody());
    expect(price.reply).toContain("Consultation is free");
    expect(price.actions).toContainEqual(expect.objectContaining({ type: "qualify", status: "qualified" }));
  });

  it("falls back honestly when nothing matches", () => {
    const t = demoRespond(cfg(), "Can you fix my car?", nobody());
    expect(t.reply).toMatch(/not sure/);
    expect(t.handoff).toBeNull();
  });

  it("respects disabled actions", () => {
    const t = demoRespond(cfg({ actions: { ...DEFAULT_ACTIONS, transfer: false, answer: false, collect: false } }), "human please, what are your timings", nobody());
    expect(t.handoff).toBeNull();
    expect(t.reply).not.toContain("10am");
    expect(missingFields({ ...DEFAULT_ACTIONS, collect: false }, nobody())).toEqual([]);
  });

  it("demo summary is labelled as not AI", () => {
    const s = demoSummary([{ role: "customer", text: "hello" }, { role: "business", text: "hi" }, { role: "customer", text: "price?" }], { name: "Simran", email: "", customFields: {} });
    expect(s).toMatch(/^\[Demo summary — rule-based, not AI\]/);
    expect(s).toContain("price?");
  });
});

describe("Live AI prompt", () => {
  it("contains the knowledge base and only enabled action rules", () => {
    const p = systemPrompt(cfg({ actions: { ...DEFAULT_ACTIONS, book: false }, documents: [{ name: "Policy", content: "Refunds within 7 days." }] }));
    expect(p).toContain("Q: What are your clinic timings?");
    expect(p).toContain("Teeth whitening — ₹6,000");
    expect(p).toContain("Refunds within 7 days.");
    expect(p).toContain("Do not book appointments");
    expect(p).toContain("never guess");
  });
});
