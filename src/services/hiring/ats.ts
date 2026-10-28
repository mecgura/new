import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { slugify } from "@/lib/server";
import type { OrgAccess } from "@/lib/session";
import { assertServiceEnabled, isServiceEnabled } from "@/services/whatsapp/guards";
import { normalizePhone } from "@/services/inbox/contacts";

/**
 * ATS (hiring): job openings, a public careers page per workspace, and a candidate pipeline. Every applicant also
 * becomes a CRM contact, so the team can follow up on WhatsApp from the inbox.
 */
export const JOB_TYPES = ["full_time", "part_time", "contract", "internship"] as const;
export const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"] as const;
export type Stage = (typeof STAGES)[number];
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

export const jobSchema = z.object({
  title: z.string().trim().min(2, "Enter the job title").max(120),
  department: z.string().trim().max(80).default(""),
  location: z.string().trim().max(120).default(""),
  type: z.enum(JOB_TYPES).default("full_time"),
  salary: z.string().trim().max(80).default(""),
  description: z.string().trim().max(8000).default(""),
  status: z.enum(["open", "closed"]).default("open"),
});

const phone = z
  .string()
  .trim()
  .max(20)
  .refine((v) => v === "" || Boolean(normalizePhone(v)), "Enter a valid mobile number")
  .transform((v) => (v ? normalizePhone(v)! : ""));

export const candidateSchema = z.object({
  jobId: z.string().trim().min(1).max(64),
  name: z.string().trim().min(2, "Enter the name").max(100),
  phone: phone.default(""),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200).or(z.literal("")).default(""),
  experience: z.string().trim().max(200).default(""),
  source: z.enum(["careers_page", "manual", "referral"]).default("manual"),
});

