import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { createUser, listUsers } from "@/lib/services/users";
import { parseOrThrow } from "@/lib/validation";
import { userCreateSchema } from "@/lib/validation/clinic";

export const dynamic = "force-dynamic";

// Note: no tenantId anywhere in the request. The clinic is the caller's, resolved server-side.
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "users.view" }, async ({ req, ctx }) => {
  const sp = new URL(req.url).searchParams;
  return listUsers(ctx, { q: sp.get("q") ?? undefined, role: sp.get("role") ?? undefined, status: sp.get("status") ?? undefined, page: Number(sp.get("page")) || 1 });
});

export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "users.create" }, async ({ req, ctx }) =>
  createUser(ctx, parseOrThrow(userCreateSchema, await readJson(req))),
);
