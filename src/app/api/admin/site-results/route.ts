import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { getResults, resultsSchema, saveResults } from "@/services/site/results";
import { audit } from "@/lib/audit";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ items: await getResults() });
});

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const items = await saveResults(await readJson(req, resultsSchema));
  await audit({ action: "site.content_updated", actorUserId: admin.id, targetType: "site_results", metadata: { count: items.length }, req });
  return ok({ items });
});
