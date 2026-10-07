import { describe, expect, it } from "vitest";
import { defaultData, demoWorkflow, evaluateCondition, keywordMatches, renderText, validateGraph, type EvalContext, type FlowNode, type Graph, type NodeDataMap } from "@/lib/automations";
import { isBlockedAddress } from "@/lib/safe-fetch";
import { graphSchema } from "@/lib/validations";

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  message: "I need a Website quote",
  contact: { name: "Priya Sharma", email: "priya@example.com", phone: "+919876543210", customFields: { city: "Pune" }, tags: ["VIP", "Diwali"], leadStatus: "qualified", source: "whatsapp", optInStatus: "opted_in" },
  now: new Date("2026-10-06T05:30:00Z"), // 11:00 IST
  ...over,
});
const cond = (rules: NodeDataMap["condition"]["rules"], match: "all" | "any" = "all"): NodeDataMap["condition"] => ({ match, rules });
const rule = (field: NodeDataMap["condition"]["rules"][number]["field"], operator: NodeDataMap["condition"]["rules"][number]["operator"], value = "", key = "") => ({ field, operator, value, key });

describe("conditions", () => {
  it("text operators are case-insensitive; contains accepts a comma list", () => {
    expect(evaluateCondition(cond([rule("message", "contains", "website")]), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("message", "contains", "price, website")]), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("message", "starts_with", "i need")]), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("message", "ends_with", "QUOTE")]), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("message", "equals", "hi")]), ctx())).toBe(false);
    expect(evaluateCondition(cond([rule("message", "not_equals", "hi")]), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("contact_email", "is_empty")]), ctx())).toBe(false);
  });
  it("contact field, tag, lead status, source, consent, date and time", () => {
    expect(evaluateCondition(cond([rule("custom", "equals", "pune", "city")]), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("tag", "has", "vip"), rule("tag", "not_has", "Spam")]), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("lead_status", "equals", "qualified"), rule("source", "not_equals", "import"), rule("consent", "equals", "opted_in")]), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("date", "on", "2026-10-06")]), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("date", "before", "2026-10-01")]), ctx())).toBe(false);
    expect(evaluateCondition(cond([rule("time", "after", "09:00"), rule("time", "before", "18:00")]), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("time", "after", "20:00"), rule("tag", "has", "VIP")], "any"), ctx())).toBe(true);
    expect(evaluateCondition(cond([rule("tag", "has", "VIP")]), ctx({ contact: null }))).toBe(false);
  });
  it("keywords and personalisation", () => {
    expect(keywordMatches("PRICE", ["price"], "exact")).toBe(true);
    expect(keywordMatches("what is the price?", ["price"], "contains")).toBe(true);
    expect(keywordMatches("what is the price?", ["price"], "exact")).toBe(false);
    expect(renderText("Hi {{contact.first_name}} from {{contact.custom.city}} — you said “{{reply}}”", { contact: ctx().contact, reply: "Website", ai: "", trigger: "" })).toBe("Hi Priya from Pune — you said “Website”");
    expect(renderText("Hi {{contact.first_name}}", { contact: null, reply: "", ai: "", trigger: "" })).toBe("Hi there");
    expect(renderText("Keep {{unknown}}", { contact: null, reply: "", ai: "", trigger: "" })).toBe("Keep {{unknown}}");
  });
});

describe("graph validation", () => {
  const n = (id: string, type: FlowNode["type"], data: Record<string, unknown> = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data: { ...defaultData(type), ...data } as FlowNode["data"] });
  it("accepts the demo workflow", () => {
    const g = demoWorkflow();
    expect(validateGraph(g).errors).toEqual([]);
    expect(graphSchema.safeParse(g).success).toBe(true);
    expect(g.nodes.map((x) => x.type)).toEqual(["trigger", "message", "delay", "message", "condition", "assign", "tag", "end", "tag", "end"]);
  });
  it("rejects cycles, double outputs, missing triggers and bad configs", () => {
    const cyc: Graph = { nodes: [n("t", "trigger"), n("a", "delay"), n("b", "delay")], edges: [{ id: "1", source: "t", target: "a" }, { id: "2", source: "a", target: "b" }, { id: "3", source: "b", target: "a" }] };
    expect(validateGraph(cyc).errors.map((e) => e.message).join()).toMatch(/loops back/);
    const dbl: Graph = { nodes: [n("t", "trigger"), n("a", "end"), n("b", "end")], edges: [{ id: "1", source: "t", target: "a" }, { id: "2", source: "t", target: "b" }] };
    expect(validateGraph(dbl).errors.map((e) => e.message).join()).toMatch(/one step only/);
    expect(validateGraph({ nodes: [n("a", "end")], edges: [] }).errors[0].message).toMatch(/Add a trigger/);
    const bad: Graph = {
      nodes: [n("t", "trigger", { trigger: "keyword", keywords: [] }), n("d", "delay", { amount: 0 }), n("w", "webhook", { url: "http://x.com" }), n("c", "condition", { rules: [rule("tag", "contains", "x")] })],
      edges: [{ id: "1", source: "t", target: "d" }, { id: "2", source: "d", target: "w" }, { id: "3", source: "w", target: "c" }],
    };
    const msgs = validateGraph(bad).errors.map((e) => e.message).join(" | ");
    expect(msgs).toMatch(/at least one keyword/);
    expect(msgs).toMatch(/between 1 minute and 30 days/);
    expect(msgs).toMatch(/https/);
    expect(msgs).toMatch(/can't be used with Tag/);
    expect(validateGraph(bad).warnings.length).toBe(2); // condition Yes/No not connected
  });
});

describe("SSRF guard", () => {
  it("blocks private, loopback, link-local and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isBlockedAddress(ip)).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) expect(isBlockedAddress(ip)).toBe(false);
  });
});
