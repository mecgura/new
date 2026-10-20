import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { OrgAccess } from "@/lib/session";
import type { Audience, VariableMapping } from "@/lib/validations";
import { daysBetween, getFestivals, istToday, type Festival } from "@/services/site/festivals";
import { createTemplate, listTemplateAccounts } from "@/services/templates/templates";
import { createCampaign, updateCampaign } from "@/services/campaigns/campaigns";

/**
 * Festival campaigns for a client workspace. Uses MECGURA's festival calendar to suggest what to send
 * next, drafts a greeting template for Meta approval, and sets up a campaign scheduled for the
 * festival morning (opted-in contacts only). Sending still goes through the normal wizard, its
 * compliance review and the client's explicit confirmation.
 */
const MARK = (id: string) => `festival:${id}`;
const LOOKAHEAD_DAYS = 60;

export const templateNameFor = (f: Festival) => `${f.id.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}_wishes`.slice(0, 60);

/** 09:30 India time on the festival's first day, as a UTC instant. */
export function festivalMorning(f: Festival) {
  return new Date(`${f.start}T04:00:00Z`);
}

export function greetingBody(f: Festival, businessName: string, offer: string) {
  const lines = [`Hi {{1}}, wishing you and your family a very Happy ${f.name}! ${f.emoji}`.trim()];
  if (offer.trim()) lines.push(offer.trim());
  lines.push(`Warm wishes,\n${businessName}`);
  return lines.join("\n\n").slice(0, 1024);
}

async function festivalById(id: string) {
  const s = await getFestivals();
  const f = s.festivals.find((x) => x.id === id);
  if (!f) throw new ApiError("NOT_FOUND", "Festival not found.");
  return f;
}

export async function festivalPlanner(access: OrgAccess) {
  const today = istToday();
  const s = await getFestivals();
  const upcoming = s.festivals
    .filter((f) => f.start >= today && daysBetween(today, f.start) <= LOOKAHEAD_DAYS)
    .sort((a, b) => a.start.localeCompare(b.start));
  const names = upcoming.map(templateNameFor);
  const [templates, campaigns, wabas, org] = await Promise.all([
    db.messageTemplate.findMany({ where: { organizationId: access.organizationId, name: { in: names } }, select: { id: true, name: true, status: true, wabaRecordId: true } }),
    db.campaign.findMany({ where: { organizationId: access.organizationId, description: { in: upcoming.map((f) => MARK(f.id)) } }, select: { id: true, status: true, description: true, scheduledAt: true } }),
    listTemplateAccounts(access.organizationId),
    db.organization.findUnique({ where: { id: access.organizationId }, select: { name: true } }),
  ]);
  return {
    businessName: org?.name ?? "",
    numbers: wabas.flatMap((w) => w.accounts.map((a) => ({ id: a.id, wabaId: w.id, label: `${a.displayName} (${a.phoneNumber})${w.isDemo ? " · demo" : ""}` }))),
    festivals: upcoming.map((f) => {
      const tpl = templates.filter((t) => t.name === templateNameFor(f));
      const camp = campaigns.find((c) => c.description === MARK(f.id));
      return {
        id: f.id,
        name: f.name,
        emoji: f.emoji,
        start: f.start,
        inDays: daysBetween(today, f.start),
        templateName: templateNameFor(f),
        templates: tpl.map((t) => ({ id: t.id, status: t.status, wabaId: t.wabaRecordId })),
        campaign: camp ? { id: camp.id, status: camp.status, scheduledAt: camp.scheduledAt?.toISOString() ?? null } : null,
      };
    }),
  };
}

/** Drafts the festival greeting template on a WhatsApp account. The client reviews and submits it to Meta. */
export async function createFestivalTemplate(access: OrgAccess, input: { festivalId: string; wabaId: string; businessName: string; offer: string }, req?: Request) {
  const f = await festivalById(input.festivalId);
  const name = templateNameFor(f);
  const existing = await db.messageTemplate.findFirst({ where: { organizationId: access.organizationId, wabaRecordId: input.wabaId, name, language: "en" }, select: { id: true } });
  if (existing) return { templateId: existing.id, created: false };
  const t = await createTemplate(
    access,
    {
      wabaId: input.wabaId,
      name,
      language: "en",
      category: "MARKETING",
      headerType: "none",
      headerText: "",
      body: greetingBody(f, input.businessName.trim() || "Team", input.offer),
      footer: "Reply STOP to unsubscribe",
      buttons: [],
      examples: { body: ["Ravi"] },
      authOptions: { addSecurityRecommendation: true, codeExpirationMinutes: 10, buttonText: "Copy code" },
    },
    req
  );
  return { templateId: t.id, created: true };
}

/** Creates (or returns) the festival campaign: opted-in contacts, first name in {{1}}, scheduled for the festival morning when possible. */
export async function createFestivalCampaign(access: OrgAccess, input: { festivalId: string; whatsappAccountId: string }, req?: Request) {
  const f = await festivalById(input.festivalId);
  const existing = await db.campaign.findFirst({ where: { organizationId: access.organizationId, description: MARK(f.id) }, select: { id: true } });
  if (existing) return { campaignId: existing.id, created: false };
  const year = f.start.slice(0, 4);
  const c = await createCampaign(access, { name: `${f.name} wishes ${year}`.slice(0, 80), description: MARK(f.id), whatsappAccountId: input.whatsappAccountId }, req);
  const acct = await db.whatsAppAccount.findUnique({ where: { id: input.whatsappAccountId }, select: { wabaRecordId: true } });
  const tpl = await db.messageTemplate.findFirst({ where: { organizationId: access.organizationId, name: templateNameFor(f), status: "approved", wabaRecordId: acct?.wabaRecordId ?? "" }, select: { id: true } });
  const audience: Audience = { mode: "filters", filters: { tagIds: [], tagMode: "any", excludeTagIds: [], leadStatuses: [], lifecycles: [], consent: ["opted_in"], sources: [] }, segmentId: null, contactIds: [] };
  const variables: Record<string, VariableMapping> = { "body.1": { source: "field", field: "first_name", key: "", fallback: "there" } };
  const when = festivalMorning(f);
  const lead = when.getTime() - Date.now();
  await updateCampaign(access, c.id, {
    audience,
    ...(tpl ? { templateId: tpl.id, variables } : {}),
    ...(lead > 5 * 60_000 && lead < 59 * 86_400_000 ? { scheduledAt: when } : {}),
  }, req);
  return { campaignId: c.id, created: true };
}
