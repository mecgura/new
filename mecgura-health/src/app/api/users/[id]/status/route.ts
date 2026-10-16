import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { setUserStatus } from "@/lib/services/users";
import { parseOrThrow } from "@/lib/validation";
import { userStatusSchema } from "@/lib/validation/clinic";

export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "users.disable" }, async ({ req, ctx, params }) =>
  setUserStatus(ctx, params.id, parseOrThrow(userStatusSchema, await readJson(req)).status),
);
