// MECGURA's own sales chat (only offered to the workspace that owns MECGURA's WhatsApp number).
// Prices and limits come from the live plan catalogue at the moment the automation is created —
// nothing is typed in by hand, so the chat never quotes a price the website doesn't show.

import { defaultData, type FlowEdge, type FlowNode, type Graph, type NodeDataMap, type NodeType } from "@/lib/automations";

export const HOUSE_SALES_ID = "mecgura_sales";

export type SalesPlan = {
  name: string;
  priceMonthly: number; // paise
  priceYearly: number; // paise, 0 = no yearly
  trialDays: number;
  maxUsers: number;
  maxWhatsAppNumbers: number;
  maxMonthlyMessages: number;
  features: string[];
  selfServe: boolean;
};

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const lim = (n: number, one: string, many: string) => (n < 0 ? `Unlimited ${many}` : `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`);

/** The plan list as one WhatsApp message (≤ 1024 characters). */
export function plansMessage(plans: SalesPlan[]): string {
  const paid = plans.filter((p) => p.priceMonthly > 0);
  const popular = paid.filter((p) => p.selfServe)[1]?.name;
  const lines = paid.map((p) => {
    const price = p.selfServe ? `${rupees(p.priceMonthly)}/month` : `${rupees(p.priceMonthly)}/month se`;
    const extra = p.features.includes("ai_agent") ? " · AI agent" : "";
    return `*${p.name} – ${price}*${p.name === popular ? " ⭐" : ""}\n${lim(p.maxUsers, "member", "members")} · ${lim(p.maxWhatsAppNumbers, "number", "numbers")} · ${lim(p.maxMonthlyMessages, "msg", "msgs")}/month${extra}`;
  });
  const yearly = paid.filter((p) => p.priceYearly > 0).map((p) => Math.round(12 - p.priceYearly / p.priceMonthly));
  const free = yearly.length ? Math.min(...yearly) : 0;
  const trials = paid.map((p) => p.trialDays).filter((d) => d > 0);
  const notes = [
    free > 0 ? `💰 Yearly lo toh ${free} mahine free.` : "",
    trials.length ? `🎁 ${Math.min(...trials) === Math.max(...trials) ? Math.min(...trials) : `${Math.min(...trials)}–${Math.max(...trials)}`} din ka free trial.` : "",
    "Campaigns, automations, team inbox aur analytics sab plans mein.",
    "ℹ️ WhatsApp (Meta) ke message charges alag hain, Meta khud bill karta hai.",
  ].filter(Boolean);
  return `📋 *MECGURA plans*\n\n${lines.join("\n\n")}\n\n${notes.join("\n")}`.slice(0, 1024);
}

