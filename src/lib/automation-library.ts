// Ready-made automations. Each one is a normal graph the user opens in the builder and edits freely.
// The longer conversation flows are part of the paid "Ready-made automations" service (AUTOMATION_PACK).

import { defaultData, demoWorkflow, type FlowEdge, type FlowNode, type Graph, type NodeDataMap, type NodeType } from "@/lib/automations";

export type LibraryTemplate = {
  id: string;
  name: string;
  description: string;
  /** What the customer goes through, in plain words (shown on the card). */
  steps: string[];
  premium: boolean;
  graph: () => Graph;
};

/** Small helper to lay a graph out top-to-bottom with optional side branches. */
function builder() {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const node = <T extends NodeType>(id: string, type: T, x: number, y: number, data: Partial<NodeDataMap[T]> & { label?: string }) => {
    nodes.push({ id, type, position: { x, y }, data: { ...defaultData(type), ...data } } as FlowNode);
    return id;
  };
  const link = (source: string, target: string, sourceHandle: string | null = null) => {
    edges.push({ id: `e-${source}-${sourceHandle ?? "next"}-${target}`, source, target, sourceHandle });
  };
  const chain = (...ids: string[]) => ids.slice(1).forEach((id, i) => link(ids[i], id));
  return { node, link, chain, graph: (): Graph => ({ nodes, edges }) };
}

const ask = (text: string, buttons: string[] = [], replyTimeoutMinutes = 60): Partial<NodeDataMap["message"]> => ({ text, buttons, waitForReply: true, replyTimeoutMinutes });
const saveReply = (key: string): Partial<NodeDataMap["update_contact"]> => ({ field: "custom", key, value: "{{reply}}" });
const replyHas = (value: string): Partial<NodeDataMap["condition"]> => ({ match: "any", rules: [{ field: "message", key: "", operator: "contains", value }] });

