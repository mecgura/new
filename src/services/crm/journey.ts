import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";

/**
 * Customer journey: everything that happened with one contact, from first touch to purchase and review,
 * assembled from the records the platform already keeps (nothing is invented or inferred beyond them).
 */
export type JourneyStage = "acquired" | "engaged" | "qualified" | "opportunity" | "customer" | "advocate";
export type JourneyEvent = { at: string; stage: JourneyStage; kind: string; title: string; detail: string; link: string };

const STAGE_ORDER: JourneyStage[] = ["acquired", "engaged", "qualified", "opportunity", "customer", "advocate"];
const LIMIT = 50; // per source
const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export async function contactJourney(organizationId: string, contactId: string) {
  const contact = await db.contact.findFirst({ where: { id: contactId, organizationId }, select: { id: true, name: true, source: true, lifecycle: true, leadStatus: true, createdAt: true } });
  if (!contact) throw new ApiError("NOT_FOUND", "Contact not found.");
  const where = { organizationId, contactId };
  const [convs, ads, landing, flows, campaigns, autos, appts, deals, purchases, loyalty, reviews, csat, consents, notes] = await Promise.all([
    db.conversation.findMany({ where, orderBy: { createdAt: "asc" }, take: LIMIT, select: { id: true, channel: true, createdAt: true, _count: { select: { messages: true } } } }),
    db.adReferral.findMany({ where, orderBy: { createdAt: "asc" }, take: LIMIT, select: { headline: true, sourceType: true, createdAt: true } }),
    db.landingSubmission.findMany({ where, orderBy: { createdAt: "asc" }, take: LIMIT, select: { createdAt: true, utmSource: true, utmCampaign: true, page: { select: { title: true } } } }),
    db.flowSubmission.findMany({ where, orderBy: { createdAt: "asc" }, take: LIMIT, select: { createdAt: true, flow: { select: { name: true } } } }),
    db.campaignRecipient.findMany({ where: { ...where, sentAt: { not: null } }, orderBy: { sentAt: "asc" }, take: LIMIT, select: { sentAt: true, readAt: true, repliedAt: true, optedOutAt: true, campaign: { select: { id: true, name: true } } } }),
    db.automationExecution.findMany({ where: { ...where, isTest: false }, orderBy: { createdAt: "asc" }, take: LIMIT, select: { id: true, status: true, createdAt: true, automation: { select: { id: true, name: true } } } }),
    db.appointment.findMany({ where, orderBy: { createdAt: "asc" }, take: LIMIT, select: { service: true, status: true, requestedFor: true, createdAt: true } }),
    db.deal.findMany({ where, orderBy: { createdAt: "asc" }, take: LIMIT, select: { id: true, title: true, valuePaise: true, status: true, createdAt: true, closedAt: true, stage: { select: { name: true } } } }),
    db.purchase.findMany({ where, orderBy: { createdAt: "asc" }, take: LIMIT, select: { amountPaise: true, note: true, createdAt: true } }),
    db.loyaltyEntry.findMany({ where: { ...where, kind: { in: ["referral", "redeem", "redemption"] } }, orderBy: { createdAt: "asc" }, take: LIMIT, select: { kind: true, points: true, note: true, createdAt: true } }),
    db.reviewRequest.findMany({ where, orderBy: { sentAt: "asc" }, take: LIMIT, select: { sentAt: true, rating: true, ratedAt: true, googleClickedAt: true, comment: true } }),
    db.csatSurvey.findMany({ where: { ...where, ratedAt: { not: null } }, orderBy: { ratedAt: "asc" }, take: LIMIT, select: { rating: true, ratedAt: true } }),
    db.consentRecord.findMany({ where, orderBy: { createdAt: "asc" }, take: LIMIT, select: { status: true, channel: true, source: true, createdAt: true } }),
    db.contactNote.count({ where }),
  ]);

  const ev: JourneyEvent[] = [];
  const push = (at: Date | null | undefined, stage: JourneyStage, kind: string, title: string, detail = "", link = "") => {
    if (at) ev.push({ at: at.toISOString(), stage, kind, title, detail, link });
  };
  push(contact.createdAt, "acquired", "created", "Became a contact", contact.source ? `Source: ${contact.source}` : "");
  for (const a of ads) push(a.createdAt, "acquired", "ad", "Clicked a Click-to-WhatsApp ad", a.headline || a.sourceType);
  for (const l of landing) push(l.createdAt, "acquired", "landing", `Filled the form on “${l.page.title}”`, [l.utmSource, l.utmCampaign].filter(Boolean).join(" · "));
  for (const c of consents) push(c.createdAt, "acquired", "consent", c.status === "opted_in" ? `Opted in (${c.channel})` : `Consent: ${c.status.replace("_", " ")}`, c.source);
  for (const c of convs) push(c.createdAt, "engaged", "conversation", `Conversation started on ${c.channel}`, `${c._count.messages} message(s)`, `/inbox?c=${c.id}`);
  for (const f of flows) push(f.createdAt, "engaged", "flow", `Submitted the WhatsApp form “${f.flow?.name ?? "Flow"}”`);
  for (const r of campaigns) {
    push(r.sentAt, "engaged", "campaign", `Received campaign “${r.campaign.name}”`, r.readAt ? "Read" : "", `/campaigns/${r.campaign.id}`);
    push(r.repliedAt, "engaged", "campaign_reply", `Replied to “${r.campaign.name}”`);
    push(r.optedOutAt, "engaged", "opt_out", "Opted out", `From “${r.campaign.name}”`);
  }
  for (const a of autos) push(a.createdAt, "engaged", "automation", `Automation “${a.automation.name}”`, a.status, `/automations/${a.automation.id}`);
  for (const a of appts) push(a.createdAt, "qualified", "appointment", `Appointment ${a.status}: ${a.service || "service"}`, a.requestedFor);
  for (const d of deals) {
    push(d.createdAt, "opportunity", "deal", `Deal “${d.title}”`, `${rupees(d.valuePaise)} · ${d.stage.name}`, "/deals");
    if (d.closedAt) push(d.closedAt, d.status === "won" ? "customer" : "opportunity", d.status === "won" ? "deal_won" : "deal_lost", d.status === "won" ? `Won “${d.title}”` : `Lost “${d.title}”`, rupees(d.valuePaise), "/deals");
  }
  for (const p of purchases) push(p.createdAt, "customer", "purchase", `Purchase ${rupees(p.amountPaise)}`, p.note);
  for (const l of loyalty) push(l.createdAt, l.kind === "referral" ? "advocate" : "customer", "loyalty", l.kind === "referral" ? "Referred a friend" : "Redeemed points", `${l.points} points${l.note ? ` · ${l.note}` : ""}`);
  for (const r of reviews) {
    push(r.ratedAt, r.rating && r.rating >= 4 ? "advocate" : "customer", "review", `Rated ${r.rating}★`, r.comment.slice(0, 120));
    push(r.googleClickedAt, "advocate", "google_review", "Opened the Google review link");
  }
  for (const c of csat) push(c.ratedAt, "customer", "csat", `Rated support ${c.rating}/5`);
  ev.sort((a, b) => a.at.localeCompare(b.at));

  // Furthest stage actually reached, with when it was first reached.
  const firstAt: Partial<Record<JourneyStage, string>> = {};
  for (const e of ev) firstAt[e.stage] ??= e.at;
  const reached = STAGE_ORDER.filter((s) => firstAt[s]);
  const current = reached.at(-1) ?? "acquired";
  const spend = purchases.reduce((n, p) => n + p.amountPaise, 0) + deals.filter((d) => d.status === "won").reduce((n, d) => n + d.valuePaise, 0);
  return {
    contact: { id: contact.id, name: contact.name, lifecycle: contact.lifecycle, leadStatus: contact.leadStatus },
    stages: STAGE_ORDER.map((s) => ({ stage: s, reachedAt: firstAt[s] ?? null })),
    current,
    totals: { events: ev.length, conversations: convs.length, campaigns: campaigns.length, deals: deals.length, purchases: purchases.length, spendPaise: spend, notes },
    daysToCustomer: firstAt.customer ? Math.round((new Date(firstAt.customer).getTime() - contact.createdAt.getTime()) / 86_400_000) : null,
    events: ev.reverse(),
  };
}