export function houseSalesGraph(plans: SalesPlan[]): Graph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const node = <T extends NodeType>(id: string, type: T, x: number, y: number, data: Partial<NodeDataMap[T]> & { label?: string }) => {
    nodes.push({ id, type, position: { x, y }, data: { ...defaultData(type), ...data } } as FlowNode);
  };
  const link = (s: string, t: string, h: string | null = null) => edges.push({ id: `e-${s}-${h ?? "next"}-${t}`, source: s, target: t, sourceHandle: h });
  const chain = (...ids: string[]) => ids.slice(1).forEach((id, i) => link(ids[i], id));
  const ask = (text: string, buttons: string[] = []) => ({ text, buttons, waitForReply: true, replyTimeoutMinutes: 60 });
  const L = 0, M = 320, R = 640, F = 960;

  node("t", "trigger", M, 0, { label: "Customer tapped our ad", trigger: "ad_click", adIds: [] });
  node("hi", "message", M, 140, {
    label: "Welcome",
    text: "Namaste 🙏 MECGURA mein aapka swagat hai!\n\nHum WhatsApp automation software dete hain: auto reply, AI agent, leads ka CRM, team inbox aur opt-in customers ko offers — sab ek jagah.",
  });
  node("q_menu", "message", M, 280, { label: "What do you want?", ...ask("Aap kya jaanna chahte ho? Neeche tap karein 👇", ["Price / plans", "Free demo", "Kaise kaam karta hai"]) });
  const answered = { match: "all" as const, rules: [{ field: "message" as const, key: "", operator: "is_not_empty" as const, value: "" }] };
  node("menu_ok", "condition", M, 350, { label: "Replied?", ...answered });
  node("route", "switch", M, 420, {
    label: "Route",
    field: "message",
    cases: [
      { id: "demo", label: "Demo / call", operator: "contains", value: "demo, call, baat, team, meeting" },
      { id: "how", label: "How it works", operator: "contains", value: "kaise, how, kya hai, feature, kaam" },
    ],
  });
  node("how", "message", R, 560, {
    label: "How it works",
    text: "Aise kaam karta hai 👇\n✅ Customer ka message aate hi turant auto reply (24x7)\n✅ Ads aur website ke leads apne aap CRM mein\n✅ AI agent aapke business ke sawaalon ka jawab deta hai\n✅ Poori team ek hi number se chat sambhalti hai\n✅ Opt-in customers ko offers aur reminders\n\nSetup hamari team karti hai, aksar aapke existing number par, lagbhag 1 din mein.",
  });
  node("plans", "message", M, 700, { label: "Plans & prices (from live catalogue)", text: plansMessage(plans) });
  node("q_plan", "message", M, 840, { label: "Which plan?", ...ask("Aapke business ke liye kaunsa theek lagta hai?", ["Starter / Growth", "Pro / Enterprise", "Free demo call"]) });
  node("s_plan", "update_contact", M, 980, { label: "Save plan interest", field: "custom", key: "plan_interest", value: "{{reply}}" });
  node("plan_demo", "condition", M, 1050, { label: "Wants demo now?", match: "any", rules: [{ field: "message", key: "", operator: "contains", value: "demo, call" }] });
  node("q_biz", "message", M, 1120, { label: "Ask business", ...ask("Aapka business kya hai? (jaise salon, shop, clinic, coaching, real estate)") });
  node("s_biz", "update_contact", M, 1260, { label: "Save business", field: "custom", key: "business", value: "{{reply}}" });
  node("q_cta", "message", M, 1400, { label: "Offer demo", ...ask("Free demo call book karein? Hamari team 10–15 minute mein aapke business ke hisaab se poora system dikha degi.", ["Haan, call karo", "WhatsApp pe batao", "Baad mein"]) });
  node("cta_ok", "condition", M, 1470, { label: "Replied?", ...answered });
  node("cta", "switch", M, 1540, {
    label: "Demo?",
    field: "message",
    cases: [
      { id: "yes", label: "Wants a call", operator: "contains", value: "haan, han, yes, call, demo" },
      { id: "chat", label: "Chat on WhatsApp", operator: "contains", value: "whatsapp, batao, chat, msg, message" },
    ],
  });
  // Book the demo call (hot lead)
  node("q_name", "message", L, 1680, { label: "Ask name", ...ask("Badhiya! 🙌 Call kis naam se karein?") });
  node("s_name", "update_contact", L, 1820, { label: "Save name", field: "name", value: "{{reply}}" });
  node("q_time", "message", L, 1960, { label: "Ask call time", ...ask("Call ke liye kab theek rahega?", ["Aaj", "Kal subah", "Kal shaam"]) });
  node("s_time", "update_contact", L, 2100, { label: "Save call time", field: "custom", key: "call_time", value: "{{reply}}" });
  node("tag_hot", "tag", L, 2240, { label: "Tag: demo booked", action: "add", tagName: "Demo booked" });
  node("st_hot", "update_contact", L, 2380, { label: "Status: qualified", field: "leadStatus", value: "qualified" });
  node("assign_hot", "assign", L, 2520, { label: "Assign sales", mode: "auto" });
  node("bye_hot", "message", L, 2660, { label: "Confirm call", text: "✅ Ho gaya! Hamari team ({{contact.custom.call_time}}) aapko isi number par call karegi.\nTab tak koi bhi sawaal ho toh yahin likhein 🙏" });
  node("end_hot", "end", L, 2800, { label: "End" });
  // Talk on WhatsApp
  node("tag_chat", "tag", R, 1680, { label: "Tag: wants chat", action: "add", tagName: "Hot lead" });
  node("assign_chat", "assign", R, 1820, { label: "Assign sales", mode: "auto" });
  node("bye_chat", "message", R, 1960, { label: "Team will reply", text: "Theek hai 🙏 Hamari team abhi yahin WhatsApp par aapke saare sawaalon ka jawab degi." });
  node("end_chat", "end", R, 2100, { label: "End" });
  // Later
  node("tag_warm", "tag", F, 1680, { label: "Tag: warm lead", action: "add", tagName: "Warm lead" });
  node("st_warm", "update_contact", F, 1820, { label: "Status: contacted", field: "leadStatus", value: "contacted" });
  node("bye_warm", "message", F, 1960, { label: "Leave door open", text: "Koi baat nahi 🙏 Jab bhi ready hon, yahin *demo* likh dena — hamari team turant help karegi." });
  node("end_warm", "end", F, 2100, { label: "End" });
  // No reply: stop quietly (nothing is sent to a silent customer)
  node("tag_quiet", "tag", F + 320, 560, { label: "Tag: no reply", action: "add", tagName: "No reply" });
  node("end_quiet", "end", F + 320, 700, { label: "End" });

  chain("t", "hi", "q_menu", "menu_ok");
  link("menu_ok", "route", "yes");
  link("menu_ok", "tag_quiet", "no");
  chain("tag_quiet", "end_quiet");
  link("route", "q_name", "demo");
  link("route", "how", "how");
  link("route", "plans", "default");
  chain("how", "plans");
  chain("plans", "q_plan", "s_plan", "plan_demo");
  link("plan_demo", "q_name", "yes");
  link("plan_demo", "q_biz", "no");
  chain("q_biz", "s_biz", "q_cta", "cta_ok");
  link("cta_ok", "cta", "yes");
  link("cta_ok", "tag_quiet", "no");
  link("cta", "q_name", "yes");
  link("cta", "tag_chat", "chat");
  link("cta", "tag_warm", "default");
  chain("q_name", "s_name", "q_time", "s_time", "tag_hot", "st_hot", "assign_hot", "bye_hot", "end_hot");
  chain("tag_chat", "assign_chat", "bye_chat", "end_chat");
  chain("tag_warm", "st_warm", "bye_warm", "end_warm");
  return { nodes, edges };
}