function leadQualification(): Graph {
  const b = builder();
  const L = 80;
  const R = 460;
  const M = 260;
  b.node("t", "trigger", M, 0, { label: "New WhatsApp contact", trigger: "new_contact", sources: ["whatsapp"] });
  b.node("hi", "message", M, 140, { label: "Welcome", text: "Hi {{contact.first_name}} 👋 Thanks for contacting us! I'll ask 4 quick questions so the right person can help you." });
  b.node("q_name", "message", M, 280, { label: "Ask name", ...ask("First, what's your full name?") });
  b.node("has_name", "condition", M, 420, { label: "Answered?", match: "all", rules: [{ field: "message", key: "", operator: "is_not_empty", value: "" }] });
  b.node("s_name", "update_contact", L, 560, { label: "Save name", field: "name", value: "{{reply}}" });
  b.node("q_city", "message", M, 700, { label: "Ask city", ...ask("Thanks! Which city are you in?") });
  b.node("s_city", "update_contact", M, 840, { label: "Save city", ...saveReply("city") });
  b.node("q_need", "message", M, 980, { label: "Ask requirement", ...ask("What are you looking for? Tap an option or type it.", ["Product / service", "Price list", "Talk to team"]) });
  b.node("s_need", "update_contact", M, 1120, { label: "Save requirement", ...saveReply("requirement") });
  b.node("wants_team", "condition", M, 1260, { label: "Wants a person?", ...replyHas("talk, team, call, human, agent") });
  // Straight to a person
  b.node("tag_call", "tag", L, 1400, { label: "Tag: wants a call", action: "add", tagName: "Wants a call" });
  b.node("assign_call", "assign", L, 1540, { label: "Assign team", mode: "auto" });
  b.node("bye_call", "message", L, 1680, { label: "Hand over", text: "Connecting you to our team now. Someone will reply here shortly 🙏" });
  b.node("end_call", "end", L, 1820, { label: "End" });
  // Keep qualifying
  b.node("q_budget", "message", R, 1400, { label: "Ask budget", ...ask("What budget do you have in mind?", ["Under ₹10k", "₹10k–₹50k", "₹50k+"]) });
  b.node("s_budget", "update_contact", R, 1540, { label: "Save budget", ...saveReply("budget") });
  b.node("q_when", "message", R, 1680, { label: "Ask timeline", ...ask("When do you want to start?", ["This week", "This month", "Just exploring"]) });
  b.node("s_when", "update_contact", R, 1820, { label: "Save timeline", ...saveReply("timeline") });
  b.node("is_hot", "condition", R, 1960, { label: "Hot lead?", ...replyHas("week, today, urgent, asap") });
  b.node("tag_hot", "tag", L + 120, 2100, { label: "Tag: hot lead", action: "add", tagName: "Hot lead" });
  b.node("st_hot", "update_contact", L + 120, 2240, { label: "Status: qualified", field: "leadStatus", value: "qualified" });
  b.node("assign_hot", "assign", L + 120, 2380, { label: "Assign sales", mode: "auto" });
  b.node("bye_hot", "message", L + 120, 2520, { label: "Hot reply", text: "Great, {{contact.first_name}}! 🙌 Our team will call you today about your {{contact.custom.requirement}}." });
  b.node("end_hot", "end", L + 120, 2660, { label: "End" });
  b.node("tag_warm", "tag", R + 260, 2100, { label: "Tag: warm lead", action: "add", tagName: "Warm lead" });
  b.node("st_warm", "update_contact", R + 260, 2240, { label: "Status: contacted", field: "leadStatus", value: "contacted" });
  b.node("bye_warm", "message", R + 260, 2380, { label: "Warm reply", text: "Thanks {{contact.first_name}}! We've noted your requirement ({{contact.custom.budget}}). We'll share details soon. Reply anytime with questions." });
  b.node("end_warm", "end", R + 260, 2520, { label: "End" });

  b.chain("t", "hi", "q_name", "has_name");
  b.link("has_name", "s_name", "yes");
  b.link("has_name", "q_city", "no");
  b.chain("s_name", "q_city", "s_city", "q_need", "s_need", "wants_team");
  b.link("wants_team", "tag_call", "yes");
  b.chain("tag_call", "assign_call", "bye_call", "end_call");
  b.link("wants_team", "q_budget", "no");
  b.chain("q_budget", "s_budget", "q_when", "s_when", "is_hot");
  b.link("is_hot", "tag_hot", "yes");
  b.chain("tag_hot", "st_hot", "assign_hot", "bye_hot", "end_hot");
  b.link("is_hot", "tag_warm", "no");
  b.chain("tag_warm", "st_warm", "bye_warm", "end_warm");
  return b.graph();
}

function appointmentBooking(): Graph {
  const b = builder();
  const M = 260;
  b.node("t", "trigger", M, 0, { label: "Keyword: book", trigger: "keyword", keywords: ["book", "appointment", "booking", "slot", "visit"], match: "contains" });
  b.node("hi", "message", M, 140, { label: "Start", text: "Sure, {{contact.first_name}}! Let's book your appointment 📅" });
  b.node("q_service", "message", M, 280, { label: "Ask service", ...ask("What is it for?", ["Consultation", "Service visit", "Demo"]) });
  b.node("s_service", "update_contact", M, 420, { label: "Save service", ...saveReply("service") });
  b.node("q_day", "message", M, 560, { label: "Ask day", ...ask("Which day suits you?", ["Today", "Tomorrow", "Pick a date"]) });
  b.node("s_day", "update_contact", M, 700, { label: "Save day", ...saveReply("day") });
  b.node("pick", "condition", M, 840, { label: "Picking a date?", ...replyHas("pick, date, other") });
  b.node("q_date", "message", 520, 980, { label: "Ask date", ...ask("Please type your preferred date, e.g. 25 Oct.") });
  b.node("s_date", "update_contact", 520, 1120, { label: "Save date", ...saveReply("day") });
  b.node("q_time", "message", M, 1260, { label: "Ask time", ...ask("What time works best?", ["Morning", "Afternoon", "Evening"]) });
  b.node("s_time", "update_contact", M, 1400, { label: "Save time", ...saveReply("time") });
  b.node("confirm", "message", M, 1540, { label: "Confirm request", text: "✅ Request received: {{contact.custom.service}} on {{contact.custom.day}} ({{contact.custom.time}}). Our team will confirm the exact time shortly." });
  b.node("tag", "tag", M, 1680, { label: "Tag: appointment", action: "add", tagName: "Appointment request" });
  b.node("assign", "assign", M, 1820, { label: "Assign team", mode: "auto" });
  b.node("end", "end", M, 1960, { label: "End" });
  b.chain("t", "hi", "q_service", "s_service", "q_day", "s_day", "pick");
  b.link("pick", "q_date", "yes");
  b.chain("q_date", "s_date", "q_time");
  b.link("pick", "q_time", "no");
  b.chain("q_time", "s_time", "confirm", "tag", "assign", "end");
  return b.graph();
}

