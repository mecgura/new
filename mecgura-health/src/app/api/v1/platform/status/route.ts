import { keyRoute } from "@/lib/api/key-route";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = keyRoute("platform.status.read", async ({ principal }) => {
  if (principal.tenantId) throw new AppError("FORBIDDEN", { message: "Platform keys only." });
  const [clinics, active] = await Promise.all([db.tenant.count({ where: { deletedAt: null } }), db.tenant.count({ where: { deletedAt: null, status: "ACTIVE" } })]);
  return { clinics, activeClinics: active };
});
