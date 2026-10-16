import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { reinviteUser } from "@/lib/services/users";

export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "users.create" }, async ({ ctx, params }) => reinviteUser(ctx, params.id));
