import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { OrgAccess } from "@/lib/session";
import { audit } from "@/lib/audit";
import { audienceFiltersSchema, audienceSchema, type Audience, type AudienceFilters } from "@/lib/validations";

export function parseAudience(raw: string): Audience {
  try {
    return audienceSchema.parse(JSON.parse(raw));
  } catch {
    return audienceSchema.parse({});
  }
}

export function parseFilters(raw: string): AudienceFilters {
  try {
    return audienceFiltersSchema.parse(JSON.parse(raw));
  } catch {
    return audienceFiltersSchema.parse({});
  }
}

/** Contact filter → Prisma where (always scoped to the organization). */
export function filtersWhere(organizationId: string, f: AudienceFilters): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [{ organizationId }];
  if (f.tagIds.length) {
    if (f.tagMode === "all") for (const tagId of f.tagIds) and.push({ tags: { some: { tagId } } });
    else and.push({ tags: { some: { tagId: { in: f.tagIds } } } });
  }
  if (f.excludeTagIds.length) and.push({ tags: { none: { tagId: { in: f.excludeTagIds } } } });
  if (f.leadStatuses.length) and.push({ leadStatus: { in: f.leadStatuses } });
  if (f.lifecycles.length) and.push({ lifecycle: { in: f.lifecycles } });
  if (f.consent.length) and.push({ optInStatus: { in: f.consent } });
  if (f.sources.length) and.push({ source: { in: f.sources } });
  return { AND: and };
}

/** Where clause for a campaign audience (segments are evaluated live, at review/send time). */
export async function audienceWhere(organizationId: string, a: Audience): Promise<Prisma.ContactWhereInput> {
  switch (a.mode) {
    case "all":
      return { organizationId };
    case "contacts":
      return { organizationId, id: { in: a.contactIds } };
    case "segment": {
      const seg = a.segmentId ? await db.segment.findFirst({ where: { id: a.segmentId, organizationId } }) : null;
      if (!seg) throw new ApiError("VALIDATION_ERROR", "Choose a saved segment.", { details: { segmentId: ["Segment not found"] } });
      return filtersWhere(organizationId, parseFilters(seg.filters));
    }
    default:
      return filtersWhere(organizationId, a.filters);
  }
}

/** Headcount + consent breakdown shown live in the Audience step. */
export async function previewAudience(organizationId: string, a: Audience) {
  const where = await audienceWhere(organizationId, a);
  const [total, optedIn, optedOut, suppressed] = await Promise.all([
    db.contact.count({ where }),
    db.contact.count({ where: { AND: [where, { optInStatus: "opted_in", suppressed: false }] } }),
    db.contact.count({ where: { AND: [where, { optInStatus: "opted_out" }] } }),
    db.contact.count({ where: { AND: [where, { suppressed: true }] } }),
  ]);
  return { total, optedIn, optedOut, suppressed, noConsent: Math.max(0, total - optedIn - optedOut - suppressed) };
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export async function listSegments(organizationId: string) {
  const rows = await db.segment.findMany({ where: { organizationId }, orderBy: { name: "asc" }, include: { _count: { select: { campaigns: true } } } });
  return Promise.all(
    rows.map(async (s) => {
      const filters = parseFilters(s.filters);
      return { id: s.id, name: s.name, description: s.description, filters, campaigns: s._count.campaigns, contacts: await db.contact.count({ where: filtersWhere(organizationId, filters) }), createdAt: s.createdAt };
    })
  );
}

export async function createSegment(access: OrgAccess, input: { name: string; description: string; filters: AudienceFilters }, req?: Request) {
  await assertTagsInOrg(access.organizationId, [...input.filters.tagIds, ...input.filters.excludeTagIds]);
  const exists = await db.segment.findUnique({ where: { organizationId_name: { organizationId: access.organizationId, name: input.name } } });
  if (exists) throw new ApiError("CONFLICT", "A segment with this name already exists.", { details: { name: ["Already used"] } });
  const s = await db.segment.create({ data: { organizationId: access.organizationId, name: input.name, description: input.description, filters: JSON.stringify(input.filters), createdById: access.user.id } });
  await audit({ action: "segment.created", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "segment", targetId: s.id, metadata: { name: s.name }, req });
  return s;
}

export async function deleteSegment(access: OrgAccess, id: string, req?: Request) {
  const s = await db.segment.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!s) throw new ApiError("NOT_FOUND", "Segment not found.");
  const active = await db.campaign.count({ where: { segmentId: id, status: { in: ["draft", "scheduled", "sending", "paused"] } } });
  if (active) throw new ApiError("CONFLICT", "A draft or running campaign uses this segment.");
  await db.segment.delete({ where: { id } });
  await audit({ action: "segment.deleted", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "segment", targetId: id, metadata: { name: s.name }, req });
}

export async function assertTagsInOrg(organizationId: string, tagIds: string[]) {
  if (!tagIds.length) return;
  const n = await db.tag.count({ where: { organizationId, id: { in: [...new Set(tagIds)] } } });
  if (n !== new Set(tagIds).size) throw new ApiError("VALIDATION_ERROR", "Unknown tag in the audience filter.", { details: { tagIds: ["Unknown tag"] } });
}
