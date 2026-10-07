/**
 * AI agent model + the rule-based DEMO engine. Pure (no DB, no network) so it
 * can be unit-tested and used by both the inbox engine and the test chat.
 *
 * The demo engine is NOT AI: it matches keywords against the agent's FAQs,
 * products, services and pricing. Everything it sends is labelled
 * "Demo AI — rule-based", and it only ever answers on demo numbers or in the
 * test chat. Real customers are only answered by the live (Claude) engine.
 */

export type KbItem = { name: string; description: string; price: string };
export type AiKnowledge = { faqs: { q: string; a: string }[]; products: KbItem[]; services: KbItem[]; pricing: string };
export type AiActionsConfig = {
  answer: boolean;
  qualify: boolean;
  collect: boolean;
  collectFields: string[];
  book: boolean;
  bookingServices: string[];
  transfer: boolean;
  summarize: boolean;
};
export type AiHandoffConfig = {
  keywords: string[];
  assign: "auto" | "user" | "queue";
  userId: string;
  message: string;
  resume: "manual" | "on_close" | "after_hours";
  resumeAfterHours: number;
};
export type AgentConfig = {
  name: string;
  businessName: string;
  instructions: string;
  knowledge: AiKnowledge;
  actions: AiActionsConfig;
  handoff: AiHandoffConfig;
  documents: { name: string; content: string }[];
};
export type ChatTurn = { role: "customer" | "business"; text: string };
export type KnownContact = { name: string; email: string; customFields: Record<string, string> };

export type AiAction =
  | { type: "answer"; source: string }
  | { type: "collect"; fields: Record<string, string> }
  | { type: "qualify"; status: "contacted" | "qualified" | "lost"; interest: string; reason: string }
  | { type: "book"; service: string; requestedFor: string; notes: string }
  | { type: "transfer"; reason: string };

export type AiTurn = {
  mode: "live" | "demo";
  reply: string;
  actions: AiAction[];
  handoff: { reason: string } | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export const AI_STATUS = ["draft", "active", "paused"] as const;
export const DEMO_LABEL = "Demo AI — rule-based, not production AI";
export const RESUME_LABELS: Record<AiHandoffConfig["resume"], string> = {
  manual: "Only when a teammate clicks “Resume AI”",
  on_close: "When the chat is closed",
  after_hours: "After a set number of hours without a teammate reply",
};
export const COLLECTABLE_FIELDS = ["name", "email", "city", "company", "budget", "requirement"] as const;

export const DEFAULT_KNOWLEDGE: AiKnowledge = { faqs: [], products: [], services: [], pricing: "" };
export const DEFAULT_ACTIONS: AiActionsConfig = { answer: true, qualify: true, collect: true, collectFields: ["name", "email", "city"], book: false, bookingServices: [], transfer: true, summarize: true };
export const DEFAULT_HANDOFF: AiHandoffConfig = {
  keywords: ["agent", "human", "talk to someone", "call me"],
  assign: "auto",
  userId: "",
  message: "Sure — I'm connecting you with our team. Someone will reply here shortly.",
  resume: "manual",
  resumeAfterHours: 24,
};

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    const v = JSON.parse(raw || "") as unknown;
    return v && typeof v === "object" ? ({ ...fallback, ...(v as object) } as T) : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const STOP = new Set(
  "the a an and or but is are was were be been to of in on at for with from by do does did can could would should will shall may might i you we they he she it my your our their me us them this that these those what which who whom whose when where why how please hi hello hey thanks thank ok okay yes no not any some there here have has had get got about tell know want need".split(
    " "
  )
);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w))
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

function overlap(a: string[], b: string[]) {
  const set = new Set(b);
  return [...new Set(a)].filter((w) => set.has(w)).length;
}

