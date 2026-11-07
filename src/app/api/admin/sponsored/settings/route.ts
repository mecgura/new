import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { panelEnabled, setPanelEnabled } from "@/services/sponsored/sponsored";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok({ enabled: await panelEnabled() });
});

/** The master switch for the Sponsored panel on the website. */
export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const { enabled } = await readJson(req, z.object({ enabled: z.boolean() }).strict());
  await setPanelEnabled(admin.id, enabled, req);
  return ok({ enabled });
});
