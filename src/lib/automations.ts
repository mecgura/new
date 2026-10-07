// Automation graph model. Pure module (no DB / Node APIs): the builder UI,
// the API validation and the execution engine share these definitions.

export const NODE_TYPES = ["trigger", "message", "template", "delay", "condition", "tag", "assign", "update_contact", "webhook", "ai_response", "end"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_LABELS: Record<NodeType, string> = {
  trigger: "Trigger",
  message: "Message",
  template: "Template",
  delay: "Delay",
  condition: "Condition",
  tag: "Tag",
  assign: "Assign agent",
  update_contact: "Update contact",
  webhook: "Webhook",
  ai_response: "AI response",
  end: "End",
};

export const TRIGGER_TYPES = ["new_contact", "incoming_message", "keyword", "button_click", "template_reply", "flow_submission", "webhook", "schedule", "tag_added", "lead_status"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  new_contact: "New contact",
  incoming_message: "Incoming message",
  keyword: "Keyword",
  button_click: "Button click",
  template_reply: "Template reply",
  flow_submission: "Flow submission",
  webhook: "Webhook",
  schedule: "Schedule",
  tag_added: "Tag added",
  lead_status: "Lead status changed",
};

export const CONDITION_FIELDS = ["message", "contact_name", "contact_email", "contact_phone", "custom", "tag", "lead_status", "source", "consent", "date", "time"] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_FIELD_LABELS: Record<ConditionField, string> = {
  message: "Customer's message",
  contact_name: "Contact name",
  contact_email: "Contact email",
  contact_phone: "Contact phone",
  custom: "Contact custom field",
  tag: "Tag",
  lead_status: "Lead status",
  source: "Source",
  consent: "Consent",
  date: "Date (IST)",
  time: "Time (IST)",
};

export const OPERATORS = ["contains", "equals", "not_equals", "starts_with", "ends_with", "is_empty", "is_not_empty", "has", "not_has", "before", "after", "on"] as const;
export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABELS: Record<Operator, string> = {
  contains: "contains",
  equals: "equals",
  not_equals: "does not equal",
  starts_with: "starts with",
  ends_with: "ends with",
  is_empty: "is empty",
  is_not_empty: "is not empty",
  has: "has tag",
  not_has: "doesn't have tag",
  before: "is before",
  after: "is after",
  on: "is on",
};

const TEXT_OPS: Operator[] = ["contains", "equals", "not_equals", "starts_with", "ends_with", "is_empty", "is_not_empty"];
export const OPERATORS_FOR: Record<ConditionField, Operator[]> = {
  message: TEXT_OPS,
  contact_name: TEXT_OPS,
  contact_email: TEXT_OPS,
  contact_phone: TEXT_OPS,
  custom: TEXT_OPS,
  tag: ["has", "not_has"],
  lead_status: ["equals", "not_equals"],
  source: ["equals", "not_equals"],
  consent: ["equals", "not_equals"],
  date: ["before", "after", "on"],
  time: ["before", "after"],
};

export const LEAD_STATUS_VALUES = ["new", "contacted", "qualified", "proposal", "won", "lost"];
export const SOURCE_VALUES = ["manual", "whatsapp", "import", "api"];
export const CONSENT_VALUES = ["opted_in", "opted_out", "unknown"];

// ---------------------------------------------------------------------------
// Node data
// ---------------------------------------------------------------------------

export type ScheduleConfig = { frequency: "daily" | "weekly"; time: string; days: number[]; tagName: string };

export type TriggerData = {
  trigger: TriggerType;
  keywords: string[];
  match: "exact" | "contains" | "starts_with";
  buttonText: string;
  templateId: string;
  tagName: string;
  leadStatus: string;
  sources: string[];
  schedule: ScheduleConfig;
};
export type VariableMap = Record<string, { source: "static"; value: string } | { source: "field"; field: "name" | "first_name" | "phone" | "email" | "custom"; key: string; fallback: string }>;
export type OnError = "stop" | "continue";

export type NodeDataMap = {
  trigger: TriggerData;
  message: { text: string; buttons: string[]; waitForReply: boolean; replyTimeoutMinutes: number; fallbackTemplateId: string; onError: OnError };
  template: { templateId: string; variables: VariableMap; onError: OnError };
  delay: { amount: number; unit: "minutes" | "hours" | "days" };
  condition: { match: "all" | "any"; rules: { field: ConditionField; key: string; operator: Operator; value: string }[] };
  tag: { action: "add" | "remove"; tagName: string };
  assign: { mode: "user" | "auto"; userId: string };
  update_contact: { field: "name" | "email" | "leadStatus" | "lifecycle" | "custom"; key: string; value: string };
  webhook: { url: string; onError: OnError };
  ai_response: { instructions: string; sendReply: boolean; saveToField: string; onError: OnError };
  end: { label?: string };
};

export type FlowNode<T extends NodeType = NodeType> = { id: string; type: T; position: { x: number; y: number }; data: NodeDataMap[T] & { label?: string } };
export type FlowEdge = { id: string; source: string; target: string; sourceHandle?: string | null };
export type Graph = { nodes: FlowNode[]; edges: FlowEdge[] };

export const MAX_NODES = 100;
export const MAX_DELAY_MINUTES = 30 * 24 * 60;
export const MAX_REPLY_WAIT_MINUTES = 7 * 24 * 60;

export function defaultData<T extends NodeType>(type: T): NodeDataMap[T] {
  const d: { [K in NodeType]: NodeDataMap[K] } = {
    trigger: { trigger: "new_contact", keywords: [], match: "exact", buttonText: "", templateId: "", tagName: "", leadStatus: "", sources: ["whatsapp", "manual", "api"], schedule: { frequency: "daily", time: "10:00", days: [1, 2, 3, 4, 5], tagName: "" } },
    message: { text: "", buttons: [], waitForReply: false, replyTimeoutMinutes: 1440, fallbackTemplateId: "", onError: "stop" },
    template: { templateId: "", variables: {}, onError: "stop" },
    delay: { amount: 5, unit: "minutes" },
    condition: { match: "any", rules: [{ field: "message", key: "", operator: "contains", value: "" }] },
    tag: { action: "add", tagName: "" },
    assign: { mode: "auto", userId: "" },
    update_contact: { field: "leadStatus", key: "", value: "contacted" },
    webhook: { url: "", onError: "continue" },
    ai_response: { instructions: "", sendReply: true, saveToField: "", onError: "continue" },
    end: {},
  };
  return structuredClone(d[type]);
}

export function delayMinutes(d: NodeDataMap["delay"]) {
  return d.amount * (d.unit === "days" ? 1440 : d.unit === "hours" ? 60 : 1);
}

/** Outgoing handles a node type exposes. */
export function handlesOf(type: NodeType): string[] {
  if (type === "end") return [];
  if (type === "condition") return ["yes", "no"];
  return ["next"];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type GraphIssue = { nodeId?: string; message: string };

const isHttpsUrl = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && Boolean(x.hostname) && u.length <= 2000;
  } catch {
    return false;
  }
};

