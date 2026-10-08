import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { parseOrThrow } from "@/lib/validation";
import { itemStatusSchema } from "@/lib/validation/website";
import { setDoctorStatus } from "@/lib/services/website-doctors";

export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) =>
  setDoctorStatus(ctx, params.userId, parseOrThrow(itemStatusSchema, await readJson(req)).status),
);
