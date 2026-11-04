import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { OrgAccess } from "@/lib/session";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { MAX_MEDIA_BYTES } from "@/services/social/posts";

/** Media library: images uploaded once and reused across posts. */
export const MAX_ASSETS = 200;
export const MAX_LIBRARY_BYTES = 150 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

const dto = (orgId: string, a: { id: string; name: string; mimeType: string; sizeBytes: number; tags: string; createdAt: Date }) => ({ id: a.id, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes, tags: a.tags, url: `/api/organizations/${orgId}/social/assets/${a.id}/file`, createdAt: a.createdAt });

export async function listAssets(access: OrgAccess, q = "") {
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  const rows = await db.socialAsset.findMany({
    where: { organizationId: access.organizationId, ...(q ? { OR: [{ name: { contains: q } }, { tags: { contains: q.toLowerCase() } }] } : {}) },
    select: { id: true, name: true, mimeType: true, sizeBytes: true, tags: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: MAX_ASSETS,
  });
  const used = await db.socialAsset.aggregate({ where: { organizationId: access.organizationId }, _sum: { sizeBytes: true }, _count: { _all: true } });
  return { assets: rows.map((r) => dto(access.organizationId, r)), usedBytes: used._sum.sizeBytes ?? 0, count: used._count._all, maxBytes: MAX_LIBRARY_BYTES, maxAssets: MAX_ASSETS };
}

export async function addAsset(access: OrgAccess, input: { name: string; image: string; tags?: string }) {
  await assertServiceEnabled(access.organizationId, "SOCIAL_MEDIA");
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.image);
  if (!m || !TYPES.includes(m[1])) throw new ApiError("VALIDATION_ERROR", "Use a JPG, PNG or WebP image.", { details: { image: ["Unsupported"] } });
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_MEDIA_BYTES) throw new ApiError("VALIDATION_ERROR", "Images can be up to 3 MB.", { details: { image: ["Too large"] } });
  const used = await db.socialAsset.aggregate({ where: { organizationId: access.organizationId }, _sum: { sizeBytes: true }, _count: { _all: true } });
  if (used._count._all >= MAX_ASSETS) throw new ApiError("VALIDATION_ERROR", `The library holds up to ${MAX_ASSETS} images. Delete some old ones first.`);
  if ((used._sum.sizeBytes ?? 0) + bytes.length > MAX_LIBRARY_BYTES) throw new ApiError("VALIDATION_ERROR", "The library is full (150 MB). Delete some old images first.");
  const tags = (input.tags ?? "").toLowerCase().split(/[,#\s]+/).filter(Boolean).slice(0, 10).join(" ");
  const a = await db.socialAsset.create({ data: { organizationId: access.organizationId, name: input.name.slice(0, 120) || "Image", mimeType: m[1], sizeBytes: bytes.length, bytes: new Uint8Array(bytes), tags, createdById: access.user.id } });
  return dto(access.organizationId, a);
}

export async function deleteAsset(access: OrgAccess, id: string) {
  const r = await db.socialAsset.deleteMany({ where: { id, organizationId: access.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Image not found.");
}

export async function assetFile(organizationId: string, id: string) {
  const a = await db.socialAsset.findFirst({ where: { id, organizationId }, select: { mimeType: true, bytes: true } });
  if (!a) throw new ApiError("NOT_FOUND", "Image not found.");
  return a;
}