function productEnquiry(): Graph {
  const b = builder();
  const L = 80;
  const R = 460;
  const M = 260;
  b.node("t", "trigger", M, 0, { label: "Keyword: price", trigger: "keyword", keywords: ["price", "rate", "catalogue", "catalog", "menu", "details", "cost"], match: "contains" });
  b.node("q_cat", "message", M, 140, { label: "Ask category", ...ask("Happy to help! Which one are you interested in?", ["Category 1", "Category 2", "Category 3"]) });
  b.node("s_cat", "update_contact", M, 280, { label: "Save interest", ...saveReply("interest") });
  b.node("info", "message", M, 420, { label: "Share details (edit me)", text: "Here are the details for {{contact.custom.interest}}:\n• Option A – ₹____\n• Option B – ₹____\n• Option C – ₹____\n\n(Edit this message with your real items and prices.)" });
  b.node("q_next", "message", M, 560, { label: "Ask next step", ...ask("Would you like to order or get a call back?", ["Order now", "Call me", "Later"], 240) });
  b.node("ready", "condition", M, 700, { label: "Ready?", ...replyHas("order, call, yes, buy") });
  b.node("tag_int", "tag", L, 840, { label: "Tag: interested", action: "add", tagName: "Interested" });
  b.node("st_int", "update_contact", L, 980, { label: "Status: proposal", field: "leadStatus", value: "proposal" });
  b.node("assign", "assign", L, 1120, { label: "Assign sales", mode: "auto" });
  b.node("bye_int", "message", L, 1260, { label: "Thank you", text: "Thank you! Our team will contact you in a few minutes 🙏" });
  b.node("end_int", "end", L, 1400, { label: "End" });
  b.node("tag_later", "tag", R, 840, { label: "Tag: follow up", action: "add", tagName: "Follow up" });
  b.node("bye_later", "message", R, 980, { label: "No problem", text: "No problem! Reply anytime and we'll help you." });
  b.node("wait", "delay", R, 1120, { label: "Wait 20 hours", amount: 20, unit: "hours" });
  b.node("nudge", "message", R, 1260, { label: "Follow-up", ...ask("Hi {{contact.first_name}}, still interested in {{contact.custom.interest}}? Reply YES and we'll call you.", [], 1440) });
  b.node("yes", "condition", R, 1400, { label: "Said yes?", ...replyHas("yes, ok, call, haan, ha") });
  b.node("assign2", "assign", R - 120, 1540, { label: "Assign sales", mode: "auto" });
  b.node("end2", "end", R - 120, 1680, { label: "End" });
  b.node("end3", "end", R + 200, 1540, { label: "End" });
  b.chain("t", "q_cat", "s_cat", "info", "q_next", "ready");
  b.link("ready", "tag_int", "yes");
  b.chain("tag_int", "st_int", "assign", "bye_int", "end_int");
  b.link("ready", "tag_later", "no");
  b.chain("tag_later", "bye_later", "wait", "nudge", "yes");
  b.link("yes", "assign2", "yes");
  b.chain("assign2", "end2");
  b.link("yes", "end3", "no");
  return b.graph();
}

