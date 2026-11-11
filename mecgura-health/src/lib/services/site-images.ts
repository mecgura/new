import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { validateImage } from "@/lib/security/images";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";

const MAX_DIMENSION = 1600;

/**
 * Website image upload. Validates by magic bytes, then RE-ENCODES with sharp: downscaled to ≤1600px, converted to WebP,
 * EXIF/GPS metadata stripped (privacy) and any embedded payload dropped. Stored per tenant; served publicly by id.
 */
export async function saveSiteImage(ctx: TenantRequestContext, bytes: Uint8Array) {
  const p = ctx.permissions;
  if (!(p.has("website.edit") || p.has("website.profile") || p.has("website.articles"))) throw new AppError("FORBIDDEN");
  const limited = await rateLimit(`siteimg:${ctx.user.id}`, { limit: 40, windowMs: 60 * 60_000 });
  if (!limited.allowed) throw new AppError("RATE_LIMITED");
  const check = validateImage("SITE_IMAGE", bytes);
  if (!check.ok) throw new AppError("VALIDATION_ERROR", { message: check.message, fieldErrors: { file: check.message } });
  let out: Buffer;
  try {
    const img = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
    out = await img.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new AppError("VALIDATION_ERROR", { message: "This image couldn't be processed. Try a different file.", fieldErrors: { file: "This image couldn't be processed." } });
  }
  const asset = await tenantDb(ctx).tenantAsset.create({
    data: { kind: "SITE_IMAGE", ownerId: randomBytes(9).toString("hex"), mimeType: "image/webp", size: out.length, data: out } as never,
    select: { id: true },
  });
  await recordAudit({ action: AUDIT_ACTIONS.SITE_IMAGE_UPLOADED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "asset", entityId: asset.id });
  return { url: `/api/assets/${asset.id}?v=${Date.now()}` };
}
