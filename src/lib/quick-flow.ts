// "Easy setup": one short form → a complete, proper automation (that can still be edited in the builder).
// Welcome (with image) → brochure (PDF) → Price / Call / Team buttons → price list → call booking or team hand-over.

import { defaultData, type FlowEdge, type FlowNode, type Graph, type MessageMedia, type NodeDataMap, type NodeType } from "@/lib/automations";

export type QuickFlowInput = {
  start: "ad_click" | "new_contact" | "keyword";
  adIds: string[];
  keywords: string[];
  welcomeText: string;
  welcomeImage: MessageMedia;
  brochure: MessageMedia;
  brochureText: string;
  priceText: string;
  priceImage: MessageMedia;
  buttons: { price: string; call: string; team: string };
  teamText: string;
};

export const QUICK_DEFAULTS: QuickFlowInput = {
  start: "ad_click",
  adIds: [],
  keywords: ["price", "details", "info"],
  welcomeText: "Namaste 🙏 Thanks for contacting us!\nAapki help ke liye hum yahin hain.",
  welcomeImage: { kind: "", url: "", filename: "" },
  brochure: { kind: "", url: "", filename: "" },
  brochureText: "📄 Hamara brochure — poori details isme hain.",
  priceText: "💰 *Price list*\n\n• Package 1 – ₹____\n• Package 2 – ₹____\n• Package 3 – ₹____",
  priceImage: { kind: "", url: "", filename: "" },
  buttons: { price: "Price list", call: "Call karo", team: "Team se baat" },
  teamText: "Theek hai 🙏 Hamari team abhi yahin WhatsApp par aapse baat karegi.",
};

const clean = (s: string, fallback: string) => (s.replace(/,/g, " ").trim().slice(0, 20) || fallback);

