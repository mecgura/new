import { apiRoute, readJson } from "@/lib/api/handler";
import { activatePortalAccount } from "@/lib/services/portal-auth";
export const dynamic = "force-dynamic";
export const POST = apiRoute<null>({ auth: false }, async ({ req }) => {
  const h = req.headers; const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return activatePortalAccount(await readJson(req), ip);
});
