import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { canApprove, getSocialSettings, saveSocialSettings, socialSettingsSchema } from "@/services/social/workflow";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "social:manage");
  return ok({ settings: await getSocialSettings(access.organizationId), canApprove: canApprove(access) });
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "social:manage");
  return ok({ settings: await saveSocialSettings(access, await readJson(req, socialSettingsSchema), req) });
});