function feedback(): Graph {
  const b = builder();
  const L = 80;
  const R = 440;
  const M = 260;
  b.node("t", "trigger", M, 0, { label: "Tag added: Order delivered", trigger: "tag_added", tagName: "Order delivered" });
  b.node("wait", "delay", M, 140, { label: "Wait 2 hours", amount: 2, unit: "hours" });
  b.node("q_rate", "message", M, 280, { label: "Ask rating", ...ask("Hi {{contact.first_name}}! How was your experience with us?", ["Excellent 😍", "Good 🙂", "Not happy 😞"], 1440) });
  b.node("s_rate", "update_contact", M, 420, { label: "Save rating", ...saveReply("rating") });
  b.node("bad", "condition", M, 560, { label: "Unhappy?", ...replyHas("not happy, bad, poor, worst") });
  b.node("tag_bad", "tag", L, 700, { label: "Tag: unhappy", action: "add", tagName: "Unhappy customer" });
  b.node("assign", "assign", L, 840, { label: "Assign team", mode: "auto" });
  b.node("sorry", "message", L, 980, { label: "Apologise", text: "We're really sorry 🙏 A team member will call you to make it right." });
  b.node("end_bad", "end", L, 1120, { label: "End" });
  b.node("tag_good", "tag", R, 700, { label: "Tag: happy", action: "add", tagName: "Happy customer" });
  b.node("review", "message", R, 840, { label: "Ask for review (edit link)", text: "Thank you so much! 💚 It would mean a lot if you left us a Google review: https://g.page/r/YOUR-REVIEW-LINK" });
  b.node("end_good", "end", R, 980, { label: "End" });
  b.chain("t", "wait", "q_rate", "s_rate", "bad");
  b.link("bad", "tag_bad", "yes");
  b.chain("tag_bad", "assign", "sorry", "end_bad");
  b.link("bad", "tag_good", "no");
  b.chain("tag_good", "review", "end_good");
  return b.graph();
}


// ---------------------------------------------------------------------------
// Drip campaigns: a series of messages over days that stops as soon as the customer replies.
// Each step waits for a reply; a reply hands the chat to the team, silence moves to the next step.
// After 24 hours WhatsApp only allows approved templates, so every later step needs a fallback template.
// ---------------------------------------------------------------------------
const DAY = 1440;
const replied: Partial<NodeDataMap["condition"]> = { match: "all", rules: [{ field: "message", key: "", operator: "is_not_empty", value: "" }] };
const saidStop: Partial<NodeDataMap["condition"]> = replyHas("stop, not interested, no thanks, unsubscribe, band karo, nahi chahida");

/** Shared ending for every drip: a reply stops the series, "stop" marks them not interested, anything else goes to the team. */
function dripEnds(b: ReturnType<typeof builder>, x: number, y: number, hotTag: string) {
  b.node("stop_q", "condition", x, y, { label: "Said stop?", ...saidStop });
  b.node("tag_no", "tag", x - 200, y + 140, { label: "Tag: not interested", action: "add", tagName: "Not interested" });
  b.node("st_lost", "update_contact", x - 200, y + 280, { label: "Status: lost", field: "leadStatus", value: "lost" });
  b.node("bye_no", "message", x - 200, y + 420, { label: "Polite goodbye", text: "No problem at all, {{contact.first_name}} 🙏 We won't message you about this again." });
  b.node("end_no", "end", x - 200, y + 560, { label: "End" });
  b.node("tag_hot", "tag", x + 200, y + 140, { label: `Tag: ${hotTag}`, action: "add", tagName: hotTag });
  b.node("assign", "assign", x + 200, y + 280, { label: "Assign team", mode: "auto" });
  b.node("bye_hot", "message", x + 200, y + 420, { label: "Team will reply", text: "Thanks {{contact.first_name}}! 🙌 Someone from our team will reply here shortly." });
  b.node("end_hot", "end", x + 200, y + 560, { label: "End" });
  b.link("stop_q", "tag_no", "yes");
  b.chain("tag_no", "st_lost", "bye_no", "end_no");
  b.link("stop_q", "tag_hot", "no");
  b.chain("tag_hot", "assign", "bye_hot", "end_hot");
  return "stop_q";
}

