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

export const AUTOMATION_LIBRARY: LibraryTemplate[] = [
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
];

export const LIBRARY_IDS = AUTOMATION_LIBRARY.map((t) => t.id) as [string, ...string[]];
export const libraryTemplate = (id: string) => AUTOMATION_LIBRARY.find((t) => t.id === id) ?? null;
