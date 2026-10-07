import { remaining } from "@/lib/plans";
import { db } from "@/lib/db";
import { currentPlan, monthTotal } from "@/lib/services/usage";
import { paramProblem, templateSlots, type Slot, type SlotValues } from "@/lib/templates";
import type { VariableMapping } from "@/lib/validations";
import { toDef } from "@/services/templates/templates";
import { audienceWhere, parseAudience } from "@/services/campaigns/audience";

export const REMOVAL_REASONS = ["invalid_phone", "duplicate", "opted_out", "suppressed", "no_consent", "frequency_cap", "missing_variable"] as const;
export type RemovalReason = (typeof REMOVAL_REASONS)[number];

export const REASON_LABELS: Record<RemovalReason, string> = {
  invalid_phone: "Invalid or own phone number",
  duplicate: "Duplicate phone number",
  opted_out: "Opted out",
  suppressed: "On the suppression list",
  no_consent: "No opt-in recorded",
  frequency_cap: "Got a marketing message in the last 24 h",
  missing_variable: "Missing variable value",
};

export type CheckStatus = "pass" | "warn" | "fail";
export type ComplianceCheck = { key: string; label: string; status: CheckStatus; detail: string };

export type ComplianceReport = {
  checks: ComplianceCheck[];
  total: number;
  eligible: number;
  removed: number;
  reasons: Partial<Record<RemovalReason, number>>;
  removedSample: { name: string; phone: string; reason: RemovalReason }[];
  canSend: boolean;
  generatedAt: string;
};

export type EligibleRecipient = { contactId: string; phone: string; name: string; values: SlotValues };

const TIER_LIMITS: Record<string, number> = { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10_000, TIER_100K: 100_000 };
const E164 = /^\+[1-9]\d{7,14}$/;
const FREQUENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

type ContactLite = { id: string; name: string; phone: string; email: string; optInStatus: string; suppressed: boolean; customFields: string };

function custom(raw: string): Record<string, string> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Resolves one slot's value for one contact from the campaign's variable mapping. */
export function resolveValue(m: VariableMapping | undefined, c: Pick<ContactLite, "name" | "phone" | "email" | "customFields">): string {
  if (!m) return "";
  if (m.source === "static") return m.value.trim();
  const v =
    m.field === "name"
      ? c.name
      : m.field === "first_name"
        ? c.name.trim().split(/\s+/)[0] ?? ""
        : m.field === "phone"
          ? c.phone
          : m.field === "email"
            ? c.email
            : custom(c.customFields)[m.key] ?? "";
  return (v ?? "").trim() || m.fallback.trim();
}

function slotKind(s: Slot) {
  return s.part === "header" && s.kind === "media" ? "media" : "text";
}

/**
 * Compliance review. Runs the full audience through WhatsApp's rules and
 * returns what will be sent, what is removed and why. Nothing here bypasses a
 * rule — it only removes recipients and blocks sending when a rule fails.
 */
