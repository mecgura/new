import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { TenantRequestContext } from "@/lib/auth/context";
import { siteImageId } from "@/lib/website/urls";

/**
 * Image URLs saved in CMS content must be images uploaded by THIS clinic. Without this, a tampered request could
 * point a page at another clinic's image id.
 */
export async function assertOwnImages(ctx: TenantRequestContext, urls: (string | null | undefined)[], field = "imageUrl") {
  const ids = [...new Set(urls.filter((u): u is string => !!u).map((u) => siteImageId(u)))];
  if (ids.some((i) => !i)) throw new AppError("VALIDATION_ERROR", { fieldErrors: { [field]: "Use an image uploaded through the CMS." } });
  if (!ids.length) return;
  const found = await db.tenantAsset.count({ where: { tenantId: ctx.tenantId, kind: "SITE_IMAGE", id: { in: ids as string[] } } });
  if (found !== ids.length) throw new AppError("VALIDATION_ERROR", { fieldErrors: { [field]: "That image isn't available. Upload it again." } });
}

export const jsonList = (xs: string[]) => JSON.stringify(xs);
export const parseList = (j: string): string[] => { try { const v = JSON.parse(j); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; } };