export function quickFlowGraph(input: QuickFlowInput): Graph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const node = <T extends NodeType>(id: string, type: T, x: number, y: number, data: Partial<NodeDataMap[T]> & { label?: string }) => {
    nodes.push({ id, type, position: { x, y }, data: { ...defaultData(type), ...data } } as FlowNode);
  };
  const link = (s: string, t: string, h: string | null = null) => edges.push({ id: `e-${s}-${h ?? "next"}-${t}`, source: s, target: t, sourceHandle: h });
  const chain = (...ids: string[]) => ids.slice(1).forEach((id, i) => link(ids[i], id));
  const ask = (text: string, buttons: string[] = []) => ({ text, buttons, waitForReply: true, replyTimeoutMinutes: 60 });
  const answered = { match: "all" as const, rules: [{ field: "message" as const, key: "", operator: "is_not_empty" as const, value: "" }] };
  const b = { price: clean(input.buttons.price, "Price list"), call: clean(input.buttons.call, "Call karo"), team: clean(input.buttons.team, "Team se baat") };
  const L = 0, M = 320, R = 640, F = 960;

  const trigger =
    input.start === "ad_click"
      ? { label: "Customer tapped an ad", trigger: "ad_click" as const, adIds: input.adIds }
      : input.start === "keyword"
        ? { label: "Keyword", trigger: "keyword" as const, keywords: input.keywords, match: "contains" as const }
        : { label: "New WhatsApp contact", trigger: "new_contact" as const, sources: ["whatsapp"] };
  node("t", "trigger", M, 0, trigger);
  node("welcome", "message", M, 140, { label: "Welcome", text: input.welcomeText.trim(), media: input.welcomeImage.kind === "image" ? input.welcomeImage : { kind: "", url: "", filename: "" } });
  const hasBrochure = input.brochure.kind === "document" && Boolean(input.brochure.url);
  if (hasBrochure) node("brochure", "message", M, 280, { label: "Brochure (PDF)", text: input.brochureText.trim(), media: input.brochure });
  node("menu", "message", M, 420, { label: "What next?", ...ask("Aap kya chahte ho? Neeche tap karein 👇", [b.price, b.call, b.team]) });
  node("menu_ok", "condition", M, 560, { label: "Replied?", ...answered });
  node("route", "switch", M, 700, {
    label: "Route",
    field: "message",
    cases: [
      { id: "price", label: "Price", operator: "contains", value: `${b.price.toLowerCase()}, price, rate, kitna, cost, charges, list` },
      { id: "call", label: "Call", operator: "contains", value: `${b.call.toLowerCase()}, call, phone, demo, visit` },
    ],
  });
  node("price", "message", L, 840, { label: "Price list", text: input.priceText.trim(), media: input.priceImage.kind === "image" ? input.priceImage : { kind: "", url: "", filename: "" } });
  node("after_price", "message", L, 980, { label: "After price", ...ask("Aage kya karein?", [b.call, b.team, "Baad mein"]) });
  node("after_ok", "condition", L, 1120, { label: "Replied?", ...answered });
  node("after_route", "switch", L, 1260, {
    label: "Call / team / later",
    field: "message",
    cases: [
      { id: "call", label: "Call", operator: "contains", value: `${b.call.toLowerCase()}, call, phone, demo, haan, yes` },
      { id: "team", label: "Team", operator: "contains", value: `${b.team.toLowerCase()}, team, baat, chat, whatsapp` },
    ],
  });
  // Call booking
  node("q_name", "message", M, 1400, { label: "Ask name", ...ask("Badhiya! 🙌 Call kis naam se karein?") });
  node("s_name", "update_contact", M, 1540, { label: "Save name", field: "name", value: "{{reply}}" });
  node("q_time", "message", M, 1680, { label: "Ask call time", ...ask("Call ke liye kab theek rahega?", ["Aaj", "Kal subah", "Kal shaam"]) });
  node("s_time", "update_contact", M, 1820, { label: "Save call time", field: "custom", key: "call_time", value: "{{reply}}" });
  node("tag_call", "tag", M, 1960, { label: "Tag: call requested", action: "add", tagName: "Call requested" });
  node("st_call", "update_contact", M, 2100, { label: "Status: qualified", field: "leadStatus", value: "qualified" });
  node("assign_call", "assign", M, 2240, { label: "Assign team", mode: "auto" });
  node("bye_call", "message", M, 2380, { label: "Confirm call", text: "✅ Ho gaya! Hamari team ({{contact.custom.call_time}}) aapko isi number par call karegi. Koi sawaal ho toh yahin likhein 🙏" });
  node("end_call", "end", M, 2520, { label: "End" });
  // Talk to the team
  node("tag_team", "tag", R, 1400, { label: "Tag: hot lead", action: "add", tagName: "Hot lead" });
  node("assign_team", "assign", R, 1540, { label: "Assign team", mode: "auto" });
  node("bye_team", "message", R, 1680, { label: "Team will reply", text: input.teamText.trim() || QUICK_DEFAULTS.teamText });
  node("end_team", "end", R, 1820, { label: "End" });
  // Later
  node("tag_later", "tag", F, 1400, { label: "Tag: warm lead", action: "add", tagName: "Warm lead" });
  node("bye_later", "message", F, 1540, { label: "Leave door open", text: "Koi baat nahi 🙏 Jab bhi ready hon, yahin message kar dena." });
  node("end_later", "end", F, 1680, { label: "End" });
  // Silent
  node("tag_quiet", "tag", F, 560, { label: "Tag: no reply", action: "add", tagName: "No reply" });
  node("end_quiet", "end", F, 700, { label: "End" });

  if (hasBrochure) chain("t", "welcome", "brochure", "menu", "menu_ok");
  else chain("t", "welcome", "menu", "menu_ok");
  link("menu_ok", "route", "yes");
  link("menu_ok", "tag_quiet", "no");
  link("route", "price", "price");
  link("route", "q_name", "call");
  link("route", "tag_team", "default");
  chain("price", "after_price", "after_ok");
  link("after_ok", "after_route", "yes");
  link("after_ok", "tag_quiet", "no");
  link("after_route", "q_name", "call");
  link("after_route", "tag_team", "team");
  link("after_route", "tag_later", "default");
  chain("q_name", "s_name", "q_time", "s_time", "tag_call", "st_call", "assign_call", "bye_call", "end_call");
  chain("tag_team", "assign_team", "bye_team", "end_team");
  chain("tag_later", "bye_later", "end_later");
  chain("tag_quiet", "end_quiet");
  return { nodes, edges };
}
