import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getUser, updateUser } from "@/lib/services/users";
import { parseOrThrow } from "@/lib/validation";
import { userUpdateSchema } from "@/lib/validation/clinic";

export const dynamic = "force-dynamic";

export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "users.view" }, async ({ ctx, params }) => getUser(ctx, params.id));

export const PATCH = apiRoute<TenantRequestContext>({ tenant: true, permission: "users.edit" }, async ({ req, ctx, params }) =>
  updateUser(ctx, params.id, parseOrThrow(userUpdateSchema, await readJson(req))),
);