/** Structural + per-node checks. Publishing requires zero errors; there are no cycles, so no infinite loops. */
export function validateGraph(g: Graph): { errors: GraphIssue[]; warnings: GraphIssue[] } {
  const errors: GraphIssue[] = [];
  const warnings: GraphIssue[] = [];
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  if (g.nodes.length > MAX_NODES) errors.push({ message: `Automations can have at most ${MAX_NODES} steps.` });
  const triggers = g.nodes.filter((n) => n.type === "trigger");
  if (triggers.length !== 1) errors.push({ message: triggers.length ? "Use exactly one trigger." : "Add a trigger to start the automation." });
  for (const e of g.edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) errors.push({ message: "A connection points to a deleted step." });
    if (e.source === e.target) errors.push({ nodeId: e.source, message: "A step can't connect to itself." });
    const t = nodes.get(e.target);
    if (t?.type === "trigger") errors.push({ nodeId: t.id, message: "Nothing can connect into the trigger." });
  }
  // Each handle has at most one outgoing connection.
  const seen = new Set<string>();
  for (const e of g.edges) {
    const src = nodes.get(e.source);
    if (!src) continue;
    const h = src.type === "condition" ? (e.sourceHandle ?? "") : "next";
    if (!handlesOf(src.type).includes(h)) errors.push({ nodeId: src.id, message: src.type === "end" ? "End can't continue to another step." : "Connect from the Yes or No output." });
    const key = `${e.source}:${h}`;
    if (seen.has(key)) errors.push({ nodeId: src.id, message: "Each output can connect to one step only." });
    seen.add(key);
  }
  // Cycles (DFS) — loops are not allowed.
  const out = new Map<string, string[]>();
  for (const e of g.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const state = new Map<string, 1 | 2>();
  let cycle = false;
  const visit = (id: string) => {
    if (cycle) return;
    state.set(id, 1);
    for (const nx of out.get(id) ?? []) {
      if (state.get(nx) === 1) cycle = true;
      else if (!state.has(nx)) visit(nx);
    }
    state.set(id, 2);
  };
  for (const n of g.nodes) if (!state.has(n.id)) visit(n.id);
  if (cycle) errors.push({ message: "The flow loops back on itself. Loops aren't allowed — they could message customers forever." });
  // Reachability
  if (triggers.length === 1) {
    const reach = new Set<string>([triggers[0].id]);
    const stack = [triggers[0].id];
    while (stack.length) {
      for (const nx of out.get(stack.pop()!) ?? []) {
        if (reach.has(nx)) continue;
        reach.add(nx);
        stack.push(nx);
      }
    }
    for (const n of g.nodes) if (!reach.has(n.id)) errors.push({ nodeId: n.id, message: "This step isn't connected to the trigger." });
    if (!(out.get(triggers[0].id) ?? []).length) errors.push({ nodeId: triggers[0].id, message: "Connect the trigger to the first step." });
  }
  for (const n of g.nodes) {
    for (const m of nodeProblems(n)) errors.push({ nodeId: n.id, message: m });
    if (n.type === "condition") {
      for (const h of ["yes", "no"]) if (!g.edges.some((e) => e.source === n.id && e.sourceHandle === h)) warnings.push({ nodeId: n.id, message: `The “${h === "yes" ? "Yes" : "No"}” path isn't connected — the automation ends there.` });
    }
  }
  return { errors, warnings };
}