type DripStep = { id: string; label: string; text: string; buttons?: string[]; waitDays: number };
/** Lays out trigger → [step → replied?]… → no-reply ending, with every "replied" going to the shared ending. */
function drip(trigger: Partial<NodeDataMap["trigger"]> & { label: string }, steps: DripStep[], hotTag: string, quietTag: string, before: ((b: ReturnType<typeof builder>) => [first: string, last: string, lastHandle: string]) | null = null): Graph {
  const b = builder();
  const M = 260;
  b.node("t", "trigger", M, 0, trigger);
  let prev = "t";
  let prevHandle: string | null = null;
  let y = 140;
  if (before) {
    const [first, last, lastHandle] = before(b);
    b.link("t", first);
    prev = last;
    prevHandle = lastHandle;
    y = 420;
  }
  const ends = dripEnds(b, M + 560, 140, hotTag);
  for (const s of steps) {
    b.node(s.id, "message", M, y, { label: s.label, ...ask(s.text, s.buttons ?? [], s.waitDays * DAY) });
    b.node(`${s.id}_r`, "condition", M, y + 140, { label: "Replied?", ...replied });
    b.link(prev, s.id, prevHandle);
    b.link(s.id, `${s.id}_r`);
    b.link(`${s.id}_r`, ends, "yes");
    prev = `${s.id}_r`;
    prevHandle = "no";
    y += 280;
  }
  b.node("tag_quiet", "tag", M, y, { label: `Tag: ${quietTag}`, action: "add", tagName: quietTag });
  b.node("end_quiet", "end", M, y + 140, { label: "End" });
  b.link(prev, "tag_quiet", "no");
  b.link("tag_quiet", "end_quiet");
  return b.graph();
}

const leadNurture = () =>
  drip({ label: "Tag added: New lead", trigger: "tag_added", tagName: "New lead" }, [
    { id: "d0", label: "Day 0 · Welcome", text: "Hi {{contact.first_name}} 👋 Thanks for your interest in us! I'm happy to share prices, timings or anything else. What would you like to know?", buttons: ["Send details", "Call me", "Not now"], waitDays: 1 },
    { id: "d1", label: "Day 1 · Why us (needs fallback template)", text: "Hi {{contact.first_name}}, a quick note on why customers choose us: (edit) fast service, fair prices, and real support on WhatsApp. Want me to send the details?", buttons: ["Yes, send", "Call me"], waitDays: 2 },
    { id: "d3", label: "Day 3 · Customer story (needs fallback template)", text: "Hi {{contact.first_name}}, (edit) one of our customers in your city started with us last month and now saves hours every week. Happy to show you how. Shall we talk?", buttons: ["Yes", "Later"], waitDays: 4 },
    { id: "d7", label: "Day 7 · Last check (needs fallback template)", text: "Hi {{contact.first_name}}, just checking one last time. If you'd like details or a call, reply here anytime. If not, no worries, reply STOP and we won't message again.", waitDays: 1 },
  ], "Hot lead", "Nurture: no reply");

const quoteFollowUp = () =>
  drip(
    { label: "Tag added: Quote sent", trigger: "tag_added", tagName: "Quote sent" },
    [
      { id: "q1", label: "Did you see the quote?", text: "Hi {{contact.first_name}}, did you get a chance to look at the quote we sent? Happy to answer any question or adjust it for you.", buttons: ["Go ahead", "Need a call", "Not now"], waitDays: 2 },
      { id: "q2", label: "Gentle reminder (needs fallback template)", text: "Hi {{contact.first_name}}, a gentle reminder about your quote. (edit) Prices are held till the end of this week. Shall we go ahead?", buttons: ["Yes", "Call me"], waitDays: 3 },
      { id: "q3", label: "Final follow-up (needs fallback template)", text: "Hi {{contact.first_name}}, closing your quote for now. If you'd like to restart anytime, just reply here 🙏", waitDays: 1 },
    ],
    "Quote: interested",
    "Quote: no reply",
    (b) => {
      b.node("wait", "delay", 260, 140, { label: "Wait 1 day", amount: 1, unit: "days" });
      b.node("done", "condition", 260, 280, { label: "Already won or lost?", match: "any", rules: [{ field: "lead_status", key: "", operator: "equals", value: "won" }, { field: "lead_status", key: "", operator: "equals", value: "lost" }] });
      b.node("end_done", "end", 20, 420, { label: "End" });
      b.link("wait", "done");
      b.link("done", "end_done", "yes");
      return ["wait", "done", "no"];
    }
  );