export async function runCompliance(campaignId: string): Promise<{ report: ComplianceReport; recipients: EligibleRecipient[] }> {
  const c = await db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { template: true, whatsappAccount: { include: { phone: true } } },
  });
  const checks: ComplianceCheck[] = [];
  const check = (key: string, label: string, status: CheckStatus, detail: string) => checks.push({ key, label, status, detail });

  // 1. Template
  const t = c.template;
  const acct = c.whatsappAccount;
  if (!t) check("template", "Approved template", "fail", "Choose a template.");
  else if (t.status !== "approved") check("template", "Approved template", "fail", `“${t.name}” is ${t.status}. Only Meta-approved templates can be sent.`);
  else if (t.category === "AUTHENTICATION") check("template", "Approved template", "fail", "Authentication (OTP) templates are for one customer at a time and can't be broadcast.");
  else if (acct && t.wabaRecordId !== acct.wabaRecordId) check("template", "Approved template", "fail", "The template belongs to a different WhatsApp account than the sending number.");
  else if (t.qualityScore === "RED") check("template", "Approved template", "warn", `“${t.name}” is approved but Meta rates its quality LOW — expect it to be paused if blocks continue.`);
  else check("template", "Approved template", "pass", `“${t.name}” (${t.category.toLowerCase()}, ${t.language}) is approved.`);

  // 2. Number
  if (!acct || (acct.status !== "connected" && acct.status !== "demo")) check("number", "Sending number", "fail", "Choose a connected WhatsApp number.");
  else if (acct.phone?.qualityRating === "RED") check("number", "Sending number", "warn", `${acct.displayName} has LOW quality (red). Sending marketing now risks a lower messaging limit — consider pausing broadcasts.`);
  else if (acct.phone?.qualityRating === "YELLOW") check("number", "Sending number", "warn", `${acct.displayName} has MEDIUM quality. Keep the audience to engaged, opted-in contacts.`);
  else check("number", "Sending number", "pass", `${acct.displayName}${acct.isDemo ? " (demo — nothing is delivered)" : ""} is ready.`);

  // 3. Variable mapping
  const def = t ? toDef(t) : null;
  const slots = def ? templateSlots(def) : [];
  const mapping = JSON.parse(c.variables || "{}") as Record<string, VariableMapping>;
  const unmapped = slots.filter((s) => !mapping[s.key]);
  const badStatic = slots.filter((s) => mapping[s.key]?.source === "static" && paramProblem(resolveValue(mapping[s.key], { name: "", phone: "", email: "", customFields: "{}" }), slotKind(s)));

  // 4. Audience
  const audience = parseAudience(c.audience);
  let contacts: ContactLite[] = [];
  let missingIds = 0;
  let repeatedIds = 0;
  try {
    const where = await audienceWhere(c.organizationId, audience);
    contacts = await db.contact.findMany({ where, select: { id: true, name: true, phone: true, email: true, optInStatus: true, suppressed: true, customFields: true }, orderBy: { createdAt: "asc" } });
    if (audience.mode === "contacts") {
      const unique = new Set(audience.contactIds);
      repeatedIds = audience.contactIds.length - unique.size;
      missingIds = unique.size - contacts.length;
    }
  } catch {
    check("audience", "Audience", "fail", "The selected segment no longer exists.");
  }

  const recent = t?.category === "MARKETING"
    ? new Set(
        (
          await db.campaignRecipient.findMany({
            where: { organizationId: c.organizationId, campaignId: { not: c.id }, sentAt: { gte: new Date(Date.now() - FREQUENCY_WINDOW_MS) }, campaign: { template: { category: "MARKETING" } } },
            select: { phone: true },
          })
        ).map((r) => r.phone)
      )
    : new Set<string>();

  const reasons: Partial<Record<RemovalReason, number>> = {};
  const removedSample: ComplianceReport["removedSample"] = [];
  const recipients: EligibleRecipient[] = [];
  const seen = new Set<string>();
  const remove = (ct: Pick<ContactLite, "name" | "phone">, reason: RemovalReason) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
    if (removedSample.length < 100) removedSample.push({ name: ct.name, phone: ct.phone, reason });
  };
  const own = acct?.phoneNumber ?? "";
  for (const ct of contacts) {
    if (!E164.test(ct.phone) || ct.phone === own) remove(ct, "invalid_phone");
    else if (seen.has(ct.phone)) remove(ct, "duplicate");
    else if (ct.optInStatus === "opted_out") remove(ct, "opted_out");
    else if (ct.suppressed) remove(ct, "suppressed");
    else if (ct.optInStatus !== "opted_in") remove(ct, "no_consent");
    else if (recent.has(ct.phone)) remove(ct, "frequency_cap");
    else {
      const values: SlotValues = {};
      let ok = !unmapped.length;
      for (const s of slots) {
        values[s.key] = resolveValue(mapping[s.key], ct);
        if (paramProblem(values[s.key], slotKind(s))) ok = false;
      }
      if (!ok) remove(ct, "missing_variable");
      else recipients.push({ contactId: ct.id, phone: ct.phone, name: ct.name, values });
    }
    seen.add(ct.phone);
  }
  if (missingIds > 0) reasons.invalid_phone = (reasons.invalid_phone ?? 0) + missingIds;
  if (repeatedIds > 0) reasons.duplicate = (reasons.duplicate ?? 0) + repeatedIds;

  const total = contacts.length + missingIds + repeatedIds;
  const eligible = recipients.length;
  const n = (r: RemovalReason) => reasons[r] ?? 0;
  const removedLine = (r: RemovalReason, none: string) => (n(r) ? `${n(r)} removed — ${REASON_LABELS[r].toLowerCase()}.` : none);

  check("consent", "Consent verified", "pass", removedLine("no_consent", "Every recipient has a recorded opt-in."));
  check("opted_out", "Opted-out removed", "pass", removedLine("opted_out", "No opted-out contacts in this audience."));
  check("suppression", "Suppression checked", "pass", removedLine("suppressed", "No suppressed contacts in this audience."));
  check("duplicates", "Duplicates removed", "pass", removedLine("duplicate", "No duplicate numbers."));
  check("invalid", "Invalid contacts removed", "pass", removedLine("invalid_phone", "All numbers are valid."));
  if (t?.category === "MARKETING") check("frequency", "Marketing frequency", "pass", removedLine("frequency_cap", "Nobody got another marketing campaign in the last 24 hours."));
  if (!def) check("variables", "Variables validated", "fail", "Choose a template first.");
  else if (unmapped.length) check("variables", "Variables validated", "fail", `Map a value for ${unmapped.map((s) => s.label).join(", ")}.`);
  else if (badStatic.length) check("variables", "Variables validated", "fail", `${badStatic.map((s) => s.label).join(", ")}: ${paramProblem(resolveValue(mapping[badStatic[0].key], { name: "", phone: "", email: "", customFields: "{}" }), slotKind(badStatic[0]))}.`);
  else check("variables", "Variables validated", "pass", slots.length ? removedLine("missing_variable", `All ${slots.length} variable(s) resolve for every recipient.`) : "This template has no variables.");

  // 5. Limits
  if (acct && !acct.isDemo) {
    const sub = await currentPlan(c.organizationId);
    if (sub) {
      const left = remaining(await monthTotal(c.organizationId, "messages_sent"), sub.plan.maxMonthlyMessages);
      if (eligible > left) check("plan", "Plan message limit", "fail", `${eligible} messages needed but only ${left} left on the ${sub.plan.name} plan this month.`);
      else check("plan", "Plan message limit", "pass", Number.isFinite(left) ? `${left} messages left this month.` : "No monthly message limit on this plan.");
    }
    const tier = acct.phone?.messagingLimitTier ?? "";
    if (TIER_LIMITS[tier] && eligible > TIER_LIMITS[tier]) {
      check("tier", "Messaging limit", "warn", `Meta lets this number start ${TIER_LIMITS[tier]} new conversations per 24 h (${tier}). Recipients above that will fail — split the campaign.`);
    }
  }
  if (!checks.some((x) => x.key === "audience")) {
    check("audience", "Eligible recipients", eligible ? "pass" : "fail", eligible ? `${eligible} of ${total} contacts will receive this campaign.` : total ? "Every contact was removed by the checks above." : "The audience is empty.");
  }

  const report: ComplianceReport = {
    checks,
    total,
    eligible,
    removed: total - eligible,
    reasons,
    removedSample,
    canSend: !checks.some((x) => x.status === "fail"),
    generatedAt: new Date().toISOString(),
  };
  return { report, recipients };
}