export const candidateUpdateSchema = z
  .object({
    stage: z.enum(STAGES).optional(),
    rating: z.coerce.number().int().min(0).max(5).optional(),
    notes: z.string().max(5000).optional(),
    name: z.string().trim().min(2).max(100).optional(),
    phone: phone.optional(),
    email: z.string().trim().toLowerCase().email().max(200).or(z.literal("")).optional(),
    experience: z.string().trim().max(200).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

const enabled = (orgId: string) => assertServiceEnabled(orgId, "ATS");

async function uniqueSlug(organizationId: string, title: string, exceptId?: string) {
  const base = slugify(title).slice(0, 50) || "job";
  for (let i = 0; i < 50; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    const hit = await db.job.findFirst({ where: { organizationId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (!hit) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function listJobs(access: OrgAccess) {
  await enabled(access.organizationId);
  const [jobs, counts, org] = await Promise.all([
    db.job.findMany({ where: { organizationId: access.organizationId }, orderBy: [{ status: "desc" }, { createdAt: "desc" }] }),
    db.candidate.groupBy({ by: ["jobId", "stage"], where: { organizationId: access.organizationId }, _count: { _all: true } }),
    db.organization.findUnique({ where: { id: access.organizationId }, select: { slug: true } }),
  ]);
  return {
    careersPath: `/careers/${org?.slug ?? ""}`,
    jobs: jobs.map((j) => ({
      ...j,
      counts: Object.fromEntries(STAGES.map((s) => [s, counts.find((c) => c.jobId === j.id && c.stage === s)?._count._all ?? 0])) as Record<Stage, number>,
    })),
  };
}

export async function saveJob(access: OrgAccess, id: string | null, input: z.infer<typeof jobSchema>, req?: Request) {
  await enabled(access.organizationId);
  if (id && !(await db.job.findFirst({ where: { id, organizationId: access.organizationId }, select: { id: true } }))) throw new ApiError("NOT_FOUND", "Job not found.");
  const slug = await uniqueSlug(access.organizationId, input.title, id ?? undefined);
  const job = id ? await db.job.update({ where: { id }, data: { ...input, slug } }) : await db.job.create({ data: { ...input, slug, organizationId: access.organizationId } });
  await audit({ action: "ats.job_saved", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "job", targetId: job.id, metadata: { title: job.title, status: job.status }, req });
  return job;
}

export async function deleteJob(access: OrgAccess, id: string, req?: Request) {
  await enabled(access.organizationId);
  const job = await db.job.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!job) throw new ApiError("NOT_FOUND", "Job not found.");
  await db.job.delete({ where: { id } });
  await audit({ action: "ats.job_saved", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "job", targetId: id, metadata: { title: job.title, deleted: true }, req });
}

const candidateSelect = { id: true, jobId: true, name: true, phone: true, email: true, stage: true, rating: true, source: true, notes: true, experience: true, resumeName: true, contactId: true, createdAt: true, updatedAt: true } as const;

export async function listCandidates(access: OrgAccess, jobId: string) {
  await enabled(access.organizationId);
  return db.candidate.findMany({ where: { organizationId: access.organizationId, jobId }, orderBy: { createdAt: "desc" }, select: candidateSelect });
}

/** Finds or creates the CRM contact for an applicant (no WhatsApp consent is assumed). */
async function linkContact(organizationId: string, c: { name: string; phone: string; email: string }) {
  if (!c.phone) return null;
  try {
    const existing = await db.contact.findUnique({ where: { organizationId_phone: { organizationId, phone: c.phone } }, select: { id: true } });
    if (existing) return existing.id;
    const created = await db.contact.create({ data: { organizationId, phone: c.phone, name: c.name, email: c.email, source: "careers_page", lifecycle: "lead" } });
    return created.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) return null;
    throw e;
  }
}

function checkResume(file: File | null) {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_RESUME_BYTES) throw new ApiError("VALIDATION_ERROR", "Resume can be up to 4 MB.", { details: { resume: ["Too large"] } });
  const ok = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/jpeg", "image/png"];
  if (!ok.includes(file.type)) throw new ApiError("VALIDATION_ERROR", "Upload the resume as PDF, Word, JPG or PNG.", { details: { resume: ["Unsupported type"] } });
  return file;
}

async function insertCandidate(organizationId: string, input: z.infer<typeof candidateSchema>, resume: File | null) {
  const job = await db.job.findFirst({ where: { id: input.jobId, organizationId }, select: { id: true, title: true } });
  if (!job) throw new ApiError("NOT_FOUND", "Job not found.");
  const file = checkResume(resume);
  const contactId = await linkContact(organizationId, input);
  const c = await db.candidate.create({
    data: {
      organizationId,
      ...input,
      contactId,
      ...(file ? { resume: new Uint8Array(await file.arrayBuffer()), resumeName: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120), resumeType: file.type } : {}),
    },
    select: candidateSelect,
  });
  return { candidate: c, job };
}

export async function addCandidate(access: OrgAccess, input: z.infer<typeof candidateSchema>, resume: File | null, req?: Request) {
  await enabled(access.organizationId);
  const { candidate } = await insertCandidate(access.organizationId, input, resume);
  await audit({ action: "ats.candidate_saved", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "candidate", targetId: candidate.id, req });
  return candidate;
}

export async function updateCandidate(access: OrgAccess, id: string, input: z.infer<typeof candidateUpdateSchema>, req?: Request) {
  await enabled(access.organizationId);
  const before = await db.candidate.findFirst({ where: { id, organizationId: access.organizationId }, select: { stage: true } });
  if (!before) throw new ApiError("NOT_FOUND", "Candidate not found.");
  const c = await db.candidate.update({ where: { id }, data: input, select: candidateSelect });
  if (input.stage && input.stage !== before.stage) {
    await audit({ action: "ats.candidate_stage", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "candidate", targetId: id, metadata: { from: before.stage, to: input.stage }, req });
  }
  return c;
}

export async function deleteCandidate(access: OrgAccess, id: string, req?: Request) {
  await enabled(access.organizationId);
  const c = await db.candidate.findFirst({ where: { id, organizationId: access.organizationId }, select: { id: true } });
  if (!c) throw new ApiError("NOT_FOUND", "Candidate not found.");
  await db.candidate.delete({ where: { id } });
  await audit({ action: "ats.candidate_saved", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "candidate", targetId: id, metadata: { deleted: true }, req });
}

export async function candidateResume(access: OrgAccess, id: string) {
  await enabled(access.organizationId);
  const c = await db.candidate.findFirst({ where: { id, organizationId: access.organizationId }, select: { resume: true, resumeName: true, resumeType: true } });
  if (!c?.resume) throw new ApiError("NOT_FOUND", "No resume uploaded.");
  return c;
}

// ---------------------------------------------------------------------------
// Public careers page
// ---------------------------------------------------------------------------
async function careersOrg(orgSlug: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(orgSlug)) return null;
  const org = await db.organization.findUnique({ where: { slug: orgSlug }, select: { id: true, name: true, status: true } });
  if (!org || org.status !== "active" || !(await isServiceEnabled(org.id, "ATS"))) return null;
  return org;
}

export async function publicJobs(orgSlug: string) {
  const org = await careersOrg(orgSlug);
  if (!org) return null;
  const jobs = await db.job.findMany({ where: { organizationId: org.id, status: "open" }, orderBy: { createdAt: "desc" }, select: { title: true, slug: true, department: true, location: true, type: true, salary: true, description: true, createdAt: true } });
  return { org: { name: org.name }, jobs };
}

export async function publicJob(orgSlug: string, jobSlug: string) {
  const org = await careersOrg(orgSlug);
  if (!org || !/^[a-z0-9-]{1,80}$/.test(jobSlug)) return null;
  const job = await db.job.findFirst({ where: { organizationId: org.id, slug: jobSlug, status: "open" }, select: { id: true, title: true, slug: true, department: true, location: true, type: true, salary: true, description: true } });
  return job ? { org: { name: org.name }, job } : null;
}

export const applySchema = candidateSchema.omit({ jobId: true, source: true }).extend({ phone: phone.refine((v) => v !== "", "Enter your mobile number") });

export async function applyToJob(orgSlug: string, jobSlug: string, input: z.infer<typeof applySchema>, resume: File | null) {
  const found = await publicJob(orgSlug, jobSlug);
  if (!found) throw new ApiError("NOT_FOUND", "This job is no longer open.");
  const org = await careersOrg(orgSlug);
  const orgId = org!.id;
  const dup = await db.candidate.findFirst({ where: { organizationId: orgId, jobId: found.job.id, phone: input.phone }, select: { id: true } });
  if (dup) return { duplicate: true };
  const { candidate, job } = await insertCandidate(orgId, { ...input, jobId: found.job.id, source: "careers_page" }, resume);
  await audit({ action: "ats.candidate_saved", organizationId: orgId, targetType: "candidate", targetId: candidate.id, metadata: { source: "careers_page" } });
  const team = await db.organizationMember.findMany({ where: { organizationId: orgId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } });
  for (const m of team) await notify({ userId: m.userId, organizationId: orgId, type: "success", title: `New applicant for ${job.title}`, body: `${candidate.name} · ${candidate.phone}`, link: "/hiring" });
  return { duplicate: false };
}
