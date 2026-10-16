import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { setClinicStatus } from "@/lib/services/clinics";
import { parseOrThrow } from "@/lib/validation";
import { tenantStatusSchema } from "@/lib/validation/clinic";

export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ req, ctx, params }) =>
  setClinicStatus(ctx, params.id, parseOrThrow(tenantStatusSchema, await readJson(req)).status),
);