export function nodeProblems(n: FlowNode): string[] {
  const p: string[] = [];
  switch (n.type) {
    case "trigger": {
      const d = n.data as TriggerData;
      if (!(TRIGGER_TYPES as readonly string[]).includes(d.trigger)) p.push("Choose a trigger.");
      if (d.trigger === "keyword" && !d.keywords.filter((k) => k.trim()).length) p.push("Add at least one keyword.");
      if (d.trigger === "tag_added" && !d.tagName.trim()) p.push("Choose the tag.");
      if (d.trigger === "new_contact" && !d.sources.length) p.push("Pick at least one contact source.");
      if (d.trigger === "schedule") {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.schedule.time)) p.push("Schedule time must be HH:MM.");
        if (d.schedule.frequency === "weekly" && !d.schedule.days.length) p.push("Pick at least one weekday.");
        if (!d.schedule.tagName.trim()) p.push("Choose which tagged contacts the schedule runs for.");
      }
      break;
    }
    case "message": {
      const d = n.data as NodeDataMap["message"];
      if (!d.text.trim()) p.push("Write the message.");
      if (d.text.length > 1024) p.push("Messages with buttons/automation are limited to 1024 characters.");
      if (d.buttons.length > 3) p.push("Up to 3 reply buttons.");
      if (d.buttons.some((b) => !b.trim() || b.length > 20)) p.push("Button titles: 1–20 characters.");
      if (d.waitForReply && (d.replyTimeoutMinutes < 1 || d.replyTimeoutMinutes > MAX_REPLY_WAIT_MINUTES)) p.push("Wait for a reply between 1 minute and 7 days.");
      break;
    }
    case "template":
      if (!(n.data as NodeDataMap["template"]).templateId) p.push("Choose an approved template.");
      break;
    case "delay": {
      const d = n.data as NodeDataMap["delay"];
      const m = delayMinutes(d);
      if (!Number.isInteger(d.amount) || d.amount < 1 || m > MAX_DELAY_MINUTES) p.push("Delay must be between 1 minute and 30 days.");
      break;
    }
    case "condition": {
      const d = n.data as NodeDataMap["condition"];
      if (!d.rules.length) p.push("Add at least one rule.");
      for (const r of d.rules) {
        if (!(OPERATORS_FOR[r.field] ?? []).includes(r.operator)) p.push(`“${OPERATOR_LABELS[r.operator] ?? r.operator}” can't be used with ${CONDITION_FIELD_LABELS[r.field] ?? r.field}.`);
        if (r.field === "custom" && !r.key.trim()) p.push("Name the custom field.");
        if (r.operator !== "is_empty" && r.operator !== "is_not_empty" && !r.value.trim()) p.push("Every rule needs a value.");
        if (r.field === "date" && r.value && !/^\d{4}-\d{2}-\d{2}$/.test(r.value)) p.push("Dates use YYYY-MM-DD.");
        if (r.field === "time" && r.value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.value)) p.push("Times use HH:MM (24 h).");
      }
      break;
    }
    case "tag":
      if (!(n.data as NodeDataMap["tag"]).tagName.trim()) p.push("Choose a tag.");
      break;
    case "assign": {
      const d = n.data as NodeDataMap["assign"];
      if (d.mode === "user" && !d.userId) p.push("Choose a team member.");
      break;
    }
    case "update_contact": {
      const d = n.data as NodeDataMap["update_contact"];
      if (d.field === "custom" && !d.key.trim()) p.push("Name the custom field.");
      if (d.field === "leadStatus" && !LEAD_STATUS_VALUES.includes(d.value)) p.push("Choose a lead status.");
      if (d.field === "lifecycle" && !["lead", "customer"].includes(d.value)) p.push("Choose lead or customer.");
      break;
    }
    case "webhook":
      if (!isHttpsUrl((n.data as NodeDataMap["webhook"]).url)) p.push("Enter an https:// URL.");
      break;
    case "ai_response": {
      const d = n.data as NodeDataMap["ai_response"];
      if (!d.instructions.trim()) p.push("Tell the AI how to reply.");
      if (!d.sendReply && !d.saveToField.trim()) p.push("Send the reply, save it to a field, or both.");
      break;
    }
  }
  return p;
}

