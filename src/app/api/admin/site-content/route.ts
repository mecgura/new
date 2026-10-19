import { handle, ok, readJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { getHomeContent, homeContentSchema, saveHomeContent } from "@/services/site/home-content";

/** Public home page content (team, services, integrations) edited by the Super Admin. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ content: await getHomeContent() });
});

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const input = await readJson(req, homeContentSchema);
  const content = await saveHomeContent(input);
  await audit({
    action: "site.content_updated",
    actorUserId: admin.id,
    targetType: "site",
    metadata: { team: content.team.length, services: content.services.length, integrations: content.integrations.length },
    req,
  });
  return ok({ content });
});