const winBack = () =>
  drip({ label: "Tag added: Win back", trigger: "tag_added", tagName: "Win back" }, [
    { id: "w1", label: "We miss you (needs fallback template)", text: "Hi {{contact.first_name}}, it's been a while! 💚 (edit) Here's 10% off your next order, just for you. Reply YES to use it.", buttons: ["Yes, use it", "Not now"], waitDays: 4 },
    { id: "w2", label: "Offer reminder (needs fallback template)", text: "Hi {{contact.first_name}}, your 10% offer ends in 3 days. Reply YES and we'll set it up for you.", buttons: ["Yes"], waitDays: 3 },
  ], "Win back: interested", "Win back: no reply");

const festivalDrip = () =>
  drip({ label: "Tag added: Festival offer", trigger: "tag_added", tagName: "Festival offer" }, [
    { id: "f1", label: "Offer launch (needs fallback template)", text: "Hi {{contact.first_name}} 🪔 Our festival offer is live! (edit) Flat ___% off on ___ till ___. Want me to reserve it for you?", buttons: ["Reserve it", "Show details", "Not now"], waitDays: 2 },
    { id: "f2", label: "Few days left (needs fallback template)", text: "Hi {{contact.first_name}}, only a few days left on our festival offer. Reply and we'll book it for you before it ends.", buttons: ["Book it"], waitDays: 2 },
    { id: "f3", label: "Last day (needs fallback template)", text: "Last day of the festival offer, {{contact.first_name}}! Reply now and we'll hold it for you 🙏", waitDays: 1 },
  ], "Festival: interested", "Festival: no reply");

/**
 * Utility reply → free offer. A genuine utility template (reminder, order update…) with a button gets a reply; the
 * reply opens WhatsApp's 24-hour window, so the offer goes as a free-form message (no template charge).
 */
function utilityToOffer(): Graph {
  const b = builder();
  const M = 260;
  b.node("t", "trigger", M, 0, { label: "Reply to a utility template", trigger: "template_reply", templateId: "" });
  b.node("thanks", "message", M, 140, { label: "Answer + offer (free)", text: "Thanks {{contact.first_name}}! ✅ (edit: answer their reply, e.g. “Your appointment is confirmed.”)\n\nBy the way, (edit) this week you get 15% off on ___. Want me to book it for you?", buttons: ["Yes, book it", "Send details", "Not now"], waitForReply: true, replyTimeoutMinutes: 720 });
  b.node("interested", "condition", M, 300, { label: "Interested?", ...replyHas("yes, book, details, price, interested") });
  b.node("tag", "tag", 80, 450, { label: "Tag: offer interested", action: "add", tagName: "Offer interested" });
  b.node("assign", "assign", 80, 590, { label: "Assign sales", mode: "auto" });
  b.node("handover", "message", 80, 730, { label: "Hand over (free)", text: "Great! Someone from our team will message you here in a few minutes 🙏" });
  b.node("end1", "end", 80, 870, { label: "End" });
  b.node("bye", "message", 460, 450, { label: "No worries (free)", text: "No problem! Reply here anytime if you need anything 🙂" });
  b.node("end2", "end", 460, 590, { label: "End" });
  b.chain("t", "thanks", "interested");
  b.link("interested", "tag", "yes");
  b.chain("tag", "assign", "handover", "end1");
  b.link("interested", "bye", "no");
  b.chain("bye", "end2");
  return b.graph();
}