// ---------------------------------------------------------------------------
// Runtime helpers (shared by the engine and its tests)
// ---------------------------------------------------------------------------

export type EvalContact = { name: string; email: string; phone: string; customFields: Record<string, string>; tags: string[]; leadStatus: string; source: string; optInStatus: string };
export type EvalContext = { message: string; contact: EvalContact | null; now: Date };

const istParts = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`).getUTCDay() };
};
export const istNow = istParts;

function textOp(op: Operator, actual: string, expected: string): boolean {
  const a = actual.trim().toLowerCase();
  const e = expected.trim().toLowerCase();
  switch (op) {
    case "contains":
      // Comma-separated values match any of them ("website, web design").
      return e.split(",").map((x) => x.trim()).filter(Boolean).some((x) => a.includes(x));
    case "equals":
      return a === e;
    case "not_equals":
      return a !== e;
    case "starts_with":
      return a.startsWith(e);
    case "ends_with":
      return a.endsWith(e);
    case "is_empty":
      return !a;
    case "is_not_empty":
      return Boolean(a);
    default:
      return false;
  }
}

export function evaluateRule(r: NodeDataMap["condition"]["rules"][number], ctx: EvalContext): boolean {
  const c = ctx.contact;
  switch (r.field) {
    case "message":
      return textOp(r.operator, ctx.message, r.value);
    case "contact_name":
      return textOp(r.operator, c?.name ?? "", r.value);
    case "contact_email":
      return textOp(r.operator, c?.email ?? "", r.value);
    case "contact_phone":
      return textOp(r.operator, c?.phone ?? "", r.value);
    case "custom":
      return textOp(r.operator, c?.customFields[r.key] ?? "", r.value);
    case "tag": {
      const has = (c?.tags ?? []).some((t) => t.toLowerCase() === r.value.trim().toLowerCase());
      return r.operator === "has" ? has : !has;
    }
    case "lead_status":
    case "source":
    case "consent": {
      const v = r.field === "lead_status" ? c?.leadStatus : r.field === "source" ? c?.source : c?.optInStatus;
      return r.operator === "equals" ? v === r.value : v !== r.value;
    }
    case "date": {
      const today = istParts(ctx.now).date;
      return r.operator === "before" ? today < r.value : r.operator === "after" ? today > r.value : today === r.value;
    }
    case "time": {
      const now = istParts(ctx.now).time;
      return r.operator === "before" ? now < r.value : now > r.value;
    }
  }
}

export function evaluateCondition(d: NodeDataMap["condition"], ctx: EvalContext): boolean {
  const results = d.rules.map((r) => evaluateRule(r, ctx));
  return d.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** {{contact.first_name}}, {{contact.name}}, {{contact.phone}}, {{contact.email}}, {{contact.custom.city}}, {{reply}}, {{ai.response}}, {{trigger.text}} */
export function renderText(text: string, vars: { contact: EvalContact | null; reply: string; ai: string; trigger: string }): string {
  const c = vars.contact;
  return text.replace(/\{\{\s*([a-z_.]+[a-z0-9_]*)\s*\}\}/gi, (m, key: string) => {
    const k = key.toLowerCase();
    if (k === "contact.name") return c?.name || "there";
    if (k === "contact.first_name") return c?.name.trim().split(/\s+/)[0] || "there";
    if (k === "contact.phone") return c?.phone ?? "";
    if (k === "contact.email") return c?.email ?? "";
    if (k.startsWith("contact.custom.")) return c?.customFields[key.slice(15)] ?? "";
    if (k === "reply") return vars.reply;
    if (k === "ai.response") return vars.ai;
    if (k === "trigger.text") return vars.trigger;
    return m;
  });
}

export function keywordMatches(text: string, keywords: string[], match: TriggerData["match"]): boolean {
  const t = text.trim().toLowerCase();
  return keywords
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => (match === "exact" ? t === k : match === "starts_with" ? t.startsWith(k) : t.includes(k)));
}

// ---------------------------------------------------------------------------
// Demo workflow: New Contact → Welcome → Delay → Ask Requirement → Condition → Assign Sales
// ---------------------------------------------------------------------------

export function demoWorkflow(): Graph {
  const n = <T extends NodeType>(id: string, type: T, y: number, data: Partial<NodeDataMap[T]> & { label?: string }, x = 260): FlowNode<T> => ({
    id,
    type,
    position: { x, y },
    data: { ...defaultData(type), ...data },
  });
  const nodes: FlowNode[] = [
    n("trigger", "trigger", 0, { label: "New contact", trigger: "new_contact", sources: ["whatsapp", "manual", "api"] }),
    n("welcome", "message", 150, {
      label: "Welcome message",
      text: "Hi {{contact.first_name}} 👋 Welcome! Thanks for reaching out — we're glad you're here.",
      fallbackTemplateId: "",
    }),
    n("wait", "delay", 300, { label: "Short pause", amount: 2, unit: "minutes" }),
    n("ask", "message", 450, {
      label: "Ask requirement",
      text: "What are you looking for today? Tap an option or type your requirement.",
      buttons: ["Website", "Marketing", "Just browsing"],
      waitForReply: true,
      replyTimeoutMinutes: 1440,
    }),
    n("check", "condition", 620, {
      label: "Ready to buy?",
      match: "any",
      rules: [{ field: "message", key: "", operator: "contains", value: "website, marketing, price, quote, buy" }],
    }),
    n("sales", "assign", 800, { label: "Assign sales", mode: "auto", userId: "" }, 80),
    n("tag_lead", "tag", 950, { label: "Tag sales lead", action: "add", tagName: "Sales lead" }, 80),
    n("done", "end", 1100, { label: "End" }, 80),
    n("browse", "tag", 800, { label: "Tag browsing", action: "add", tagName: "Browsing" }, 440),
    n("done2", "end", 950, { label: "End" }, 440),
  ];
  const e = (source: string, target: string, sourceHandle: string | null = null): FlowEdge => ({ id: `e-${source}-${sourceHandle ?? "next"}-${target}`, source, target, sourceHandle });
  return {
    nodes,
    edges: [e("trigger", "welcome"), e("welcome", "wait"), e("wait", "ask"), e("ask", "check"), e("check", "sales", "yes"), e("sales", "tag_lead"), e("tag_lead", "done"), e("check", "browse", "no"), e("browse", "done2")],
  };
}
