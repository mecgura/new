import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { normalizePhone } from "@/services/inbox/contacts";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { liveVoiceProvider, simulateCall, voiceStatus } from "@/providers/voice";

type Row = Awaited<ReturnType<typeof db.voiceCall.findFirstOrThrow<{ include: { contact: { select: { id: true; name: true; phone: true } } } }>>>;

function parseTranscript(raw: string) {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as { role: string; text: string }[]) : [];
  } catch {
    return [];
  }
}

export function toCallDto(c: Row) {
  return {
    id: c.id,
    mode: c.mode,
    status: c.status,
    goal: c.goal,
    script: c.script,
    language: c.language,
    consentNote: c.consentNote,
    transcript: parseTranscript(c.transcript),
    summary: c.summary,
    outcome: c.outcome,
    durationSec: c.durationSec,
    error: c.error,
    createdAt: c.createdAt,
    contact: { id: c.contact.id, name: c.contact.name, phone: c.contact.phone },
  };
}

const include = { contact: { select: { id: true, name: true, phone: true } } } as const;

export async function listCalls(organizationId: string) {
  await assertServiceEnabled(organizationId, "AI_CALLING");
  const rows = await db.voiceCall.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100, include });
  return { calls: rows.map(toCallDto), status: voiceStatus() };
}

export async function getCall(organizationId: string, id: string) {
  await assertServiceEnabled(organizationId, "AI_CALLING");
  const c = await db.voiceCall.findFirst({ where: { id, organizationId }, include });
  if (!c) throw new ApiError("NOT_FOUND", "Call not found.");
  return toCallDto(c);
}

export async function createCall(access: OrgAccess, input: { contactId: string; goal: string; script: string; language: string; consentNote: string }, req?: Request) {
  const orgId = access.organizationId;
  await assertServiceEnabled(orgId, "AI_CALLING");
  const contact = await db.contact.findFirst({ where: { id: input.contactId, organizationId: orgId } });
  if (!contact) throw new ApiError("NOT_FOUND", "Contact not found.");
  if (contact.suppressed || contact.optInStatus === "opted_out") throw new ApiError("CONFLICT", "This contact opted out or is suppressed. They are not called.");
  const phone = normalizePhone(contact.phone);
  if (!phone) throw new ApiError("CONFLICT", "This contact has no phone number to call.");

  const provider = liveVoiceProvider();
  const base = { organizationId: orgId, contactId: contact.id, createdByUserId: access.user.id, goal: input.goal, script: input.script, language: input.language, consentNote: input.consentNote };
  let call;
  if (provider) {
    call = await db.voiceCall.create({ data: { ...base, mode: "live", status: "queued" } });
    try {
      const r = await provider.startCall({ to: phone, goal: input.goal, script: input.script, language: input.language, callId: call.id });
      call = await db.voiceCall.update({ where: { id: call.id }, data: { providerCallId: r.providerCallId, status: "in_progress", startedAt: new Date() } });
    } catch {
      call = await db.voiceCall.update({ where: { id: call.id }, data: { status: "failed", error: "The voice provider could not start the call." } });
    }
  } else {
    const sim = simulateCall({ contactName: contact.name, goal: input.goal, script: input.script, language: input.language, seed: `${contact.id}:${Date.now()}` });
    const now = new Date();
    call = await db.voiceCall.create({
      data: { ...base, mode: "demo", status: sim.status, transcript: JSON.stringify(sim.transcript), summary: sim.summary, outcome: sim.outcome, durationSec: sim.durationSec, startedAt: now, endedAt: now },
    });
  }
  await audit({ action: "voice.call_requested", actorUserId: access.user.id, organizationId: orgId, targetType: "voice_call", targetId: call.id, metadata: { mode: call.mode, contactId: contact.id }, req });
  return getCall(orgId, call.id);
}