export const AUTOMATION_LIBRARY: LibraryTemplate[] = [
  {
    id: "utility_to_offer",
    name: "Utility reply → free offer (save on marketing charges)",
    description: "Send a genuine utility template (reminder, order update) with a button. When the customer replies, the 24-hour window opens and your offer goes as a free message — no marketing template charge. Pick your utility template in the trigger.",
    steps: ["Customer replies to your utility template", "Answer + offer (free message)", "Interested → tag + assign sales", "Not now → polite close"],
    premium: false,
    graph: utilityToOffer,
  },
  {
    id: "demo_welcome",
    name: "Welcome & route to sales",
    description: "A short welcome for every new contact that sends interested people to your team.",
    steps: ["Welcome", "Ask what they need", "Interested → assign sales", "Others → tag Browsing"],
    premium: false,
    graph: demoWorkflow,
  },
  {
    id: "lead_qualification",
    name: "Lead qualification (long chat)",
    description: "Asks name, city, requirement, budget and timeline, saves every answer on the contact, then hands hot leads to sales.",
    steps: ["Welcome", "Name → city → requirement", "Wants a call? → assign now", "Budget → timeline", "Hot lead → qualified + assign", "Warm lead → tag + follow-up note"],
    premium: true,
    graph: leadQualification,
  },
  {
    id: "appointment_booking",
    name: "Appointment booking",
    description: "When someone types “book” or “appointment”: service, day (or a date), time slot, then a confirmation and your team is assigned.",
    steps: ["Service", "Day or custom date", "Time slot", "Confirmation", "Tag + assign"],
    premium: true,
    graph: appointmentBooking,
  },
  {
    id: "product_enquiry",
    name: "Product / price enquiry",
    description: "Replies to “price”, “rate” or “catalogue” with your details, asks to order or call, and follows up the next day if they say later.",
    steps: ["Choose category", "Share prices (edit)", "Order / call → assign sales", "Later → follow-up after 20 hours"],
    premium: true,
    graph: productEnquiry,
  },
  {
    id: "feedback",
    name: "Feedback & Google review",
    description: "After you tag a contact “Order delivered”: asks for a rating, routes unhappy customers to your team and asks happy ones for a review.",
    steps: ["Wait 2 hours", "Ask rating", "Unhappy → assign + apology", "Happy → review link"],
    premium: true,
    graph: feedback,
  },
  {
    id: "drip_lead_nurture",
    name: "Drip: new lead nurture (7 days)",
    description: "When you tag a contact “New lead”: messages on day 0, 1, 3 and 7. Stops the moment they reply and hands the chat to your team; “stop” marks them not interested.",
    steps: ["Day 0 welcome", "Day 1 why us", "Day 3 customer story", "Day 7 last check", "Reply → team · Stop → not interested"],
    premium: true,
    graph: leadNurture,
  },
  {
    id: "drip_quote_followup",
    name: "Drip: quote follow-up",
    description: "When you tag a contact “Quote sent”: waits a day, then up to 3 polite follow-ups. Skips anyone already marked won or lost, and stops when they reply.",
    steps: ["Wait 1 day", "Did you see the quote?", "Reminder after 2 days", "Final follow-up", "Reply → team"],
    premium: true,
    graph: quoteFollowUp,
  },
  {
    id: "drip_win_back",
    name: "Drip: win back old customers",
    description: "When you tag a contact “Win back”: a comeback offer, and a reminder before it ends. Replies go to your team.",
    steps: ["Comeback offer", "Reminder after 4 days", "Reply → team · Stop → not interested"],
    premium: true,
    graph: winBack,
  },
  {
    id: "drip_festival",
    name: "Drip: festival offer (3 messages)",
    description: "When you tag contacts “Festival offer”: launch, few-days-left and last-day messages. Anyone who replies is handed to your team and gets no more reminders.",
    steps: ["Offer launch", "Few days left", "Last day", "Reply → team"],
    premium: true,
    graph: festivalDrip,
  },
];

export const LIBRARY_IDS = AUTOMATION_LIBRARY.map((t) => t.id) as [string, ...string[]];
export const libraryTemplate = (id: string) => AUTOMATION_LIBRARY.find((t) => t.id === id) ?? null;
