import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { parseOrThrow } from "@/lib/validation";
import { itemStatusSchema } from "@/lib/validation/website";
import { setItemStatus } from "@/lib/services/website-items";

/** DRAFT / ARCHIVED need edit rights; PUBLISHED needs website.publish. Enforced in the service. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) =>
  setItemStatus(ctx, params.resource, params.id, parseOrThrow(itemStatusSchema, await readJson(req)).status),
);