const wordRe = (k: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${k.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");

export function matchesKeyword(text: string, keywords: string[]): string | null {
  for (const k of keywords) if (k.trim() && wordRe(k).test(text)) return k.trim();
  return null;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const NAME = /\b(?:my name is|i am|i'm|this is|mera naam)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)?)/i;
const CITY = /\b(?:i(?:'m| am) from|i live in|based in|located in|city is)\s+([A-Za-z][A-Za-z '-]{1,40})/i;
const DATE = /\b(today|tomorrow|day after tomorrow|(?:next\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/i;
const TIME = /\b(\d{1,2}(?::\d{2})?\s?(?:am|pm)|morning|afternoon|evening)\b/i;
const BOOK_INTENT = /\b(book|booking|appointment|schedule|reserve|slot|visit|consultation)\b/i;
const PRICE_INTENT = /\b(price|prices|pricing|cost|costs|rate|rates|charges?|fees?|how much|kitna|kitne|quote)\b/i;
const BUY_INTENT = /\b(buy|purchase|order|interested|quote|demo|book|need|want|looking for)\b/i;
const NOT_INTERESTED = /\b(not interested|no thanks|too expensive|don't need)\b/i;

function stripStop(s: string) {
  const cut = s.split(/[,.!?;\n]|\s(?:and|but|email|phone)\s/i)[0] ?? s;
  return cut.trim().replace(/[.,!?]+$/, "");
}

function titleCase(s: string) {
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Demo (rule-based) engine
// ---------------------------------------------------------------------------

function bestFaq(text: string, faqs: AiKnowledge["faqs"]) {
  const t = tokens(text);
  let best: { q: string; a: string; score: number } | null = null;
  for (const f of faqs) {
    const qt = tokens(f.q);
    if (!qt.length) continue;
    const hit = overlap(t, qt);
    const score = hit / qt.length;
    if (hit >= 1 && (hit >= 2 || score >= 0.5) && (!best || score > best.score)) best = { ...f, score };
  }
  return best;
}

function findItems(text: string, items: KbItem[]) {
  const t = tokens(text);
  return items.filter((i) => {
    const n = tokens(i.name);
    return n.length > 0 && (wordRe(i.name).test(text) || overlap(t, n) >= Math.min(2, n.length));
  });
}

function describe(i: KbItem) {
  return `${i.name}${i.price ? ` — ${i.price}` : ""}${i.description ? `: ${i.description}` : ""}`;
}

/** Fields the agent may still ask for (configured, and not yet known for this contact). */
export function missingFields(cfg: AiActionsConfig, known: KnownContact): string[] {
  if (!cfg.collect) return [];
  return cfg.collectFields.filter((f) => {
    if (f === "name") return !known.name.trim();
    if (f === "email") return !known.email.trim();
    return !String(known.customFields[f] ?? "").trim();
  });
}

/**
 * Rule-based reply. Order: human handoff keyword → information shared →
 * booking → FAQ → product/service → pricing → fallback.
 */
export function demoRespond(cfg: AgentConfig, message: string, known: KnownContact): AiTurn {
  const actions: AiAction[] = [];
  const parts: string[] = [];
  const turn = (reply: string, handoff: AiTurn["handoff"] = null): AiTurn => ({ mode: "demo", reply: reply.slice(0, 4096), actions, handoff, model: "demo-rules", inputTokens: 0, outputTokens: 0 });

  // 1. Human handoff.
  const kw = cfg.actions.transfer ? matchesKeyword(message, cfg.handoff.keywords) : null;
  if (kw) {
    const reason = `Customer asked for a person (“${kw}”).`;
    actions.push({ type: "transfer", reason });
    return turn(cfg.handoff.message, { reason });
  }

  // 2. Information the customer shared.
  if (cfg.actions.collect) {
    const fields: Record<string, string> = {};
    const want = new Set(cfg.actions.collectFields);
    const email = message.match(EMAIL)?.[0];
    if (email && want.has("email")) fields.email = email.toLowerCase();
    const name = message.match(NAME)?.[1];
    if (name && want.has("name") && !/^(interested|looking|from|here|fine|good)\b/i.test(name)) fields.name = titleCase(stripStop(name));
    const city = message.match(CITY)?.[1];
    if (city && want.has("city")) fields.city = titleCase(stripStop(city));
    if (Object.keys(fields).length) {
      actions.push({ type: "collect", fields });
      known = { name: fields.name ?? known.name, email: fields.email ?? known.email, customFields: { ...known.customFields, ...(fields.city ? { city: fields.city } : {}) } };
      parts.push(`Thanks${fields.name ? `, ${fields.name.split(" ")[0]}` : ""} — noted.`);
    }
  }

  // 3. Booking.
  if (cfg.actions.book && BOOK_INTENT.test(message)) {
    const services = cfg.actions.bookingServices.length ? cfg.actions.bookingServices : cfg.knowledge.services.map((s) => s.name);
    const service = services.find((s) => wordRe(s).test(message)) ?? (services.length === 1 ? services[0] : "");
    const date = message.match(DATE)?.[1] ?? "";
    const time = message.match(TIME)?.[1] ?? "";
    if (service && date) {
      const requestedFor = [date, time].filter(Boolean).join(" ");
      actions.push({ type: "book", service, requestedFor, notes: message.slice(0, 300) });
      if (cfg.actions.qualify) actions.push({ type: "qualify", status: "qualified", interest: service, reason: "Customer asked to book." });
      parts.push(`I've requested ${service} for ${requestedFor}. Our team will confirm the exact slot with you shortly.`);
      return turn(parts.join(" "));
    }
    const need = [!service && services.length ? `which service (${services.slice(0, 5).join(", ")})` : "", !date ? "your preferred date and time" : ""].filter(Boolean);
    parts.push(`Happy to book that for you. Please tell me ${need.join(" and ") || "a few more details"}.`);
    return turn(parts.join(" "));
  }

  // 4. Answers from the knowledge base.
  let answered = false;
  if (cfg.actions.answer) {
    const faq = bestFaq(message, cfg.knowledge.faqs);
    if (faq) {
      parts.push(faq.a);
      actions.push({ type: "answer", source: `FAQ: ${faq.q}` });
      answered = true;
    }
    if (!answered) {
      const items = [...findItems(message, cfg.knowledge.products), ...findItems(message, cfg.knowledge.services)].slice(0, 3);
      if (items.length) {
        parts.push(items.map(describe).join("\n"));
        actions.push({ type: "answer", source: `Catalogue: ${items.map((i) => i.name).join(", ")}` });
        answered = true;
      }
    }
    if (!answered && PRICE_INTENT.test(message)) {
      const priced = [...cfg.knowledge.products, ...cfg.knowledge.services].filter((i) => i.price).slice(0, 5);
      const text = cfg.knowledge.pricing.trim() || (priced.length ? priced.map((i) => `${i.name} — ${i.price}`).join("\n") : "");
      if (text) {
        parts.push(text);
        actions.push({ type: "answer", source: "Pricing" });
        answered = true;
      }
    }
  }

  // 5. Lead qualification from intent words.
  if (cfg.actions.qualify) {
    if (NOT_INTERESTED.test(message)) actions.push({ type: "qualify", status: "lost", interest: "", reason: "Customer said they are not interested." });
    else if (BUY_INTENT.test(message) || PRICE_INTENT.test(message)) actions.push({ type: "qualify", status: "qualified", interest: message.slice(0, 120), reason: "Customer showed buying intent." });
  }

  if (!parts.length) {
    parts.push(
      cfg.actions.transfer
        ? `I'm not sure about that one. Reply “${cfg.handoff.keywords[0] ?? "agent"}” and a team member will help you.`
        : "I'm not sure about that one — could you rephrase, or ask about our products, services or pricing?"
    );
  } else {
    const missing = missingFields(cfg.actions, known);
    if (answered && missing.length) parts.push(`By the way, may I have your ${missing[0]}?`);
  }
  return turn(parts.join("\n\n"));
}

/** Extractive summary for demo mode — clearly not an AI summary. */
export function demoSummary(history: ChatTurn[], known: KnownContact): string {
  const customer = history.filter((t) => t.role === "customer").map((t) => t.text.trim()).filter(Boolean);
  const lines = [`[Demo summary — rule-based, not AI] ${customer.length} customer message(s).`];
  if (customer.length) lines.push(`First: “${customer[0].slice(0, 160)}”`);
  if (customer.length > 1) lines.push(`Latest: “${customer.at(-1)!.slice(0, 160)}”`);
  const facts = [known.name && `name ${known.name}`, known.email && `email ${known.email}`, ...Object.entries(known.customFields).slice(0, 4).map(([k, v]) => `${k} ${v}`)].filter(Boolean);
  if (facts.length) lines.push(`Known: ${facts.join(", ")}.`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Live (Claude) prompt pieces — pure so they can be tested
// ---------------------------------------------------------------------------

export const MAX_DOC_CHARS = 60_000;

export function knowledgeText(cfg: AgentConfig): string {
  const k = cfg.knowledge;
  const out: string[] = [];
  if (k.faqs.length) out.push("## FAQs\n" + k.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n"));
  if (k.products.length) out.push("## Products\n" + k.products.map((p) => `- ${describe(p)}`).join("\n"));
  if (k.services.length) out.push("## Services\n" + k.services.map((p) => `- ${describe(p)}`).join("\n"));
  if (k.pricing.trim()) out.push("## Pricing\n" + k.pricing.trim());
  let budget = MAX_DOC_CHARS;
  for (const d of cfg.documents) {
    if (budget <= 0) break;
    const body = d.content.slice(0, budget);
    budget -= body.length;
    out.push(`## Document: ${d.name}\n${body}`);
  }
  return out.join("\n\n") || "(No knowledge base yet.)";
}

export function systemPrompt(cfg: AgentConfig): string {
  const a = cfg.actions;
  const rules = [
    `You are "${cfg.name}", the WhatsApp assistant for ${cfg.businessName || "this business"}. You are talking to a customer on WhatsApp.`,
    "Write short, friendly plain-text messages (at most 4 sentences, no markdown headings or tables). Match the customer's language.",
    "Only state facts, prices, availability or policies found in the business instructions or knowledge base below. If you don't know, say so and offer to connect a team member — never guess.",
    a.collect && a.collectFields.length ? `When it fits naturally, collect: ${a.collectFields.join(", ")}. Save anything the customer shares with save_contact_info. Ask for at most one missing detail per message.` : "",
    a.qualify ? "When the customer's intent is clear, record it with qualify_lead (qualified = wants to buy/book, contacted = just browsing, lost = not interested)." : "",
    a.book ? `You can request appointments with book_appointment once you know the service${a.bookingServices.length ? ` (one of: ${a.bookingServices.join(", ")})` : ""} and the customer's preferred date/time. Say the team will confirm the exact slot — never promise a confirmed time.` : "Do not book appointments; offer to connect the team instead.",
    a.transfer ? "If the customer asks for a person, is upset, or needs something you can't handle, call transfer_to_human." : "",
    "Never ask for passwords, card numbers, OTPs or other sensitive data.",
  ].filter(Boolean);
  return `${rules.join("\n")}\n\n# Business instructions\n${cfg.instructions.trim() || "(none)"}\n\n# Knowledge base\n${knowledgeText(cfg)}`;
}
