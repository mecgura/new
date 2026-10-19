import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { disableSiteChat, enableSiteChat, siteChatStatus } from "@/services/site/lead-chat";

/** Which workspace receives the leads from the home page chatbot (and whether it is on). */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const organizations = await db.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 });
  return ok({ ...(await siteChatStatus()), organizations });
});

const putSchema = z.object({ enabled: z.boolean(), organizationId: z.string().trim().min(1).max(60).optional() }).strict();

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const input = await readJson(req, putSchema);
  if (input.enabled) {
    if (!input.organizationId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    await enableSiteChat(input.organizationId, admin.id, req);
  } else {
    await disableSiteChat(admin.id, req);
  }
  return ok(await siteChatStatus());
});
