import { keyRoute, needTenant, pageOf } from "@/lib/api/key-route";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = keyRoute("services.read", async ({ req, principal }) => {
  const tenantId = needTenant(principal); const { page, size, skip } = pageOf(req);
  const where = { tenantId, status: "PUBLISHED", deletedAt: null };
  const [total, rows] = await Promise.all([db.websiteService.count({ where }), db.websiteService.findMany({ where, orderBy: { title: "asc" }, skip, take: size, select: { slug: true, title: true, shortDescription: true } })]);
  return { total, page, pageSize: size, rows };
});
