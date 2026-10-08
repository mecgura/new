import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { parseOrThrow } from "@/lib/validation";
import { publishSchema } from "@/lib/validation/website";
import { publishSite, unpublishSite } from "@/lib/services/website-content";

export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "website.publish" }, async ({ req, ctx }) =>
  parseOrThrow(publishSchema, await readJson(req)).action === "publish" ? publishSite(ctx) : unpublishSite(ctx),
);
